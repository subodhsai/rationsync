-- Phase 3: warehouse stock, replenishment requests, shipments and delivery reconciliation.
--
-- Stock rules, enforced here so they hold whatever the caller:
--   * Approving a request reserves warehouse stock. It adds nothing to the shop.
--   * Dispatch takes the reserved quantity out of warehouse stock; it is then in transit
--     on the shipment.
--   * The shop confirms what actually arrived. Only quantities received in good condition
--     are credited to shop stock; shortages and damage are recorded as discrepancies.
-- Shipments are tracked inside RationSync only. No delivery partner is integrated.

-- Helpers ---------------------------------------------------------------------

create function public.request_reference(p_number bigint) returns text
language sql immutable set search_path = '' as $$ select 'RQ-' || lpad(p_number::text, 5, '0') $$;

create function public.shipment_reference(p_number bigint) returns text
language sql immutable set search_path = '' as $$ select 'SH-' || lpad(p_number::text, 5, '0') $$;

create function public.notify_warehouse_admins(p_warehouse_id uuid, p_kind text, p_title text, p_body text) returns void
language sql set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body)
  select user_id, p_kind, p_title, p_body from public.warehouse_admins where warehouse_id = p_warehouse_id;
$$;

create function public.notify_shop_owner(p_shop_id uuid, p_kind text, p_title text, p_body text) returns void
language sql set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body)
  select owner_id, p_kind, p_title, p_body from public.shops where id = p_shop_id and owner_id is not null;
$$;

create function public.today_ist() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Shop stock targets ----------------------------------------------------------

-- The level a replenishment suggestion fills up to. Null means twice the threshold.
alter table public.shop_inventory
  add column target_stock numeric(12, 2),
  add constraint shop_inventory_target_above_threshold check (target_stock is null or target_stock > low_stock_threshold);

create function public.set_stock_levels(
  p_shop_id uuid,
  p_commodity_code text,
  p_threshold numeric,
  p_target numeric,
  p_actor_id uuid
) returns public.shop_inventory
language plpgsql set search_path = '' as $$
declare
  v_before public.shop_inventory;
  v_row public.shop_inventory;
begin
  select * into v_before from public.shop_inventory
   where shop_id = p_shop_id and commodity_code = p_commodity_code
   for update;
  if not found then
    raise exception 'Record an opening balance for this commodity first'
      using errcode = 'P0001', hint = 'commodity_not_stocked';
  end if;

  update public.shop_inventory set low_stock_threshold = p_threshold, target_stock = p_target
   where shop_id = p_shop_id and commodity_code = p_commodity_code
  returning * into v_row;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'inventory.stock_levels_changed', 'shop', p_shop_id::text,
          jsonb_build_object('commodity', p_commodity_code,
                             'threshold', jsonb_build_object('from', v_before.low_stock_threshold, 'to', p_threshold),
                             'target', jsonb_build_object('from', v_before.target_stock, 'to', p_target)));

  perform public.refresh_stock_alert(p_shop_id, p_commodity_code);
  return v_row;
end;
$$;

-- Same rule as Phase 2; a newly opened alert now also notifies the supplying warehouse.
create or replace function public.refresh_stock_alert(p_shop_id uuid, p_commodity_code text) returns void
language plpgsql set search_path = '' as $$
declare
  v_inventory public.shop_inventory;
  v_alert_id uuid;
  v_shop public.shops;
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
      select * into v_shop from public.shops where id = p_shop_id;
      select name_en, unit into v_name, v_unit from public.commodities where code = p_commodity_code;
      perform public.notify_shop_owner(p_shop_id, 'stock.low',
        format('%s is at or below its threshold', v_name),
        format('%s %s left. Threshold %s %s.', trim_scale(v_inventory.quantity), v_unit,
               trim_scale(v_inventory.low_stock_threshold), v_unit));
      perform public.notify_warehouse_admins(v_shop.warehouse_id, 'stock.low',
        format('%s: %s at or below threshold', v_shop.name, v_name),
        format('%s has %s %s of %s left. Threshold %s %s.', v_shop.fps_id, trim_scale(v_inventory.quantity), v_unit,
               lower(v_name), trim_scale(v_inventory.low_stock_threshold), v_unit));
    end if;
  else
    update public.stock_alerts
       set status = 'resolved', resolved_at = now(), quantity_at_resolve = v_inventory.quantity
     where shop_id = p_shop_id and commodity_code = p_commodity_code and status = 'open';
  end if;
end;
$$;

-- Warehouse stock -------------------------------------------------------------

create type public.warehouse_movement_kind as enum ('opening_balance', 'receipt', 'adjustment', 'dispatch');

