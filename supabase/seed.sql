-- RationSync demo seed. FICTIONAL DATA ONLY.
-- Warehouses, shops, FPS IDs, phone numbers, households and ration-card numbers below are
-- invented for an educational prototype. None of them are official Karnataka records.
--
-- Seeded shops have no owner account. Demo user accounts are created through the normal
-- sign-up flow, and warehouse administrators through public.provision_warehouse_admin().

insert into public.warehouses (id, code, name, district, taluk, address) values
  ('0d9a0000-0000-4000-a000-000000000001', 'DEMO-WH-MYS', 'Demo Wholesale Point, Mysuru', 'Mysuru', 'Mysuru',
   'Shed 4, Demo Market Yard, Bannimantap, Mysuru'),
  ('0d9a0000-0000-4000-a000-000000000002', 'DEMO-WH-DWD', 'Demo Wholesale Point, Hubballi', 'Dharwad', 'Hubballi',
   'Shed 2, Demo APMC Yard, Amargol, Hubballi');

insert into public.shops
  (id, fps_id, warehouse_id, name, district, taluk, address, pin_code, contact_phone, opening_hours, status, review_reason, reviewed_at)
values
  ('0d9a0000-0000-4000-b000-000000000101', 'DEMO-FPS-MYS-0101', '0d9a0000-0000-4000-a000-000000000001',
   'Demo FPS Kuvempunagar', 'Mysuru', 'Mysuru', '2nd Cross, Kuvempunagar, Mysuru', '570023',
   '+91 90000 00101', 'Mon to Sat, 8:00 to 12:00 and 16:00 to 20:00', 'approved', 'Demo seed record', now()),
  ('0d9a0000-0000-4000-b000-000000000102', 'DEMO-FPS-MYS-0102', '0d9a0000-0000-4000-a000-000000000001',
   'Demo FPS Vijayanagar', 'Mysuru', 'Mysuru', '4th Main, Vijayanagar 2nd Stage, Mysuru', '570017',
   '+91 90000 00102', 'Mon to Sat, 8:00 to 12:00 and 16:00 to 20:00', 'approved', 'Demo seed record', now()),
  ('0d9a0000-0000-4000-b000-000000000201', 'DEMO-FPS-DWD-0201', '0d9a0000-0000-4000-a000-000000000002',
   'Demo FPS Vidyanagar', 'Dharwad', 'Hubballi', 'Near Bus Stop, Vidyanagar, Hubballi', '580021',
   '+91 90000 00201', 'Mon to Sat, 8:30 to 12:30 and 16:00 to 19:30', 'approved', 'Demo seed record', now()),
  ('0d9a0000-0000-4000-b000-000000000202', 'DEMO-FPS-DWD-0202', '0d9a0000-0000-4000-a000-000000000002',
   'Demo FPS Keshwapur', 'Dharwad', 'Hubballi', 'Market Road, Keshwapur, Hubballi', '580023',
   '+91 90000 00202', 'Mon to Sat, 8:30 to 12:30 and 16:00 to 19:30', 'approved', 'Demo seed record', now());

-- Opening balances go through the same function as every later movement, so each
-- balance has a ledger entry behind it. Some rows start at or below their threshold.
select public.apply_stock_movement(s.shop_id::uuid, s.code, 'opening_balance', s.qty,
                                   'Demo opening balance', null, 'seed-opening-' || s.shop_id || '-' || s.code)
from (values
  ('0d9a0000-0000-4000-b000-000000000101', 'RICE', 2400.00),
  ('0d9a0000-0000-4000-b000-000000000101', 'WHEAT', 120.00),
  ('0d9a0000-0000-4000-b000-000000000101', 'RAGI', 410.00),
  ('0d9a0000-0000-4000-b000-000000000101', 'SUGAR', 60.00),
  ('0d9a0000-0000-4000-b000-000000000102', 'RICE', 960.00),
  ('0d9a0000-0000-4000-b000-000000000102', 'RAGI', 520.00),
  ('0d9a0000-0000-4000-b000-000000000102', 'SUGAR', 90.00),
  ('0d9a0000-0000-4000-b000-000000000201', 'RICE', 2210.00),
  ('0d9a0000-0000-4000-b000-000000000201', 'WHEAT', 340.00),
  ('0d9a0000-0000-4000-b000-000000000201', 'JOWAR', 180.00),
  ('0d9a0000-0000-4000-b000-000000000202', 'RICE', 640.00),
  ('0d9a0000-0000-4000-b000-000000000202', 'JOWAR', 610.00)
) as s (shop_id, code, qty);

