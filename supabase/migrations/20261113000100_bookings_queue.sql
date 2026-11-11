-- Phase 4: demo card linking, collection slots, bookings with QR tokens, check-in and a
-- virtual queue.
--
-- Booking is an optional crowd-management convenience. It never decides who receives
-- rations, and checking in is attendance only: it is not e-POS authentication and does not
-- touch shop stock. Card verification matches fictional DEMO- records only.

-- Helpers ---------------------------------------------------------------------

-- The approved shop the caller administers, or an error.
create function public.shop_of_admin(p_actor uuid) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v_shop uuid;
begin
  select id into v_shop from public.shops where owner_id = p_actor and status = 'approved';
  if v_shop is null then
    raise exception 'Shop tools unlock after your shop is approved' using errcode = 'P0001', hint = 'shop_not_approved';
  end if;
  return v_shop;
end;
$$;

create function public.ist_label(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(p_at at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI AM')
$$;

-- Notifications are the outbox for any future email or SMS provider: a delivery worker
-- would pick rows where external_delivery_at is null. Nothing is sent outside the app today.
alter table public.notifications add column external_delivery_at timestamptz;

-- Demo ration-card linking --------------------------------------------------------

create table public.card_link_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index card_link_attempts_user_idx on public.card_link_attempts (user_id, attempted_at desc);

-- Links the caller to a fictional demo card when the card number and head of family both
-- match a record no one else has linked. Returns null, after recording the attempt, when
-- they do not; the caller cannot tell a wrong name from an unknown or taken card. Five
-- failed attempts in an hour lock linking for that account until the hour passes.
create function public.link_demo_card(p_user_id uuid, p_card_number text, p_head_of_family text)
returns public.beneficiary_cards
language plpgsql set search_path = '' as $$
declare
  v_card public.demo_ration_cards;
  v_link public.beneficiary_cards;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and role = 'beneficiary') then
    raise exception 'Only household accounts can link a card' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if exists (select 1 from public.beneficiary_cards where user_id = p_user_id) then
    raise exception 'This account already has a linked card' using errcode = 'P0001', hint = 'card_already_linked';
  end if;
  if (select count(*) from public.card_link_attempts
       where user_id = p_user_id and not succeeded and attempted_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many attempts. Try again in an hour, or ask your shop for help.'
      using errcode = 'P0001', hint = 'too_many_attempts';
  end if;

  select rc.* into v_card from public.demo_ration_cards rc
   where rc.card_number = upper(trim(p_card_number))
     and lower(trim(rc.head_of_family)) = lower(trim(p_head_of_family))
     and not exists (select 1 from public.beneficiary_cards bc where bc.card_id = rc.id)
   for update;

  insert into public.card_link_attempts (user_id, succeeded) values (p_user_id, v_card.id is not null);
  if v_card.id is null then
    return null;
  end if;

  insert into public.beneficiary_cards (user_id, card_id) values (p_user_id, v_card.id) returning * into v_link;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_user_id, 'card.linked', 'demo_ration_card', v_card.id::text, jsonb_build_object('method', 'demo_record_match'));
  return v_link;
end;
$$;

-- Weekly schedule and slots ----------------------------------------------------------

create table public.shop_booking_schedule (
  shop_id uuid not null references public.shops (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 Monday, 7 Sunday
  start_time time not null,
  end_time time not null,
  slot_minutes smallint not null check (slot_minutes in (30, 60, 90, 120)),
  capacity integer not null check (capacity between 1 and 500),
  walk_in_reserve integer not null default 0,
  primary key (shop_id, weekday, start_time),
  check (end_time > start_time),
  check (walk_in_reserve >= 0 and walk_in_reserve < capacity),
  check (extract(epoch from end_time - start_time) / 60 >= slot_minutes)
);

create type public.slot_status as enum ('open', 'paused', 'closed');

-- capacity: visitors the shop can serve in the slot. walk_in_reserve of those are never
-- bookable, so people without the app are not crowded out.
alter table public.appointment_slots
  add column status public.slot_status not null default 'open',
  add column status_reason text check (char_length(status_reason) <= 300),
  add column walk_in_reserve integer not null default 0,
  add constraint appointment_slots_walk_in_reserve check (walk_in_reserve >= 0 and walk_in_reserve < capacity),
  add constraint appointment_slots_bookable check (booked_count <= capacity - walk_in_reserve);
create index appointment_slots_shop_starts_idx on public.appointment_slots (shop_id, starts_at);

create function public.save_booking_schedule(p_actor uuid, p_rows jsonb) returns integer
language plpgsql set search_path = '' as $$
declare
  v_shop uuid := public.shop_of_admin(p_actor);
  v_count integer;
begin
  delete from public.shop_booking_schedule where shop_id = v_shop;
  insert into public.shop_booking_schedule (shop_id, weekday, start_time, end_time, slot_minutes, capacity, walk_in_reserve)
  select v_shop, x.weekday, x."startTime", x."endTime", x."slotMinutes", x.capacity, coalesce(x."walkInReserve", 0)
    from jsonb_to_recordset(p_rows) as x(weekday smallint, "startTime" time, "endTime" time, "slotMinutes" smallint,
                                          capacity integer, "walkInReserve" integer);
  get diagnostics v_count = row_count;

  if exists (
    select 1 from public.shop_booking_schedule a
      join public.shop_booking_schedule b
        on a.shop_id = b.shop_id and a.weekday = b.weekday and a.start_time < b.start_time and b.start_time < a.end_time
     where a.shop_id = v_shop
  ) then
    raise exception 'Two collection windows on the same day overlap' using errcode = 'P0001', hint = 'schedule_overlap';
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor, 'schedule.saved', 'shop', v_shop::text, jsonb_build_object('windows', p_rows));
  return v_count;
end;
$$;

-- Creates bookable slots from the weekly schedule for today and the next days, skipping any
-- that already exist or have started. Existing slots are never changed.
create function public.publish_slots(p_actor uuid, p_days integer) returns integer
language plpgsql set search_path = '' as $$
declare
  v_shop uuid := public.shop_of_admin(p_actor);
  v_count integer;
begin
  if p_days not between 1 and 14 then
    raise exception 'Publish between 1 and 14 days ahead' using errcode = 'P0001', hint = 'invalid_days';
  end if;

  insert into public.appointment_slots (shop_id, starts_at, ends_at, capacity, walk_in_reserve)
  select v_shop, x.starts_at, x.starts_at + make_interval(mins => x.slot_minutes), x.capacity, x.walk_in_reserve
    from (
      select (d::date + s.start_time + make_interval(mins => k * s.slot_minutes)) at time zone 'Asia/Kolkata' as starts_at,
             s.slot_minutes, s.capacity, s.walk_in_reserve
        from generate_series(public.today_ist(), public.today_ist() + (p_days - 1), interval '1 day') d
        join public.shop_booking_schedule s on s.shop_id = v_shop and s.weekday = extract(isodow from d)
        cross join lateral generate_series(
          0, (floor(extract(epoch from s.end_time - s.start_time) / 60 / s.slot_minutes))::integer - 1) k
    ) x
   where x.starts_at > now()
  on conflict (shop_id, starts_at) do nothing;
  get diagnostics v_count = row_count;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor, 'slots.published', 'shop', v_shop::text, jsonb_build_object('days', p_days, 'created', v_count));
  return v_count;