-- Available stock is quantity_on_hand - quantity_reserved. The check below is what stops
-- two approvals, however concurrent, from reserving the same stock twice.
create table public.warehouse_inventory (
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  commodity_code text not null references public.commodities (code),
  quantity_on_hand numeric(12, 2) not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved numeric(12, 2) not null default 0 check (quantity_reserved >= 0),
  low_stock_threshold numeric(12, 2) not null default 0 check (low_stock_threshold >= 0),
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, commodity_code),
  constraint warehouse_inventory_reserved_within_on_hand check (quantity_reserved <= quantity_on_hand)
);

create table public.warehouse_stock_movements (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  commodity_code text not null references public.commodities (code),
  kind public.warehouse_movement_kind not null,
  quantity_delta numeric(12, 2) not null check (quantity_delta <> 0),
  balance_after numeric(12, 2) not null check (balance_after >= 0),
  reason text not null check (char_length(reason) between 3 and 500),
  reference text check (char_length(reference) <= 100),
  shipment_id uuid,
  actor_id uuid references public.profiles (id),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (warehouse_id, idempotency_key),
  constraint warehouse_stock_movements_direction check (
    (kind in ('opening_balance', 'receipt') and quantity_delta > 0)
    or (kind = 'dispatch' and quantity_delta < 0)
    or kind = 'adjustment'
  )
);
create index warehouse_stock_movements_created_idx on public.warehouse_stock_movements (warehouse_id, created_at desc);
create unique index warehouse_stock_movements_one_opening_balance
  on public.warehouse_stock_movements (warehouse_id, commodity_code) where kind = 'opening_balance';
create trigger warehouse_stock_movements_append_only before update or delete on public.warehouse_stock_movements
  for each row execute function public.prevent_mutation();
create trigger warehouse_stock_movements_no_truncate before truncate on public.warehouse_stock_movements
  for each statement execute function public.prevent_mutation();

-- Opening balances, receipts from the state supply chain (entered by hand; no upstream
-- system is integrated) and adjustments. Dispatches are written by dispatch_shipment().
-- A null actor is used only by the demo seed.
create function public.apply_warehouse_movement(
  p_warehouse_id uuid,
  p_commodity_code text,
  p_kind public.warehouse_movement_kind,
  p_quantity_delta numeric,
  p_reason text,
  p_reference text,
  p_actor_id uuid,
  p_idempotency_key text
) returns public.warehouse_stock_movements
language plpgsql set search_path = '' as $$
declare
  v_movement public.warehouse_stock_movements;
  v_balance numeric;
begin
  select * into v_movement from public.warehouse_stock_movements
   where warehouse_id = p_warehouse_id and idempotency_key = p_idempotency_key;
  if found then
    return v_movement;
  end if;

  if p_actor_id is not null and not exists (
    select 1 from public.warehouse_admins where user_id = p_actor_id and warehouse_id = p_warehouse_id
  ) then
    raise exception 'No such warehouse in your assignments' using errcode = 'P0001', hint = 'warehouse_not_found';
  end if;
  if p_kind = 'dispatch' then
    raise exception 'Dispatches are recorded through shipments' using errcode = 'P0001', hint = 'invalid_movement';
  end if;

  insert into public.warehouse_inventory (warehouse_id, commodity_code)
  values (p_warehouse_id, p_commodity_code)
  on conflict do nothing;

  update public.warehouse_inventory
     set quantity_on_hand = quantity_on_hand + p_quantity_delta, updated_at = now()
   where warehouse_id = p_warehouse_id and commodity_code = p_commodity_code
  returning quantity_on_hand into v_balance;

  insert into public.warehouse_stock_movements
    (warehouse_id, commodity_code, kind, quantity_delta, balance_after, reason, reference, actor_id, idempotency_key)
  values
    (p_warehouse_id, p_commodity_code, p_kind, p_quantity_delta, v_balance, p_reason, p_reference, p_actor_id, p_idempotency_key)
  returning * into v_movement;
  return v_movement;
end;
$$;

create function public.set_warehouse_threshold(
  p_warehouse_id uuid,
  p_commodity_code text,
  p_threshold numeric,
  p_actor_id uuid
) returns public.warehouse_inventory
language plpgsql set search_path = '' as $$
declare
  v_before numeric;
  v_row public.warehouse_inventory;
begin
  if not exists (select 1 from public.warehouse_admins where user_id = p_actor_id and warehouse_id = p_warehouse_id) then
    raise exception 'No such warehouse in your assignments' using errcode = 'P0001', hint = 'warehouse_not_found';
  end if;
  select low_stock_threshold into v_before from public.warehouse_inventory
   where warehouse_id = p_warehouse_id and commodity_code = p_commodity_code
   for update;
  if not found then
    raise exception 'Record an opening balance for this commodity first'
      using errcode = 'P0001', hint = 'commodity_not_stocked';
  end if;

  update public.warehouse_inventory set low_stock_threshold = p_threshold
   where warehouse_id = p_warehouse_id and commodity_code = p_commodity_code
  returning * into v_row;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'warehouse_stock.threshold_changed', 'warehouse', p_warehouse_id::text,
          jsonb_build_object('commodity', p_commodity_code, 'from', v_before, 'to', p_threshold));
  return v_row;
