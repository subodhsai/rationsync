-- RationSync initial schema.
-- Educational prototype: every shop, card and stock record is fictional demo data.
--
-- Access model: the browser talks to Supabase only for Auth. All business reads and
-- writes go through the Render API, which connects with a server-only database role and
-- enforces role, shop and warehouse scope. RLS is enabled on every table and the public
-- roles (anon, authenticated) get no write access at all, so a leaked publishable key
-- cannot change data. Invariants that must hold regardless of caller live here.

-- Types ---------------------------------------------------------------------

create type public.app_role as enum ('beneficiary', 'shop_admin', 'warehouse_admin');
create type public.shop_status as enum ('pending', 'approved', 'rejected');
create type public.stock_movement_kind as enum ('opening_balance', 'receipt', 'distribution', 'adjustment');
create type public.booking_status as enum ('booked', 'cancelled', 'checked_in');
create type public.card_category as enum ('AAY', 'PHH', 'NPHH');

-- People and places ---------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'beneficiary',
  full_name text not null default '' check (char_length(full_name) <= 120),
  phone text check (phone ~ '^\+?[0-9 ]{7,16}$'),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'kn')),
  created_at timestamptz not null default now()
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{3,24}$'),
  name text not null,
  district text not null,
  taluk text not null,
  address text not null,
  created_at timestamptz not null default now()
);

create table public.warehouse_admins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, warehouse_id)
);

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  -- Upper-case only, so the unique constraint is effectively case-insensitive.
  fps_id text not null unique check (fps_id ~ '^[A-Z0-9-]{4,24}$'),
  owner_id uuid unique references public.profiles (id) on delete set null,
  warehouse_id uuid not null references public.warehouses (id),
  name text not null check (char_length(name) between 3 and 120),
  district text not null,
  taluk text not null,
  address text not null,
  contact_phone text not null,
  opening_hours text not null default '',
  status public.shop_status not null default 'pending',
  review_reason text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shops_review_recorded check (status = 'pending' or reviewed_at is not null),
  constraint shops_rejection_reason check (status <> 'rejected' or char_length(coalesce(review_reason, '')) >= 3)
);
create index shops_warehouse_status_idx on public.shops (warehouse_id, status);

-- Commodities and stock -----------------------------------------------------

create table public.commodities (
  code text primary key check (code ~ '^[A-Z_]{2,24}$'),
  name_en text not null,
  name_kn text not null,
  unit text not null check (unit in ('kg', 'litre')),
  sort_order smallint not null default 0
);

insert into public.commodities (code, name_en, name_kn, unit, sort_order) values
  ('RICE', 'Rice', 'ಅಕ್ಕಿ', 'kg', 1),
  ('WHEAT', 'Wheat', 'ಗೋಧಿ', 'kg', 2),
  ('RAGI', 'Ragi', 'ರಾಗಿ', 'kg', 3),
  ('JOWAR', 'Jowar', 'ಜೋಳ', 'kg', 4),
  ('SUGAR', 'Sugar', 'ಸಕ್ಕರೆ', 'kg', 5);

create table public.shop_inventory (
  shop_id uuid not null references public.shops (id) on delete restrict,
  commodity_code text not null references public.commodities (code),
  quantity numeric(12, 2) not null default 0 check (quantity >= 0),
  low_stock_threshold numeric(12, 2) not null default 0 check (low_stock_threshold >= 0),
  updated_at timestamptz not null default now(),
  primary key (shop_id, commodity_code)
);

-- Every change to shop_inventory.quantity is recorded here by apply_stock_movement().
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  commodity_code text not null references public.commodities (code),
  kind public.stock_movement_kind not null,
  quantity_delta numeric(12, 2) not null check (quantity_delta <> 0),
  balance_after numeric(12, 2) not null check (balance_after >= 0),
  reason text not null check (char_length(reason) between 3 and 500),
  reference text,
  actor_id uuid references public.profiles (id),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (shop_id, idempotency_key),
  constraint stock_movements_direction check (
    (kind in ('opening_balance', 'receipt') and quantity_delta > 0)
    or (kind = 'distribution' and quantity_delta < 0)
    or kind = 'adjustment'
  )
);
create index stock_movements_shop_created_idx on public.stock_movements (shop_id, created_at desc);

-- Demo ration cards and appointments ----------------------------------------

-- Fictional cards for demo verification. The DEMO- prefix keeps them from ever being
-- mistaken for, or colliding with, real ration-card numbers.
create table public.demo_ration_cards (
  id uuid primary key default gen_random_uuid(),
  card_number text not null unique check (card_number ~ '^DEMO-[0-9]{6}$'),
  head_of_family text not null,
  category public.card_category not null,
  member_count smallint not null check (member_count between 1 and 20),
  shop_id uuid not null references public.shops (id),
  created_at timestamptz not null default now()
);

create table public.beneficiary_cards (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  card_id uuid not null unique references public.demo_ration_cards (id),
  linked_at timestamptz not null default now()
);

create table public.appointment_slots (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 500),
  booked_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (shop_id, starts_at),
  check (ends_at > starts_at),
  constraint appointment_slots_within_capacity check (booked_count between 0 and capacity)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.appointment_slots (id),
  beneficiary_id uuid not null references public.profiles (id) on delete cascade,
  -- 122 random bits; encoded into the QR code shown to the beneficiary.
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status public.booking_status not null default 'booked',
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id),
  check ((status = 'checked_in') = (checked_in_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
-- One active booking per beneficiary. Booking is optional; walk-ins are always served.
create unique index bookings_one_active_per_beneficiary on public.bookings (beneficiary_id) where status = 'booked';
create index bookings_slot_idx on public.bookings (slot_id);

-- Notifications and audit ---------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  reason text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);

-- Integrity triggers --------------------------------------------------------

create function public.prevent_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.prevent_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.prevent_mutation();
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function public.prevent_mutation();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function public.prevent_mutation();

create function public.enforce_shop_owner_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.profiles where id = new.owner_id and role = 'shop_admin'
  ) then
    raise exception 'Shop owner must have the shop_admin role' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger shops_owner_role before insert or update of owner_id on public.shops
  for each row execute function public.enforce_shop_owner_role();