end;
$$;

-- Bookings ------------------------------------------------------------------------

alter table public.bookings
  add column cancelled_by uuid references public.profiles (id),
  add column cancel_reason text check (char_length(cancel_reason) <= 300),
  add column rescheduled_from uuid references public.bookings (id),
  add column no_show_at timestamptz,
  add column no_show_by uuid references public.profiles (id),
  add column reminded_at timestamptz,
  -- Typed by hand when the QR code cannot be scanned; matched only within the shop's own bookings.
  add column check_code text generated always as (upper(left(token, 10))) stored,
  add constraint bookings_no_show_recorded check ((status = 'no_show') = (no_show_at is not null));
create index bookings_check_code_idx on public.bookings (check_code);
create index bookings_beneficiary_idx on public.bookings (beneficiary_id, created_at desc);

-- Bookings still open after the check-in window closed become no_show with no actor, which
-- the interface shows as "not checked in". They no longer block a new booking.
create function public.expire_past_bookings(p_beneficiary_id uuid) returns void
language sql set search_path = '' as $$
  update public.bookings b set status = 'no_show', no_show_at = now()
    from public.appointment_slots s
   where s.id = b.slot_id and b.beneficiary_id = p_beneficiary_id and b.status = 'booked'
     and s.ends_at < now() - interval '1 hour';
$$;