end;
$$;

-- Replenishment requests ------------------------------------------------------

create type public.request_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'partially_fulfilled', 'fulfilled', 'cancelled');

create table public.replenishment_requests (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  shop_id uuid not null references public.shops (id) on delete restrict,
  -- Copied from the shop when the request is made; never taken from the client.
  warehouse_id uuid not null references public.warehouses (id),
  commodity_code text not null references public.commodities (code),
  requested_quantity numeric(12, 2) not null check (requested_quantity > 0),
  stock_at_request numeric(12, 2) not null check (stock_at_request >= 0),
  suggested_quantity numeric(12, 2) check (suggested_quantity >= 0),
  reason text not null check (char_length(reason) between 3 and 500),
  priority public.request_priority not null default 'normal',
  status public.request_status not null default 'pending',
  approved_quantity numeric(12, 2),
  decision_reason text check (char_length(decision_reason) between 3 and 500),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  received_quantity numeric(12, 2) check (received_quantity >= 0),
  closed_at timestamptz,
  requested_by uuid references public.profiles (id),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, idempotency_key),
  constraint replenishment_requests_approved_within_requested check (
    approved_quantity is null or (approved_quantity > 0 and approved_quantity <= requested_quantity)),
  constraint replenishment_requests_approval_recorded check (
    (status in ('approved', 'partially_fulfilled', 'fulfilled')) = (approved_quantity is not null)),
  constraint replenishment_requests_decision_recorded check (
    status in ('pending', 'cancelled') or (decided_at is not null and decided_by is not null and decision_reason is not null)),
  constraint replenishment_requests_closed check (
    (status in ('partially_fulfilled', 'fulfilled')) = (received_quantity is not null))
);
-- One open request per shop and commodity, so a resubmitted form cannot duplicate it.
create unique index replenishment_requests_one_open
  on public.replenishment_requests (shop_id, commodity_code) where status in ('pending', 'approved');
create index replenishment_requests_warehouse_idx on public.replenishment_requests (warehouse_id, status, created_at desc);
create index replenishment_requests_shop_idx on public.replenishment_requests (shop_id, created_at desc);

create function public.create_replenishment_request(
  p_shop_id uuid,
  p_actor_id uuid,
  p_commodity_code text,
  p_quantity numeric,
  p_reason text,
  p_priority public.request_priority,
  p_suggested_quantity numeric,
  p_idempotency_key text
) returns public.replenishment_requests
language plpgsql set search_path = '' as $$
declare
  v_request public.replenishment_requests;
  v_shop public.shops;
  v_stock numeric;
  v_name text;
  v_unit text;
begin
  select * into v_request from public.replenishment_requests
   where shop_id = p_shop_id and idempotency_key = p_idempotency_key;
  if found then
    return v_request;
  end if;

  select * into v_shop from public.shops where id = p_shop_id and owner_id = p_actor_id and status = 'approved';
  if not found then
    raise exception 'Requests can only be made for your own approved shop'
      using errcode = 'P0001', hint = 'shop_not_approved';
  end if;
  select quantity into v_stock from public.shop_inventory where shop_id = p_shop_id and commodity_code = p_commodity_code;

  insert into public.replenishment_requests
    (shop_id, warehouse_id, commodity_code, requested_quantity, stock_at_request, suggested_quantity,
     reason, priority, requested_by, idempotency_key)
  values
    (p_shop_id, v_shop.warehouse_id, p_commodity_code, p_quantity, coalesce(v_stock, 0), p_suggested_quantity,
     p_reason, p_priority, p_actor_id, p_idempotency_key)
  returning * into v_request;

  select name_en, unit into v_name, v_unit from public.commodities where code = p_commodity_code;
  perform public.notify_warehouse_admins(v_shop.warehouse_id, 'request.submitted',
    format('%s requested %s %s of %s', v_shop.name, trim_scale(p_quantity), v_unit, lower(v_name)),
    format('%s, %s priority. %s', public.request_reference(v_request.number), p_priority, p_reason));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason, details)
  values (p_actor_id, 'request.submitted', 'replenishment_request', v_request.id::text, p_reason,
          jsonb_build_object('reference', public.request_reference(v_request.number), 'commodity', p_commodity_code,
                             'quantity', p_quantity, 'priority', p_priority, 'suggested', p_suggested_quantity));
  return v_request;
end;
$$;

create function public.cancel_replenishment_request(p_request_id uuid, p_actor_id uuid)
returns public.replenishment_requests
language plpgsql set search_path = '' as $$
declare
  v_request public.replenishment_requests;