create function public.enforce_warehouse_admin_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and role = 'warehouse_admin') then
    raise exception 'Warehouse assignment requires the warehouse_admin role' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger warehouse_admins_role before insert or update on public.warehouse_admins
  for each row execute function public.enforce_warehouse_admin_role();

-- New Auth users get a profile. Only beneficiary or shop_admin can come from sign-up
-- metadata; anything else, including 'warehouse_admin', becomes beneficiary.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'account_type' = 'shop_admin'
      then 'shop_admin'::public.app_role else 'beneficiary'::public.app_role end,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120)
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Operations ----------------------------------------------------------------

-- The only path that changes shop stock. Runs in the caller's transaction; a replay with
-- the same idempotency key returns the original movement instead of applying it twice,
-- and the quantity check rejects any movement that would take stock below zero.
create function public.apply_stock_movement(
  p_shop_id uuid,
  p_commodity_code text,
  p_kind public.stock_movement_kind,
  p_quantity_delta numeric,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_reference text default null
) returns public.stock_movements
language plpgsql set search_path = '' as $$
declare
  v_movement public.stock_movements;
  v_balance numeric;
begin
  select * into v_movement from public.stock_movements
   where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if found then
    return v_movement;
  end if;

  insert into public.shop_inventory (shop_id, commodity_code)
  values (p_shop_id, p_commodity_code)
  on conflict do nothing;

  update public.shop_inventory
     set quantity = quantity + p_quantity_delta, updated_at = now()
   where shop_id = p_shop_id and commodity_code = p_commodity_code
  returning quantity into v_balance;

  insert into public.stock_movements
    (shop_id, commodity_code, kind, quantity_delta, balance_after, reason, reference, actor_id, idempotency_key)
  values
    (p_shop_id, p_commodity_code, p_kind, p_quantity_delta, v_balance, p_reason, p_reference, p_actor_id, p_idempotency_key)
  returning * into v_movement;
  return v_movement;
end;
$$;

-- Reserves a seat atomically: the conditional update cannot overfill a slot even under
-- concurrent requests, and the partial unique index blocks a second active booking.
create function public.book_slot(p_slot_id uuid, p_beneficiary_id uuid) returns public.bookings
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  update public.appointment_slots s
     set booked_count = s.booked_count + 1
   where s.id = p_slot_id
     and s.booked_count < s.capacity
     and s.starts_at > now()
     and s.shop_id = (
       select rc.shop_id
         from public.beneficiary_cards bc
         join public.demo_ration_cards rc on rc.id = bc.card_id
        where bc.user_id = p_beneficiary_id
     );
  if not found then
    raise exception 'Slot is full, already started, or not at your linked shop'
      using errcode = 'P0001', hint = 'slot_unavailable';
  end if;

  insert into public.bookings (slot_id, beneficiary_id)
  values (p_slot_id, p_beneficiary_id)
  returning * into v_booking;
  return v_booking;
end;
$$;

create function public.cancel_booking(p_booking_id uuid, p_beneficiary_id uuid) returns public.bookings
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now()
   where id = p_booking_id and beneficiary_id = p_beneficiary_id and status = 'booked'
  returning * into v_booking;
  if not found then
    raise exception 'Booking not found or no longer active' using errcode = 'P0002';
  end if;

  update public.appointment_slots set booked_count = booked_count - 1 where id = v_booking.slot_id;
  return v_booking;
end;
$$;

-- Trusted provisioning for warehouse administrators. Not callable by app users; run it
-- from the Supabase SQL editor after creating the account under Authentication.
create function public.provision_warehouse_admin(p_email text, p_warehouse_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_warehouse uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'No Auth user with email %. Create the user under Authentication first.', p_email;
  end if;

  select id into v_warehouse from public.warehouses where code = p_warehouse_code;
  if v_warehouse is null then
    raise exception 'Unknown warehouse code %', p_warehouse_code;
  end if;

  if exists (select 1 from public.shops where owner_id = v_user) then
    raise exception 'This account owns a shop and cannot also be a warehouse administrator';
  end if;

  update public.profiles set role = 'warehouse_admin' where id = v_user;
  insert into public.warehouse_admins (user_id, warehouse_id) values (v_user, v_warehouse)
  on conflict do nothing;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason, details)
  values (null, 'warehouse_admin.provisioned', 'warehouse', v_warehouse::text,
          'Provisioned by database operator', jsonb_build_object('user_id', v_user));
end;
$$;

-- Access control ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.warehouses enable row level security;
alter table public.warehouse_admins enable row level security;
alter table public.shops enable row level security;
alter table public.commodities enable row level security;
alter table public.shop_inventory enable row level security;
alter table public.stock_movements enable row level security;
alter table public.demo_ration_cards enable row level security;
alter table public.beneficiary_cards enable row level security;
alter table public.appointment_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Supabase grants new objects to anon/authenticated by default; take that back.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Read-only access a signed-in browser may use directly (for example Realtime).
grant select on public.profiles, public.notifications, public.commodities to authenticated;

create policy "Users read their own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users read their own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Signed-in users read commodities" on public.commodities
  for select to authenticated using (true);
