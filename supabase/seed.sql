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
  (id, fps_id, warehouse_id, name, district, taluk, address, contact_phone, opening_hours, status, review_reason, reviewed_at)
values
  ('0d9a0000-0000-4000-b000-000000000101', 'DEMO-FPS-MYS-0101', '0d9a0000-0000-4000-a000-000000000001',
   'Demo FPS Kuvempunagar', 'Mysuru', 'Mysuru', '2nd Cross, Kuvempunagar, Mysuru',
   '+91 90000 00101', 'Mon to Sat, 8:00 to 12:00 and 16:00 to 20:00', 'approved', 'Demo seed record', now()),
  ('0d9a0000-0000-4000-b000-000000000102', 'DEMO-FPS-MYS-0102', '0d9a0000-0000-4000-a000-000000000001',
   'Demo FPS Vijayanagar', 'Mysuru', 'Mysuru', '4th Main, Vijayanagar 2nd Stage, Mysuru',
   '+91 90000 00102', 'Mon to Sat, 8:00 to 12:00 and 16:00 to 20:00', 'approved', 'Demo seed record', now()),
  ('0d9a0000-0000-4000-b000-000000000201', 'DEMO-FPS-DWD-0201', '0d9a0000-0000-4000-a000-000000000002',
   'Demo FPS Vidyanagar', 'Dharwad', 'Hubballi', 'Near Bus Stop, Vidyanagar, Hubballi',
   '+91 90000 00201', 'Mon to Sat, 8:30 to 12:30 and 16:00 to 19:30', 'approved', 'Demo seed record', now()),
  ('0d9a0000-0000-4000-b000-000000000202', 'DEMO-FPS-DWD-0202', '0d9a0000-0000-4000-a000-000000000002',
   'Demo FPS Keshwapur', 'Dharwad', 'Hubballi', 'Market Road, Keshwapur, Hubballi',
   '+91 90000 00202', 'Mon to Sat, 8:30 to 12:30 and 16:00 to 19:30', 'approved', 'Demo seed record', now());

-- Opening balances go through the same function as every later movement, so each
-- balance has a ledger entry behind it. Some rows start at or below their threshold.
select public.apply_stock_movement(s.shop_id::uuid, s.code, 'opening_balance', s.qty,
                                   'Demo opening balance', null, 'seed-opening-' || s.shop_id || '-' || s.code)
from (values
  ('0d9a0000-0000-4000-b000-000000000101', 'RICE', 1840.00),
  ('0d9a0000-0000-4000-b000-000000000101', 'WHEAT', 120.00),
  ('0d9a0000-0000-4000-b000-000000000101', 'RAGI', 410.00),
  ('0d9a0000-0000-4000-b000-000000000101', 'SUGAR', 35.00),
  ('0d9a0000-0000-4000-b000-000000000102', 'RICE', 960.00),
  ('0d9a0000-0000-4000-b000-000000000102', 'RAGI', 520.00),
  ('0d9a0000-0000-4000-b000-000000000102', 'SUGAR', 90.00),
  ('0d9a0000-0000-4000-b000-000000000201', 'RICE', 2210.00),
  ('0d9a0000-0000-4000-b000-000000000201', 'WHEAT', 340.00),
  ('0d9a0000-0000-4000-b000-000000000201', 'JOWAR', 180.00),
  ('0d9a0000-0000-4000-b000-000000000202', 'RICE', 640.00),
  ('0d9a0000-0000-4000-b000-000000000202', 'JOWAR', 610.00)
) as s (shop_id, code, qty);

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

-- Two collection windows per working day for the next 7 days, in India Standard Time.
insert into public.appointment_slots (shop_id, starts_at, ends_at, capacity)
select s.id,
       (d + w.starts) at time zone 'Asia/Kolkata',
       (d + w.ends) at time zone 'Asia/Kolkata',
       30
from public.shops s
cross join generate_series(current_date + 1, current_date + 7, interval '1 day') as d
cross join (values (time '09:00', time '11:00'), (time '16:00', time '18:00')) as w (starts, ends)
where extract(isodow from d) < 7;