begin
  select r.* into v_request from public.replenishment_requests r
    join public.shops s on s.id = r.shop_id
   where r.id = p_request_id and s.owner_id = p_actor_id
   for update of r;
  if not found then
    raise exception 'No such request for your shop' using errcode = 'P0001', hint = 'request_not_found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a pending request can be cancelled; this one is %', v_request.status
      using errcode = 'P0001', hint = 'request_not_pending';
  end if;

  update public.replenishment_requests set status = 'cancelled', closed_at = now(), updated_at = now()
   where id = p_request_id
  returning * into v_request;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'request.cancelled', 'replenishment_request', p_request_id::text,
          jsonb_build_object('reference', public.request_reference(v_request.number)));
  return v_request;
end;
$$;

-- Approves (fully or for less than requested) or rejects a pending request. The request row
-- lock decides it exactly once; the inventory update reserves stock under the warehouse
-- row's lock, and warehouse_inventory_reserved_within_on_hand refuses any over-allocation.
create function public.decide_replenishment_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_approved_quantity numeric,
  p_reason text
) returns public.replenishment_requests
language plpgsql set search_path = '' as $$
declare
  v_request public.replenishment_requests;
  v_name text;
  v_unit text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = 'P0001', hint = 'invalid_decision';
  end if;

  select * into v_request from public.replenishment_requests where id = p_request_id for update;
  if not found or not exists (
    select 1 from public.warehouse_admins where user_id = p_actor_id and warehouse_id = v_request.warehouse_id
  ) then
    raise exception 'No such request in your warehouses' using errcode = 'P0001', hint = 'request_not_found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request was already %', v_request.status using errcode = 'P0001', hint = 'already_decided';
  end if;

  select name_en, unit into v_name, v_unit from public.commodities where code = v_request.commodity_code;

  if p_decision = 'approved' then
    if p_approved_quantity is null or p_approved_quantity <= 0 or p_approved_quantity > v_request.requested_quantity then
      raise exception 'Approve between 0 and the % % requested', trim_scale(v_request.requested_quantity), v_unit
        using errcode = 'P0001', hint = 'invalid_quantity';
    end if;
    update public.warehouse_inventory
       set quantity_reserved = quantity_reserved + p_approved_quantity, updated_at = now()
     where warehouse_id = v_request.warehouse_id and commodity_code = v_request.commodity_code;
    if not found then
      raise exception 'The warehouse holds no % to reserve', lower(v_name)
        using errcode = 'P0001', hint = 'insufficient_warehouse_stock';
    end if;
    update public.replenishment_requests
       set status = 'approved', approved_quantity = p_approved_quantity, decision_reason = p_reason,
           decided_by = p_actor_id, decided_at = now(), updated_at = now()
     where id = p_request_id
    returning * into v_request;
  else
    update public.replenishment_requests
       set status = 'rejected', decision_reason = p_reason, decided_by = p_actor_id, decided_at = now(),
           closed_at = now(), updated_at = now()
     where id = p_request_id
    returning * into v_request;
  end if;

  perform public.notify_shop_owner(v_request.shop_id, 'request.decided',
    case when p_decision = 'rejected' then format('%s was not approved', public.request_reference(v_request.number))
         when p_approved_quantity < v_request.requested_quantity
           then format('%s approved for %s of %s %s', public.request_reference(v_request.number),
                       trim_scale(p_approved_quantity), trim_scale(v_request.requested_quantity), v_unit)
         else format('%s approved', public.request_reference(v_request.number)) end,
    p_reason);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason, details)
  values (p_actor_id, 'request.' || p_decision, 'replenishment_request', p_request_id::text, p_reason,
          jsonb_build_object('reference', public.request_reference(v_request.number),
                             'requested', v_request.requested_quantity, 'approved', p_approved_quantity,
                             'partial', p_decision = 'approved' and p_approved_quantity < v_request.requested_quantity));
  return v_request;
end;
$$;

-- Shipments -------------------------------------------------------------------

create type public.shipment_status as enum (
  'preparing', 'dispatched', 'in_transit', 'delivered', 'partially_received', 'disputed', 'cancelled'
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  warehouse_id uuid not null references public.warehouses (id),
  shop_id uuid not null references public.shops (id),
  status public.shipment_status not null default 'preparing',
  expected_delivery_date date not null,
  notes text check (char_length(notes) <= 500),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  dispatched_by uuid references public.profiles (id),
  dispatched_at timestamptz,
  in_transit_at timestamptz,
  received_by uuid references public.profiles (id),
  received_at timestamptz,
  receipt_note text check (char_length(receipt_note) <= 500),
  disputed_by uuid references public.profiles (id),
  disputed_at timestamptz,
  dispute_reason text check (char_length(dispute_reason) between 3 and 500),
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) between 3 and 500),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  updated_at timestamptz not null default now(),
  unique (created_by, idempotency_key),
  check ((dispatched_at is not null) = (status not in ('preparing', 'cancelled'))),
  check ((received_at is not null) = (status in ('delivered', 'partially_received'))),
  check ((cancelled_at is not null) = (status = 'cancelled') and (status <> 'cancelled' or cancel_reason is not null))
);
create index shipments_warehouse_idx on public.shipments (warehouse_id, status, created_at desc);
create index shipments_shop_idx on public.shipments (shop_id, created_at desc);

