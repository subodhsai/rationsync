-- Phase 4, part 1. Postgres cannot use a new enum value in the transaction that adds it,
-- so the value gets its own migration ahead of the one that uses it.
alter type public.booking_status add value if not exists 'no_show';
