-- Phase 2: shop applications and warehouse review, supporting documents, shop-side stock
-- operations, and threshold-based low-stock alerts.
--
-- Registration here is an application to join RationSync. It is not, and does not
-- replace, official Fair Price Shop authorization by the Government of Karnataka.

-- Application details --------------------------------------------------------

alter table public.shops
  add column pin_code text check (pin_code ~ '^5[6-9][0-9]{4}$'),
  add column contact_email text check (contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add column updated_at timestamptz not null default now();

create index shops_district_idx on public.shops (district);

-- Once a shop has an owner, it cannot be moved to a different account.
create function public.prevent_shop_owner_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.owner_id is not null and new.owner_id is not null and new.owner_id <> old.owner_id then
    raise exception 'Shop ownership cannot be transferred' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger shops_owner_immutable before update of owner_id on public.shops
  for each row execute function public.prevent_shop_owner_change();

-- Every decision, kept even after a rejected shop resubmits.
create table public.shop_reviews (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  decision public.shop_status not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 3 and 500),
  reviewer_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index shop_reviews_shop_idx on public.shop_reviews (shop_id, created_at desc);
create trigger shop_reviews_append_only before update or delete on public.shop_reviews
  for each row execute function public.prevent_mutation();

create table public.shop_documents (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index shop_documents_shop_idx on public.shop_documents (shop_id);

-- Stock -----------------------------------------------------------------------

-- A commodity's opening balance is recorded once; later stock arrives through movements.
create unique index stock_movements_one_opening_balance
  on public.stock_movements (shop_id, commodity_code) where kind = 'opening_balance';

create type public.alert_status as enum ('open', 'resolved');

create table public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  commodity_code text not null references public.commodities (code),
  status public.alert_status not null default 'open',
  quantity_at_open numeric(12, 2) not null,
  threshold_at_open numeric(12, 2) not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  quantity_at_resolve numeric(12, 2),
  check ((status = 'resolved') = (resolved_at is not null))
);
-- At most one unresolved alert per shop and commodity.
create unique index stock_alerts_one_open on public.stock_alerts (shop_id, commodity_code) where status = 'open';
create index stock_alerts_shop_opened_idx on public.stock_alerts (shop_id, opened_at desc);

-- Rule: an alert is open while quantity <= low_stock_threshold, and resolves as soon as
-- a movement or threshold change lifts the quantity above it.
create function public.refresh_stock_alert(p_shop_id uuid, p_commodity_code text) returns void
language plpgsql set search_path = '' as $$
declare
  v_inventory public.shop_inventory;
  v_alert_id uuid;
  v_owner uuid;
  v_name text;
  v_unit text;
begin
  select * into v_inventory from public.shop_inventory
   where shop_id = p_shop_id and commodity_code = p_commodity_code;
  if not found then
    return;
  end if;

  if v_inventory.quantity <= v_inventory.low_stock_threshold then
    insert into public.stock_alerts (shop_id, commodity_code, quantity_at_open, threshold_at_open)
    values (p_shop_id, p_commodity_code, v_inventory.quantity, v_inventory.low_stock_threshold)
    on conflict (shop_id, commodity_code) where status = 'open' do nothing
    returning id into v_alert_id;

    if v_alert_id is not null then
      select s.owner_id, c.name_en, c.unit into v_owner, v_name, v_unit
        from public.shops s, public.commodities c
       where s.id = p_shop_id and c.code = p_commodity_code;
      if v_owner is not null then
        insert into public.notifications (user_id, kind, title, body)
        values (v_owner, 'stock.low', format('%s is at or below its threshold', v_name),
                format('%s %s left. Threshold %s %s.', v_inventory.quantity, v_unit,
                       v_inventory.low_stock_threshold, v_unit));
      end if;
    end if;
  else
    update public.stock_alerts
       set status = 'resolved', resolved_at = now(), quantity_at_resolve = v_inventory.quantity
     where shop_id = p_shop_id and commodity_code = p_commodity_code and status = 'open';
  end if;
end;
$$;

-- Same contract as before, now limited to approved shops and keeping alerts current in
-- the same transaction as the movement.
create or replace function public.apply_stock_movement(
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

  if not exists (select 1 from public.shops where id = p_shop_id and status = 'approved') then
    raise exception 'Stock can only be recorded for an approved shop'
      using errcode = 'P0001', hint = 'shop_not_approved';
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

  perform public.refresh_stock_alert(p_shop_id, p_commodity_code);
  return v_movement;
end;
$$;

create function public.set_low_stock_threshold(
  p_shop_id uuid,
  p_commodity_code text,
  p_threshold numeric,
  p_actor_id uuid
) returns public.shop_inventory
language plpgsql set search_path = '' as $$
declare
  v_before numeric;
  v_row public.shop_inventory;
begin
  select low_stock_threshold into v_before from public.shop_inventory
   where shop_id = p_shop_id and commodity_code = p_commodity_code
   for update;
  if not found then
    raise exception 'Record an opening balance for this commodity first'
      using errcode = 'P0001', hint = 'commodity_not_stocked';
  end if;

  update public.shop_inventory set low_stock_threshold = p_threshold
   where shop_id = p_shop_id and commodity_code = p_commodity_code
  returning * into v_row;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'inventory.threshold_changed', 'shop', p_shop_id::text,
          jsonb_build_object('commodity', p_commodity_code, 'from', v_before, 'to', p_threshold));

  perform public.refresh_stock_alert(p_shop_id, p_commodity_code);
  return v_row;
end;
$$;

-- Applications ---------------------------------------------------------------

-- Creates the caller's application, or resubmits it after a rejection. An account holds
-- at most one shop (shops.owner_id is unique) and cannot reapply while pending or approved.
create function public.submit_shop_registration(
  p_owner_id uuid,
  p_fps_id text,
  p_name text,
  p_district text,
  p_taluk text,
  p_address text,
  p_pin_code text,
  p_contact_phone text,
  p_contact_email text,
  p_warehouse_id uuid
) returns public.shops
language plpgsql set search_path = '' as $$
declare
  v_shop public.shops;
begin
  select * into v_shop from public.shops where owner_id = p_owner_id for update;

  if not found then
    insert into public.shops
      (fps_id, owner_id, warehouse_id, name, district, taluk, address, pin_code, contact_phone, contact_email)
    values
      (p_fps_id, p_owner_id, p_warehouse_id, p_name, p_district, p_taluk, p_address, p_pin_code, p_contact_phone, p_contact_email)
    returning * into v_shop;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (p_owner_id, 'shop.registration_submitted', 'shop', v_shop.id::text,
            jsonb_build_object('fps_id', p_fps_id, 'warehouse_id', p_warehouse_id));
  elsif v_shop.status = 'rejected' then
    update public.shops
       set fps_id = p_fps_id, warehouse_id = p_warehouse_id, name = p_name, district = p_district,
           taluk = p_taluk, address = p_address, pin_code = p_pin_code, contact_phone = p_contact_phone,
           contact_email = p_contact_email, status = 'pending', review_reason = null,
           reviewed_by = null, reviewed_at = null, updated_at = now()
     where id = v_shop.id
    returning * into v_shop;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (p_owner_id, 'shop.registration_resubmitted', 'shop', v_shop.id::text,
            jsonb_build_object('fps_id', p_fps_id, 'warehouse_id', p_warehouse_id));
  else
    raise exception 'This account already has a % application', v_shop.status
      using errcode = 'P0001', hint = 'registration_exists';
  end if;

  return v_shop;
end;
$$;

-- Approves or rejects a pending application. The row lock serialises concurrent reviewers:
-- the second one sees the first decision and is refused, so a shop is decided exactly once.
create function public.review_shop(
  p_shop_id uuid,
  p_reviewer_id uuid,
  p_decision public.shop_status,
  p_reason text
) returns public.shops
language plpgsql set search_path = '' as $$
declare
  v_shop public.shops;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = 'P0001', hint = 'invalid_decision';
  end if;

  select * into v_shop from public.shops where id = p_shop_id for update;
  if not found or not exists (
    select 1 from public.warehouse_admins
     where user_id = p_reviewer_id and warehouse_id = v_shop.warehouse_id
  ) then
    raise exception 'No such application in your warehouses' using errcode = 'P0001', hint = 'shop_not_found';
  end if;
  if v_shop.status <> 'pending' then
    raise exception 'This application was already %', v_shop.status
      using errcode = 'P0001', hint = 'already_decided';
  end if;

  update public.shops
     set status = p_decision, review_reason = p_reason, reviewed_by = p_reviewer_id,
         reviewed_at = now(), updated_at = now()
   where id = p_shop_id
  returning * into v_shop;

  insert into public.shop_reviews (shop_id, decision, reason, reviewer_id)
  values (p_shop_id, p_decision, p_reason, p_reviewer_id);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason, details)
  values (p_reviewer_id, 'shop.' || p_decision::text, 'shop', p_shop_id::text, p_reason,
          jsonb_build_object('fps_id', v_shop.fps_id));

  if v_shop.owner_id is not null then
    insert into public.notifications (user_id, kind, title, body)
    values (v_shop.owner_id, 'shop.reviewed',
            case when p_decision = 'approved' then 'Your shop application was approved'
                 else 'Your shop application was not approved' end,
            p_reason);
  end if;

  return v_shop;
end;
$$;

-- Supporting documents in Supabase Storage -------------------------------------
-- Browsers upload with their own session into a folder named after their user id.
-- The API records an upload only after confirming the object exists in that folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-documents', 'shop-documents', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create function public.can_view_shop_document(p_object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.shop_documents d
      join public.shops s on s.id = d.shop_id
     where d.storage_path = p_object_name
       and (s.owner_id = auth.uid()
            or exists (select 1 from public.warehouse_admins wa
                        where wa.user_id = auth.uid() and wa.warehouse_id = s.warehouse_id))
  );
$$;

create policy "Users upload into their own document folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shop-documents' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Owners and their reviewing warehouse read shop documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shop-documents'
    and ((storage.foldername(name))[1] = (select auth.uid()::text) or public.can_view_shop_document(name))
  );

-- Access control ------------------------------------------------------------

alter table public.shop_reviews enable row level security;
alter table public.shop_documents enable row level security;
alter table public.stock_alerts enable row level security;

revoke all on public.shop_reviews, public.shop_documents, public.stock_alerts from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
-- Needed by the storage read policy above, which runs as the signed-in user.
grant execute on function public.can_view_shop_document(text) to authenticated;