-- Takes one bookable seat in an open future slot at the beneficiary's linked shop. The
-- conditional update cannot overfill a slot; the partial unique index allows one active
-- booking per person. Repeating the same booking returns it instead of failing.
create or replace function public.book_slot(p_slot_id uuid, p_beneficiary_id uuid) returns public.bookings
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
  v_slot public.appointment_slots;
begin
  perform public.expire_past_bookings(p_beneficiary_id);
  select * into v_booking from public.bookings
   where beneficiary_id = p_beneficiary_id and slot_id = p_slot_id and status = 'booked';
  if found then
    return v_booking;
  end if;

  update public.appointment_slots s
     set booked_count = s.booked_count + 1
   where s.id = p_slot_id
     and s.status = 'open'
     and s.booked_count < s.capacity - s.walk_in_reserve
     and s.starts_at > now()
     and s.shop_id = (
       select rc.shop_id
         from public.beneficiary_cards bc
         join public.demo_ration_cards rc on rc.id = bc.card_id
        where bc.user_id = p_beneficiary_id
     )
  returning * into v_slot;
  if not found then
    raise exception 'Slot is full, already started, or not at your linked shop'
      using errcode = 'P0001', hint = 'slot_unavailable';
  end if;

  insert into public.bookings (slot_id, beneficiary_id) values (p_slot_id, p_beneficiary_id) returning * into v_booking;
  insert into public.notifications (user_id, kind, title, body)
  values (p_beneficiary_id, 'booking.confirmed', format('Booked: %s', public.ist_label(v_slot.starts_at)),
          'Show your booking QR code or code at the shop. Booking is optional; you can still walk in.');
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_beneficiary_id, 'booking.created', 'booking', v_booking.id::text, jsonb_build_object('slot', p_slot_id));
  return v_booking;
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid, p_beneficiary_id uuid) returns public.bookings
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  update public.bookings b
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_beneficiary_id, cancel_reason = 'Cancelled by the household'
   where b.id = p_booking_id and b.beneficiary_id = p_beneficiary_id and b.status = 'booked'
     and exists (select 1 from public.appointment_slots s where s.id = b.slot_id and s.ends_at > now())
  returning * into v_booking;
  if not found then
    raise exception 'Booking not found or no longer active' using errcode = 'P0001', hint = 'booking_not_active';
  end if;

  update public.appointment_slots set booked_count = booked_count - 1 where id = v_booking.slot_id;
  insert into public.notifications (user_id, kind, title, body)
  values (p_beneficiary_id, 'booking.cancelled', 'Booking cancelled', 'You can book another time, or walk in during shop hours.');
  insert into public.audit_log (actor_id, action, entity_type, entity_id)
  values (p_beneficiary_id, 'booking.cancelled', 'booking', p_booking_id::text);
  return v_booking;
end;
$$;

-- Moves an active booking to another slot in one transaction. If the new slot is not
-- available, nothing changes and the original booking stands.
create function public.reschedule_booking(p_booking_id uuid, p_beneficiary_id uuid, p_new_slot_id uuid)
returns public.bookings
language plpgsql set search_path = '' as $$
declare
  v_old public.bookings;
  v_new public.bookings;
  v_slot public.appointment_slots;
begin
  select * into v_old from public.bookings
   where id = p_booking_id and beneficiary_id = p_beneficiary_id and status = 'booked'
   for update;
  if not found then
    raise exception 'Booking not found or no longer active' using errcode = 'P0001', hint = 'booking_not_active';
  end if;
  if v_old.slot_id = p_new_slot_id then
    raise exception 'Choose a different time' using errcode = 'P0001', hint = 'same_slot';
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_beneficiary_id, cancel_reason = 'Rescheduled'
   where id = v_old.id;
  update public.appointment_slots set booked_count = booked_count - 1 where id = v_old.slot_id;

  update public.appointment_slots s
     set booked_count = s.booked_count + 1
   where s.id = p_new_slot_id and s.status = 'open' and s.booked_count < s.capacity - s.walk_in_reserve
     and s.starts_at > now()
     and s.shop_id = (select shop_id from public.appointment_slots where id = v_old.slot_id)
  returning * into v_slot;
  if not found then
    raise exception 'That time is full, has started, or is not at your shop'
      using errcode = 'P0001', hint = 'slot_unavailable';
  end if;

  insert into public.bookings (slot_id, beneficiary_id, rescheduled_from)
  values (p_new_slot_id, p_beneficiary_id, v_old.id)
  returning * into v_new;
  insert into public.notifications (user_id, kind, title, body)
  values (p_beneficiary_id, 'booking.rescheduled', format('Moved to %s', public.ist_label(v_slot.starts_at)),
          'Your previous time was released. Use the new QR code.');
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_beneficiary_id, 'booking.rescheduled', 'booking', v_new.id::text,
          jsonb_build_object('from_booking', v_old.id, 'from_slot', v_old.slot_id, 'to_slot', p_new_slot_id));
  return v_new;