alter table public.warehouse_stock_movements
  add constraint warehouse_stock_movements_shipment_id_fkey foreign key (shipment_id) references public.shipments (id);

-- The only status changes a shipment may make. Mirrored in packages/shared for the UI.
create function public.enforce_shipment_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if (old.status::text || '>' || new.status::text) <> all (array[
    'preparing>dispatched', 'preparing>cancelled',
    'dispatched>in_transit', 'dispatched>delivered', 'dispatched>partially_received', 'dispatched>disputed',
    'in_transit>delivered', 'in_transit>partially_received', 'in_transit>disputed',
    'disputed>delivered', 'disputed>partially_received'
  ]) then
    raise exception 'A shipment cannot move from % to %', old.status, new.status
      using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger shipments_status_transition before update of status on public.shipments
  for each row execute function public.enforce_shipment_transition();

create table public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  request_id uuid not null references public.replenishment_requests (id),
  commodity_code text not null references public.commodities (code),
  quantity numeric(12, 2) not null check (quantity > 0),
  received_quantity numeric(12, 2) check (received_quantity >= 0),
  damaged_quantity numeric(12, 2) check (damaged_quantity >= 0),
  unique (shipment_id, request_id),
  check ((received_quantity is null) = (damaged_quantity is null)),
  constraint shipment_items_receipt_within_dispatched check (received_quantity + damaged_quantity <= quantity)
);
create index shipment_items_request_idx on public.shipment_items (request_id);

create type public.discrepancy_status as enum ('open', 'resolved');

create table public.delivery_discrepancies (
  id uuid primary key default gen_random_uuid(),
  shipment_item_id uuid not null unique references public.shipment_items (id),
  shipment_id uuid not null references public.shipments (id),
  shortage_quantity numeric(12, 2) not null check (shortage_quantity >= 0),
  damaged_quantity numeric(12, 2) not null check (damaged_quantity >= 0),
  status public.discrepancy_status not null default 'open',
  resolution text check (char_length(resolution) between 3 and 500),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (shortage_quantity + damaged_quantity > 0),
  check ((status = 'resolved') = (resolved_at is not null and resolution is not null and resolved_by is not null))
);
create index delivery_discrepancies_shipment_idx on public.delivery_discrepancies (shipment_id);

-- Groups approved requests for one shop into a shipment being prepared. Stock stays reserved
-- (not yet moved) until dispatch. A request can be on only one shipment that is not cancelled.
create function public.create_shipment(
  p_actor_id uuid,
  p_shop_id uuid,
  p_request_ids uuid[],
  p_expected_delivery_date date,
  p_notes text,
  p_idempotency_key text
) returns public.shipments
language plpgsql set search_path = '' as $$
declare
  v_shipment public.shipments;
  v_shop public.shops;
  v_count integer;
begin
  select * into v_shipment from public.shipments where created_by = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    return v_shipment;
  end if;

  select * into v_shop from public.shops where id = p_shop_id and status = 'approved';
  if not found or not exists (
    select 1 from public.warehouse_admins where user_id = p_actor_id and warehouse_id = v_shop.warehouse_id
  ) then
    raise exception 'No such shop in your warehouses' using errcode = 'P0001', hint = 'shop_not_found';
  end if;
  if coalesce(cardinality(p_request_ids), 0) = 0 then
    raise exception 'Choose at least one approved request' using errcode = 'P0001', hint = 'no_items';
  end if;
  if p_expected_delivery_date < public.today_ist() then
    raise exception 'The expected delivery date cannot be in the past' using errcode = 'P0001', hint = 'invalid_date';
  end if;

  -- Lock the requests so two shipments cannot claim the same one.
  perform 1 from public.replenishment_requests where id = any(p_request_ids) for update;
  select count(*) into v_count
    from public.replenishment_requests r
   where r.id = any(p_request_ids)
     and r.shop_id = p_shop_id
     and r.warehouse_id = v_shop.warehouse_id
     and r.status = 'approved'
     and not exists (
       select 1 from public.shipment_items si join public.shipments s on s.id = si.shipment_id
        where si.request_id = r.id and s.status <> 'cancelled');
  if v_count <> (select count(distinct x) from unnest(p_request_ids) x) then
    raise exception 'Every request must be approved, for this shop, and not already on a shipment'
      using errcode = 'P0001', hint = 'request_not_shippable';
  end if;

  insert into public.shipments (warehouse_id, shop_id, expected_delivery_date, notes, created_by, idempotency_key)
  values (v_shop.warehouse_id, p_shop_id, p_expected_delivery_date, nullif(trim(p_notes), ''), p_actor_id, p_idempotency_key)
  returning * into v_shipment;
  insert into public.shipment_items (shipment_id, request_id, commodity_code, quantity)
  select v_shipment.id, r.id, r.commodity_code, r.approved_quantity
    from public.replenishment_requests r where r.id = any(p_request_ids);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'shipment.created', 'shipment', v_shipment.id::text,
          jsonb_build_object('reference', public.shipment_reference(v_shipment.number), 'shop', v_shop.fps_id,
                             'requests', to_jsonb(p_request_ids)));
  return v_shipment;
