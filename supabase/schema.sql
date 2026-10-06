-- =====================================================================================================
-- OFS/T order intake + owner-only admin. Run this whole file once in Supabase: SQL Editor -> New query -> Run.
-- It is safe to re-run (idempotent): tables use "if not exists", functions/policies/triggers are replaced.
--
-- Model
--   public.orders  : one row per checkout. Anyone (anon key) may INSERT a new order; nobody but an admin may read it.
--   public.admins  : the user ids (from Authentication -> Users) allowed to read orders and change their status.
--
-- Trust boundaries
--   * The website is public and its JavaScript can be modified by anyone, so EVERY value in an inserted row is untrusted.
--     The database enforces shape and size (constraints below), forces status/created_at (trigger) and only grants the
--     columns a customer may set. total_cents is computed by the site from designs.json but MUST be re-checked by the
--     owner against the price list before asking for payment (see SECURITY.md).
--   * Admin identity comes only from the verified JWT (auth.uid()), never from anything the browser sends in a body.
--   * The anon/publishable key is public by design. NEVER put the service_role / secret key in the website.
--
-- Rate limiting
--   * Supabase Auth has built-in rate limits on sign-in / token refresh (Authentication -> Rate Limits).
--   * The REST API (PostgREST) has no per-IP limit, so orders_before_insert() adds a GLOBAL flood cap
--     (max_orders_per_10_min below). Under attack this also blocks real customers for a few minutes, which is
--     preferable to a database filled with junk. For stronger protection add a CAPTCHA (e.g. Cloudflare Turnstile,
--     which Supabase supports natively for Auth; for orders it needs an Edge Function that verifies the token).
-- =====================================================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid() (already enabled on Supabase; harmless otherwise)

-- -----------------------------------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------------------------------
create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  status                text not null default 'new' check (status in ('new', 'printed', 'shipped')),
  -- Personal data kept to the minimum needed to deliver: name, email, street, postcode, city, country. Nothing else.
  customer              jsonb not null,
  -- [{cfg:{model,design,c1,c2,finish,kit,numberOn,number}, qty, unit_cents, name, desc}, ...]
  items                 jsonb not null,
  total_cents           integer not null,
  lang                  text,
  consent_terms         boolean not null,     -- accepted terms of sale + refunds policy, read the privacy policy
  consent_personalised  boolean,              -- acknowledged no change-of-mind returns for personalised kits (null if none in the order)
  user_agent            text,                 -- optional; the site does not send it (data minimisation)

  constraint orders_customer_shape check (
        jsonb_typeof(customer) = 'object'
    and octet_length(customer::text) <= 2000
    -- only these keys are allowed, so nobody can stash extra personal data or junk in the row
    and (customer - array['name', 'email', 'street', 'postcode', 'city', 'country']) = '{}'::jsonb
    and coalesce(length(customer->>'name'), 0)     between 1 and 200
    and coalesce(length(customer->>'email'), 0)    between 3 and 254
    and (customer->>'email') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and coalesce(length(customer->>'street'), 0)   between 1 and 300
    and coalesce(length(customer->>'postcode'), 0) between 1 and 20
    and coalesce(length(customer->>'city'), 0)     between 1 and 120
    and coalesce(length(customer->>'country'), 0)  between 1 and 60
  ),
  constraint orders_items_shape check (
        jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 50
    and octet_length(items::text) <= 30000
  ),
  constraint orders_total_range check (total_cents between 1 and 1000000),
  constraint orders_lang_shape  check (lang is null or lang ~ '^[a-z]{2}(-[A-Za-z]{2})?$'),
  constraint orders_ua_length   check (user_agent is null or length(user_agent) <= 300)
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- -----------------------------------------------------------------------------------------------------
-- Row Level Security: ON for both tables. With RLS on and no matching policy, access is denied.
-- -----------------------------------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.admins enable row level security;

-- Table privileges (defence in depth on top of RLS). Supabase grants everything to anon/authenticated by default;
-- take it all away and grant back only what is needed.
revoke all on public.orders from anon, authenticated;
revoke all on public.admins from anon, authenticated;
-- Customers may set only these columns. status / created_at are not granted, so they always take their defaults
-- (and the trigger below forces them anyway).
grant insert (id, customer, items, total_cents, lang, consent_terms, consent_personalised, user_agent)
  on public.orders to anon, authenticated;
-- Admins (checked by RLS below) may read orders and change ONLY the status column.
grant select, update (status) on public.orders to authenticated;
grant select on public.admins to authenticated;

-- is_admin(): true when the caller's verified JWT user id is in public.admins.
-- SECURITY DEFINER so it can read admins without tripping over that table's own RLS; fixed empty search_path.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- orders: INSERT for anyone, but only a well-formed new order with the terms accepted.
drop policy if exists orders_insert_public on public.orders;
create policy orders_insert_public on public.orders
  for insert to anon, authenticated
  with check (
        status = 'new'
    and consent_terms = true
    and total_cents between 1 and 1000000
    and jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50
    and octet_length(items::text) <= 30000
    and jsonb_typeof(customer) = 'object' and octet_length(customer::text) <= 2000
  );

-- orders: SELECT / UPDATE for admins only. No DELETE policy at all (delete rows from the Supabase dashboard if needed).
drop policy if exists orders_select_admin on public.orders;
create policy orders_select_admin on public.orders
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin on public.orders
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- admins: a signed-in user may see only their own row (used by the dashboard to say "this account isn't an admin").
-- No insert/update/delete policies: admins are added by the owner in the SQL editor.
drop policy if exists admins_select_own on public.admins;
create policy admins_select_own on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------------------------------
-- Trigger: never trust client-supplied bookkeeping fields; global flood cap.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.orders_before_insert()
returns trigger
language plpgsql
security definer          -- needs to count all orders, which the anon caller cannot see
set search_path = ''
as $$
declare
  max_orders_per_10_min constant integer := 30;   -- adjust if you ever get more real orders than this
  recent integer;
begin
  new.status := 'new';
  new.created_at := now();
  new.user_agent := left(new.user_agent, 300);

  select count(*) into recent from public.orders where created_at > now() - interval '10 minutes';
  if recent >= max_orders_per_10_min then
    raise exception 'Too many orders right now, please try again in a few minutes'
      using errcode = 'P0001', hint = 'rate_limited';
  end if;
  return new;
end;
$$;
revoke all on function public.orders_before_insert() from public, anon, authenticated;

drop trigger if exists orders_before_insert on public.orders;
create trigger orders_before_insert
  before insert on public.orders
  for each row execute function public.orders_before_insert();

-- Status changes: an admin may change only status (column grant above); keep it to the three known values (check constraint).

-- -----------------------------------------------------------------------------------------------------
-- After running this file:
--   1. Authentication -> Sign In / Providers: turn OFF "Allow new users to sign up".
--   2. Authentication -> Users -> Add user (your email + a strong password, "Auto confirm").
--   3. Copy that user's UID and run:   insert into public.admins (user_id) values ('PASTE-THE-UID-HERE');
-- See SUPABASE-SETUP.md for the full walkthrough.
-- -----------------------------------------------------------------------------------------------------