end;
$$;

-- Pause stops new bookings and keeps existing ones. Close cancels the slot's bookings with
-- the shop's reason and tells each household; a closed slot stays closed.
create function public.set_slot_status(p_slot_id uuid, p_actor uuid, p_status public.slot_status, p_reason text)
returns public.appointment_slots
language plpgsql set search_path = '' as $$
declare
  v_shop uuid := public.shop_of_admin(p_actor);
  v_slot public.appointment_slots;
begin
  select * into v_slot from public.appointment_slots where id = p_slot_id and shop_id = v_shop for update;
  if not found then
    raise exception 'No such collection time at your shop' using errcode = 'P0001', hint = 'slot_not_found';
  end if;
  if v_slot.status = 'closed' then
    raise exception 'This collection time is already closed' using errcode = 'P0001', hint = 'slot_closed';
  end if;
  if v_slot.status = p_status then
    return v_slot;
  end if;
  if p_status = 'closed' and char_length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Give households a reason' using errcode = 'P0001', hint = 'reason_required';
  end if;

  if p_status = 'closed' then
    with cancelled as (
      update public.bookings
         set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor,
             cancel_reason = 'The shop closed this collection time: ' || trim(p_reason)
       where slot_id = p_slot_id and status = 'booked'
      returning beneficiary_id
    )
    insert into public.notifications (user_id, kind, title, body)
    select beneficiary_id, 'booking.cancelled_by_shop',
           format('The shop cancelled your %s visit', public.ist_label(v_slot.starts_at)),
           trim(p_reason) || '. Book another time, or walk in during shop hours.'
      from cancelled;
  end if;

  update public.appointment_slots
     set status = p_status, status_reason = nullif(trim(p_reason), ''),
         booked_count = case when p_status = 'closed' then 0 else booked_count end
   where id = p_slot_id
  returning * into v_slot;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason)
  values (p_actor, 'slot.' || p_status::text, 'appointment_slot', p_slot_id::text, nullif(trim(p_reason), ''));
  return v_slot;
end;
$$;

-- Reminders appear in the app for bookings starting within a day. Called when the household
-- opens the app; there is no scheduler or external delivery yet.
create function public.send_booking_reminders(p_user_id uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  with due as (
    update public.bookings b set reminded_at = now()
      from public.appointment_slots s
     where s.id = b.slot_id and b.beneficiary_id = p_user_id and b.status = 'booked' and b.reminded_at is null
       and s.starts_at between now() and now() + interval '24 hours'
    returning s.starts_at
  )
  insert into public.notifications (user_id, kind, title, body)
  select p_user_id, 'booking.reminder', format('Reminder: collection visit %s', public.ist_label(starts_at)),
         'Bring your ration card. Your booking QR code is in the app.'
    from due;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Queue ----------------------------------------------------------------------------

create type public.queue_status as enum ('waiting', 'serving', 'served', 'no_show');

-- Today's visitors at a shop, booked or walk-in, in arrival order. "Served" means the visit
-- at the counter finished. It is not a distribution record and changes no stock.
create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  service_date date not null,
  number integer not null check (number > 0),
  booking_id uuid unique references public.bookings (id),
  note text check (char_length(note) <= 80),
  status public.queue_status not null default 'waiting',
  checked_in_at timestamptz not null default now(),
  called_at timestamptz,
  finished_at timestamptz,
  created_by uuid not null references public.profiles (id),
  finished_by uuid references public.profiles (id),
  unique (shop_id, service_date, number),
  check ((status in ('served', 'no_show')) = (finished_at is not null)),
  check (status not in ('serving', 'served') or called_at is not null)
);
-- One visitor at the counter at a time.
create unique index queue_entries_one_serving on public.queue_entries (shop_id, service_date) where status = 'serving';
create index queue_entries_shop_day_idx on public.queue_entries (shop_id, service_date, number);