end;
$$;

-- Locks a shipment and checks the warehouse administrator's scope.
create function public.lock_warehouse_shipment(p_shipment_id uuid, p_actor_id uuid) returns public.shipments
language plpgsql set search_path = '' as $$
declare
  v_shipment public.shipments;
begin
  select * into v_shipment from public.shipments where id = p_shipment_id for update;
  if not found or not exists (
    select 1 from public.warehouse_admins where user_id = p_actor_id and warehouse_id = v_shipment.warehouse_id
  ) then
    raise exception 'No such shipment in your warehouses' using errcode = 'P0001', hint = 'shipment_not_found';
  end if;
  return v_shipment;
end;
$$;

-- Moves the reserved stock out of the warehouse. Each item's ledger entry is keyed by the
-- item, so a repeated dispatch can never deduct stock twice.
create function public.dispatch_shipment(p_shipment_id uuid, p_actor_id uuid, p_expected_delivery_date date)
returns public.shipments
language plpgsql set search_path = '' as $$
declare
  v_shipment public.shipments;
  v_item public.shipment_items;
  v_balance numeric;
  v_ref text;
  v_fps text;
begin
  v_shipment := public.lock_warehouse_shipment(p_shipment_id, p_actor_id);
  if v_shipment.status <> 'preparing' then
    raise exception 'This shipment is already %', v_shipment.status using errcode = 'P0001', hint = 'already_dispatched';
  end if;
  if p_expected_delivery_date is not null and p_expected_delivery_date < public.today_ist() then
    raise exception 'The expected delivery date cannot be in the past' using errcode = 'P0001', hint = 'invalid_date';
  end if;

  v_ref := public.shipment_reference(v_shipment.number);
  select fps_id into v_fps from public.shops where id = v_shipment.shop_id;
  for v_item in select * from public.shipment_items where shipment_id = p_shipment_id order by commodity_code loop
    update public.warehouse_inventory
       set quantity_on_hand = quantity_on_hand - v_item.quantity,
           quantity_reserved = quantity_reserved - v_item.quantity,
           updated_at = now()
     where warehouse_id = v_shipment.warehouse_id and commodity_code = v_item.commodity_code
    returning quantity_on_hand into v_balance;
    insert into public.warehouse_stock_movements
      (warehouse_id, commodity_code, kind, quantity_delta, balance_after, reason, reference, shipment_id, actor_id, idempotency_key)
    values
      (v_shipment.warehouse_id, v_item.commodity_code, 'dispatch', -v_item.quantity, v_balance,
       format('Dispatched to %s', v_fps), v_ref, p_shipment_id, p_actor_id, 'dispatch-' || v_item.id);
  end loop;

  update public.shipments
     set status = 'dispatched', dispatched_by = p_actor_id, dispatched_at = now(),
         expected_delivery_date = coalesce(p_expected_delivery_date, expected_delivery_date)
   where id = p_shipment_id
  returning * into v_shipment;

  perform public.notify_shop_owner(v_shipment.shop_id, 'shipment.dispatched', format('%s is on its way', v_ref),
    format('Expected by %s. Confirm the quantities that arrive.', to_char(v_shipment.expected_delivery_date, 'DD Mon YYYY')));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'shipment.dispatched', 'shipment', p_shipment_id::text,
          jsonb_build_object('reference', v_ref, 'expected_delivery_date', v_shipment.expected_delivery_date));
  return v_shipment;
end;
$$;

create function public.mark_shipment_in_transit(p_shipment_id uuid, p_actor_id uuid) returns public.shipments
language plpgsql set search_path = '' as $$
declare
  v_shipment public.shipments;
