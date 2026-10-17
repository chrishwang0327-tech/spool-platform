-- Credits: every AI image costs credits. Each usage row in "generations" now says how many credits
-- it used and where they came from:
--   src 'plan'  = the SPOOL Studio monthly credits (reset every billing period)
--   src 'pool'  = credits that don't expire (free start credits, top-ups, sample bonuses, admin grants)
--   src 'admin' = admin accounts (not counted)
-- Rows written before this change have no credits value; the Worker converts them (3 old calls = 2 credits).
--
-- Run this, then paste the new spool-ai-worker.js into Cloudflare.

alter table public.generations add column if not exists credits integer;
alter table public.generations add column if not exists src text;

-- one call gives the Worker everything it needs to work out a balance
create or replace function public.credit_usage(p_uid uuid, p_since timestamptz, p_sample_cap integer default 2)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'plan',    coalesce(sum(credits) filter (where src = 'plan' and created_at >= p_since), 0),
    'pool',    coalesce(sum(credits) filter (where src = 'pool'), 0),
    'legacy',  count(*) filter (where credits is null and kind in ('design', 'extract')),
    'today',   coalesce(sum(credits) filter (where src in ('plan', 'pool') and created_at >= date_trunc('day', now() at time zone 'utc')), 0),
    -- sample requests that earn a bonus: at most p_sample_cap per calendar month
    'samples', (select coalesce(sum(least(n, p_sample_cap)), 0) from (
                  select count(*) as n from public.generations
                  where user_id = p_uid and kind like 'mail:%'
                  group by date_trunc('month', created_at)) m)
  )
  from public.generations
  where user_id = p_uid;
$$;

-- only the Worker (secret key) may call it
revoke all on function public.credit_usage(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.credit_usage(uuid, timestamptz, integer) to service_role;

-- the Worker writes the new columns
grant select, insert on public.generations to service_role;