create function public.enforce_queue_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if (old.status::text || '>' || new.status::text) <> all (array[
    'waiting>serving', 'waiting>no_show', 'serving>served', 'serving>no_show'
  ]) then
    raise exception 'A queue entry cannot move from % to %', old.status, new.status
      using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  return new;
end;
$$;
create trigger queue_entries_status_transition before update of status on public.queue_entries
  for each row execute function public.enforce_queue_transition();

-- Next number for today. The shop row lock serialises concurrent check-ins at one shop.
create function public.next_queue_number(p_shop_id uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  v_next integer;
begin
  perform 1 from public.shops where id = p_shop_id for update;
  select coalesce(max(number), 0) + 1 into v_next
    from public.queue_entries where shop_id = p_shop_id and service_date = public.today_ist();
  return v_next;
end;
$$;

-- Checks a booking in by QR token or typed code, only at the shop the booking is for, from
-- an hour before the slot starts to an hour after it ends. Repeating a check-in returns the
-- existing queue entry instead of creating another.
create function public.check_in_booking(p_actor uuid, p_token text, p_code text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_shop uuid := public.shop_of_admin(p_actor);
  v_booking public.bookings;
  v_slot public.appointment_slots;
  v_entry public.queue_entries;
begin
  select b.* into v_booking
    from public.bookings b
    join public.appointment_slots s on s.id = b.slot_id
   where s.shop_id = v_shop
     and ((p_token is not null and b.token = lower(trim(p_token)))
          or (p_code is not null and b.check_code = upper(regexp_replace(p_code, '[^0-9A-Za-z]', '', 'g'))))
   order by s.starts_at desc
   limit 1
   for update of b;
  if not found then
    raise exception 'No booking at your shop matches this code' using errcode = 'P0001', hint = 'invalid_token';
  end if;
  select * into v_slot from public.appointment_slots where id = v_booking.slot_id;

  if v_booking.status = 'checked_in' then
    select * into v_entry from public.queue_entries where booking_id = v_booking.id;
    return jsonb_build_object('entryId', v_entry.id, 'bookingId', v_booking.id, 'alreadyCheckedIn', true);
  elsif v_booking.status = 'cancelled' then
    raise exception 'This booking was cancelled' using errcode = 'P0001', hint = 'booking_cancelled';
  elsif v_booking.status = 'no_show' then
    raise exception 'This booking was marked as not attended. Add the person as a walk-in.'
      using errcode = 'P0001', hint = 'booking_no_show';
  elsif now() < v_slot.starts_at - interval '1 hour' then
    raise exception 'This booking is for %. Check-in opens an hour before.', public.ist_label(v_slot.starts_at)
      using errcode = 'P0001', hint = 'too_early';
  elsif now() > v_slot.ends_at + interval '1 hour' then
    raise exception 'This booking was for % and has expired. Add the person as a walk-in.', public.ist_label(v_slot.starts_at)
      using errcode = 'P0001', hint = 'booking_expired';
  end if;

  insert into public.queue_entries (shop_id, service_date, number, booking_id, created_by)
  values (v_shop, public.today_ist(), public.next_queue_number(v_shop), v_booking.id, p_actor)
  returning * into v_entry;
  update public.bookings set status = 'checked_in', checked_in_at = now(), checked_in_by = p_actor where id = v_booking.id;

  insert into public.notifications (user_id, kind, title, body)
  values (v_booking.beneficiary_id, 'queue.checked_in', format('Checked in. Your number is %s', v_entry.number),
          'Keep the app open to see when you are called.');
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor, 'booking.checked_in', 'booking', v_booking.id::text,
          jsonb_build_object('queue_number', v_entry.number, 'method', case when p_token is not null then 'qr' else 'code' end));
  return jsonb_build_object('entryId', v_entry.id, 'bookingId', v_booking.id, 'alreadyCheckedIn', false);
end;
$$;

-- People without a booking, including those helped by shop staff. The note is optional and
-- should not contain personal details.
create function public.register_walk_in(p_actor uuid, p_note text) returns public.queue_entries
language plpgsql set search_path = '' as $$
declare
  v_shop uuid := public.shop_of_admin(p_actor);
  v_entry public.queue_entries;
begin
  insert into public.queue_entries (shop_id, service_date, number, note, created_by)
  values (v_shop, public.today_ist(), public.next_queue_number(v_shop), nullif(trim(p_note), ''), p_actor)
  returning * into v_entry;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor, 'queue.walk_in', 'queue_entry', v_entry.id::text, jsonb_build_object('queue_number', v_entry.number));
  return v_entry;