-- A little ledger history for the first shop. Final balances: rice 1,840 kg, sugar 35 kg.
select public.apply_stock_movement('0d9a0000-0000-4000-b000-000000000101', m.code, 'distribution', m.qty,
                                   m.reason, null, m.key)
from (values
  ('RICE', -320.00, 'Distributed to card holders, morning session', 'seed-dist-0101-1'),
  ('RICE', -240.00, 'Distributed to card holders, evening session', 'seed-dist-0101-2'),
  ('SUGAR', -25.00, 'Distributed to AAY card holders', 'seed-dist-0101-3')
) as m (code, qty, reason, key);

-- Thresholds are set per shop by the shop administrator; these are demo starting values.
update public.shop_inventory set low_stock_threshold = case commodity_code
  when 'RICE' then 800
  when 'WHEAT' then 150
  when 'RAGI' then 200
  when 'JOWAR' then 200
  when 'SUGAR' then 50
end;

-- Commodities a shop stocks but has run out of.
insert into public.shop_inventory (shop_id, commodity_code, quantity, low_stock_threshold) values
  ('0d9a0000-0000-4000-b000-000000000102', 'WHEAT', 0, 150);

-- Open alerts for every row now at or below its threshold.
select public.refresh_stock_alert(shop_id, commodity_code) from public.shop_inventory;

insert into public.demo_ration_cards (card_number, head_of_family, category, member_count, shop_id)
select format('DEMO-%s', lpad(n::text, 6, '0')),
       format('Demo household %s', n),
       (array['AAY', 'PHH', 'PHH', 'NPHH'])[1 + n % 4]::public.card_category,
       1 + n % 6,
       (array[
         '0d9a0000-0000-4000-b000-000000000101',
         '0d9a0000-0000-4000-b000-000000000102',
         '0d9a0000-0000-4000-b000-000000000201',
         '0d9a0000-0000-4000-b000-000000000202'
       ])[1 + n % 4]::uuid
from generate_series(101, 140) as n;

-- Collection schedule (Phase 4): Monday to Saturday, 9:00 to 11:00 and 16:00 to 18:00 in
-- India Standard Time, one-hour slots for 15 visitors with 3 places kept for walk-ins.
insert into public.shop_booking_schedule (shop_id, weekday, start_time, end_time, slot_minutes, capacity, walk_in_reserve)
select s.id, w.day, t.starts, t.ends, 60, 15, 3
from public.shops s
cross join generate_series(1, 6) as w (day)
cross join (values (time '09:00', time '11:00'), (time '16:00', time '18:00')) as t (starts, ends);

-- Slots for the next 7 days from that schedule, the same rows publish_slots() would create.
insert into public.appointment_slots (shop_id, starts_at, ends_at, capacity, walk_in_reserve)
select s.id,
       (d::date + w.starts) at time zone 'Asia/Kolkata',
       (d::date + w.starts + interval '1 hour') at time zone 'Asia/Kolkata',
       15, 3
from public.shops s
cross join generate_series(current_date + 1, current_date + 7, interval '1 day') as d
cross join (values (time '09:00'), (time '10:00'), (time '16:00'), (time '17:00')) as w (starts)
where extract(isodow from d) < 7;

-- Warehouse stock (Phase 3). Opening balances go through the same function as later
-- receipts and adjustments. Quantities are invented demo values, not real allocations.
select public.apply_warehouse_movement(s.warehouse_id::uuid, s.code, 'opening_balance', s.qty,
                                       'Demo opening balance', null, null, 'seed-wh-opening-' || s.warehouse_id || '-' || s.code)
from (values
  ('0d9a0000-0000-4000-a000-000000000001', 'RICE', 18000.00),
  ('0d9a0000-0000-4000-a000-000000000001', 'WHEAT', 2400.00),
  ('0d9a0000-0000-4000-a000-000000000001', 'RAGI', 5200.00),
  ('0d9a0000-0000-4000-a000-000000000001', 'JOWAR', 600.00),
  ('0d9a0000-0000-4000-a000-000000000001', 'SUGAR', 900.00),
  ('0d9a0000-0000-4000-a000-000000000002', 'RICE', 15500.00),
  ('0d9a0000-0000-4000-a000-000000000002', 'WHEAT', 3100.00),
  ('0d9a0000-0000-4000-a000-000000000002', 'JOWAR', 4800.00),
  ('0d9a0000-0000-4000-a000-000000000002', 'SUGAR', 350.00)
) as s (warehouse_id, code, qty);

update public.warehouse_inventory set low_stock_threshold = case commodity_code
  when 'RICE' then 5000
  when 'WHEAT' then 1000
  when 'RAGI' then 1500
  when 'JOWAR' then 1000
  when 'SUGAR' then 400
end;