begin
  v_shipment := public.lock_warehouse_shipment(p_shipment_id, p_actor_id);
  update public.shipments set status = 'in_transit', in_transit_at = now() where id = p_shipment_id
  returning * into v_shipment;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'shipment.in_transit', 'shipment', p_shipment_id::text,
          jsonb_build_object('reference', public.shipment_reference(v_shipment.number)));
  return v_shipment;
end;
$$;

-- Only before dispatch. The requests stay approved, with their stock still reserved, and
-- can be put on another shipment.
create function public.cancel_shipment(p_shipment_id uuid, p_actor_id uuid, p_reason text) returns public.shipments
language plpgsql set search_path = '' as $$
declare
  v_shipment public.shipments;
begin
  v_shipment := public.lock_warehouse_shipment(p_shipment_id, p_actor_id);
  update public.shipments
     set status = 'cancelled', cancelled_by = p_actor_id, cancelled_at = now(), cancel_reason = p_reason
   where id = p_shipment_id
  returning * into v_shipment;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason, details)
  values (p_actor_id, 'shipment.cancelled', 'shipment', p_shipment_id::text, p_reason,
          jsonb_build_object('reference', public.shipment_reference(v_shipment.number)));
  return v_shipment;
end;
$$;

create function public.lock_shop_shipment(p_shipment_id uuid, p_actor_id uuid) returns public.shipments
language plpgsql set search_path = '' as $$
declare
  v_shipment public.shipments;
begin
  select * into v_shipment from public.shipments where id = p_shipment_id for update;
  if not found or not exists (
    select 1 from public.shops where id = v_shipment.shop_id and owner_id = p_actor_id and status = 'approved'
  ) then
    raise exception 'No such shipment for your shop' using errcode = 'P0001', hint = 'shipment_not_found';
  end if;
  return v_shipment;
end;
$$;

-- The shop states what arrived in good condition and what arrived damaged, per item.
-- p_items: [{"itemId": uuid, "receivedQuantity": n, "damagedQuantity": n}, ...], one per item.
create function public.receive_shipment(p_shipment_id uuid, p_actor_id uuid, p_items jsonb, p_note text)
returns public.shipments
language plpgsql set search_path = '' as $$
declare
  v_shipment public.shipments;
  v_item public.shipment_items;
  v_ref text;
  v_received numeric;
  v_damaged numeric;
  v_shortage numeric;
  v_discrepancies integer := 0;
begin
  v_shipment := public.lock_shop_shipment(p_shipment_id, p_actor_id);
  if v_shipment.status in ('delivered', 'partially_received') then
    raise exception 'This delivery was already confirmed' using errcode = 'P0001', hint = 'already_received';
  elsif v_shipment.status not in ('dispatched', 'in_transit', 'disputed') then
    raise exception 'Only a dispatched shipment can be received; this one is %', v_shipment.status
      using errcode = 'P0001', hint = 'not_receivable';
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) <> (select count(*) from public.shipment_items where shipment_id = p_shipment_id)
     or exists (
       select 1 from public.shipment_items si
        where si.shipment_id = p_shipment_id
          and not exists (select 1 from jsonb_array_elements(p_items) e where e ->> 'itemId' = si.id::text)) then
    raise exception 'Enter quantities for every item on the shipment' using errcode = 'P0001', hint = 'items_mismatch';
  end if;

  v_ref := public.shipment_reference(v_shipment.number);
  for v_item in select * from public.shipment_items where shipment_id = p_shipment_id order by commodity_code loop
    select (e ->> 'receivedQuantity')::numeric, (e ->> 'damagedQuantity')::numeric
      into v_received, v_damaged
      from jsonb_array_elements(p_items) e
     where e ->> 'itemId' = v_item.id::text
     limit 1;
    if v_received is null or v_damaged is null or v_received < 0 or v_damaged < 0
       or v_received + v_damaged > v_item.quantity then
      raise exception 'Received and damaged quantities must add up to no more than the % dispatched',
        trim_scale(v_item.quantity) using errcode = 'P0001', hint = 'receipt_exceeds_dispatch';
    end if;

    update public.shipment_items set received_quantity = v_received, damaged_quantity = v_damaged
     where id = v_item.id;

    -- Only what arrived in good condition becomes shop stock.
    if v_received > 0 then
      perform public.apply_stock_movement(v_shipment.shop_id, v_item.commodity_code, 'receipt', v_received,
        format('Received in shipment %s', v_ref), p_actor_id, 'shipment-item-' || v_item.id, v_ref);
    end if;

    v_shortage := v_item.quantity - v_received - v_damaged;
    if v_shortage > 0 or v_damaged > 0 then
      v_discrepancies := v_discrepancies + 1;
      insert into public.delivery_discrepancies (shipment_item_id, shipment_id, shortage_quantity, damaged_quantity)
      values (v_item.id, p_shipment_id, v_shortage, v_damaged);
    end if;

    update public.replenishment_requests
       set received_quantity = v_received,
           status = (case when v_received >= approved_quantity then 'fulfilled' else 'partially_fulfilled' end)::public.request_status,
           closed_at = now(), updated_at = now()
     where id = v_item.request_id;
  end loop;

  if v_discrepancies > 0 and char_length(coalesce(trim(p_note), '')) < 3 then
    raise exception 'Say what was missing or damaged' using errcode = 'P0001', hint = 'note_required';
  end if;

  update public.shipments
     set status = case when v_discrepancies > 0 then 'partially_received' else 'delivered' end::public.shipment_status,
         received_by = p_actor_id, received_at = now(), receipt_note = nullif(trim(p_note), '')
   where id = p_shipment_id
  returning * into v_shipment;

  if v_discrepancies > 0 then
    perform public.notify_warehouse_admins(v_shipment.warehouse_id, 'shipment.discrepancy',
      format('%s received with %s discrepanc%s', v_ref, v_discrepancies, case when v_discrepancies = 1 then 'y' else 'ies' end),
      coalesce(v_shipment.receipt_note, ''));
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason, details)
  values (p_actor_id, 'shipment.received', 'shipment', p_shipment_id::text, v_shipment.receipt_note,
          jsonb_build_object('reference', v_ref, 'status', v_shipment.status, 'items', p_items));
  return v_shipment;