end;
$$;

create function public.call_next_in_queue(p_actor uuid) returns public.queue_entries
language plpgsql set search_path = '' as $$
declare
  v_shop uuid := public.shop_of_admin(p_actor);
  v_entry public.queue_entries;
begin
  perform 1 from public.shops where id = v_shop for update;
  select * into v_entry from public.queue_entries
   where shop_id = v_shop and service_date = public.today_ist() and status = 'serving';
  if found then
    raise exception 'Number % is still at the counter. Mark it served or not present first.', v_entry.number
      using errcode = 'P0001', hint = 'someone_serving';
  end if;

  update public.queue_entries set status = 'serving', called_at = now()
   where id = (select id from public.queue_entries
                where shop_id = v_shop and service_date = public.today_ist() and status = 'waiting'
                order by number limit 1)
  returning * into v_entry;
  if not found then
    raise exception 'Nobody is waiting' using errcode = 'P0001', hint = 'queue_empty';
  end if;

  if v_entry.booking_id is not null then
    insert into public.notifications (user_id, kind, title, body)
    select beneficiary_id, 'queue.called', format('Number %s, please come to the counter', v_entry.number), ''
      from public.bookings where id = v_entry.booking_id;
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor, 'queue.called', 'queue_entry', v_entry.id::text, jsonb_build_object('queue_number', v_entry.number));
  return v_entry;
end;
$$;

create function public.finish_queue_entry(p_entry_id uuid, p_actor uuid, p_outcome public.queue_status)
returns public.queue_entries
language plpgsql set search_path = '' as $$
declare
  v_shop uuid := public.shop_of_admin(p_actor);
  v_entry public.queue_entries;
begin
  if p_outcome not in ('served', 'no_show') then
    raise exception 'Outcome must be served or no_show' using errcode = 'P0001', hint = 'invalid_outcome';
  end if;
  update public.queue_entries set status = p_outcome, finished_at = now(), finished_by = p_actor
   where id = p_entry_id and shop_id = v_shop
  returning * into v_entry;
  if not found then
    raise exception 'No such queue entry at your shop' using errcode = 'P0001', hint = 'queue_entry_not_found';
  end if;

  if v_entry.booking_id is not null then
    insert into public.notifications (user_id, kind, title, body)
    select beneficiary_id, 'queue.' || p_outcome::text,
           case when p_outcome = 'served' then 'Visit completed' else format('Number %s was called but not present', v_entry.number) end,
           case when p_outcome = 'served' then 'Thank you for visiting.' else 'Speak to the shop if you are still there.' end
      from public.bookings where id = v_entry.booking_id;
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor, 'queue.' || p_outcome::text, 'queue_entry', p_entry_id::text, jsonb_build_object('queue_number', v_entry.number));
  return v_entry;
end;
$$;

-- For a booked household that never arrived. Only once the slot has started.
create function public.mark_booking_no_show(p_booking_id uuid, p_actor uuid) returns public.bookings
language plpgsql set search_path = '' as $$
declare
  v_shop uuid := public.shop_of_admin(p_actor);
  v_booking public.bookings;
begin
  update public.bookings b set status = 'no_show', no_show_at = now(), no_show_by = p_actor
   where b.id = p_booking_id and b.status = 'booked'
     and exists (select 1 from public.appointment_slots s
                  where s.id = b.slot_id and s.shop_id = v_shop and s.starts_at <= now())
  returning * into v_booking;
  if not found then
    raise exception 'Only a booking at your shop whose time has started can be marked not attended'
      using errcode = 'P0001', hint = 'booking_not_active';
  end if;
  insert into public.notifications (user_id, kind, title, body)
  values (v_booking.beneficiary_id, 'booking.no_show', 'Marked as not attended',
          'You can book another time, or walk in during shop hours.');
  insert into public.audit_log (actor_id, action, entity_type, entity_id)
  values (p_actor, 'booking.no_show', 'booking', p_booking_id::text);
  return v_booking;
end;
$$;

-- Access control ---------------------------------------------------------------------

alter table public.card_link_attempts enable row level security;
alter table public.shop_booking_schedule enable row level security;
alter table public.queue_entries enable row level security;

revoke all on public.card_link_attempts, public.shop_booking_schedule, public.queue_entries from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
-- Re-grant the one function the Storage read policy needs (revoked again by the line above).
grant execute on function public.can_view_shop_document(text) to authenticated;