end;
$$;

-- For a shipment that has not arrived, or arrived with the wrong goods. The shop can still
-- confirm receipt later.
create function public.dispute_shipment(p_shipment_id uuid, p_actor_id uuid, p_reason text) returns public.shipments
language plpgsql set search_path = '' as $$
declare
  v_shipment public.shipments;
begin
  v_shipment := public.lock_shop_shipment(p_shipment_id, p_actor_id);
  update public.shipments
     set status = 'disputed', disputed_by = p_actor_id, disputed_at = now(), dispute_reason = p_reason
   where id = p_shipment_id
  returning * into v_shipment;
  perform public.notify_warehouse_admins(v_shipment.warehouse_id, 'shipment.disputed',
    format('%s was disputed by the shop', public.shipment_reference(v_shipment.number)), p_reason);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason, details)
  values (p_actor_id, 'shipment.disputed', 'shipment', p_shipment_id::text, p_reason,
          jsonb_build_object('reference', public.shipment_reference(v_shipment.number)));
  return v_shipment;
end;
$$;

-- Records how a discrepancy was settled. It moves no stock: replacement goods go out on a
-- new request and shipment, so every quantity stays traceable.
create function public.resolve_discrepancy(p_discrepancy_id uuid, p_actor_id uuid, p_resolution text)
returns public.delivery_discrepancies
language plpgsql set search_path = '' as $$
declare
  v_row public.delivery_discrepancies;
begin
  select d.* into v_row from public.delivery_discrepancies d
    join public.shipments s on s.id = d.shipment_id
   where d.id = p_discrepancy_id
     and exists (select 1 from public.warehouse_admins wa where wa.user_id = p_actor_id and wa.warehouse_id = s.warehouse_id)
   for update of d;
  if not found then
    raise exception 'No such discrepancy in your warehouses' using errcode = 'P0001', hint = 'discrepancy_not_found';
  end if;
  if v_row.status = 'resolved' then
    raise exception 'This discrepancy was already resolved' using errcode = 'P0001', hint = 'already_resolved';
  end if;

  update public.delivery_discrepancies
     set status = 'resolved', resolution = p_resolution, resolved_by = p_actor_id, resolved_at = now()
   where id = p_discrepancy_id
  returning * into v_row;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, reason, details)
  values (p_actor_id, 'discrepancy.resolved', 'shipment', v_row.shipment_id::text, p_resolution,
          jsonb_build_object('discrepancy', p_discrepancy_id, 'shortage', v_row.shortage_quantity,
                             'damaged', v_row.damaged_quantity));
  return v_row;
end;
$$;

-- Notifications ---------------------------------------------------------------

create function public.mark_notifications_read(p_user_id uuid) returns integer
language sql set search_path = '' as $$
  with updated as (
    update public.notifications set read_at = now() where user_id = p_user_id and read_at is null returning 1
  )
  select count(*)::integer from updated;
$$;

create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

-- Access control ----------------------------------------------------------------

alter table public.warehouse_inventory enable row level security;
alter table public.warehouse_stock_movements enable row level security;
alter table public.replenishment_requests enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_items enable row level security;
alter table public.delivery_discrepancies enable row level security;

revoke all on public.warehouse_inventory, public.warehouse_stock_movements, public.replenishment_requests,
  public.shipments, public.shipment_items, public.delivery_discrepancies from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
-- Re-grant the one function the Storage read policy needs (revoked again by the line above).
grant execute on function public.can_view_shop_document(text) to authenticated;
