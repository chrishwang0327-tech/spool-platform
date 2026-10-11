-- Usage rows in "generations" are written only by the Cloudflare Worker (with the Supabase secret key).
-- Accounts can still read their own rows, but can no longer add "tp:<project>" or "mail:<id>" rows themselves
-- to unlock extra tech packs.
--
-- Run this AFTER the Worker has SUPABASE_SECRET_KEY set and the new spool-ai-worker.js is deployed.

-- 1) Sample requests sent before this change keep their extra tech pack:
--    the Worker now counts emailed requests ("mail:<id>" rows) instead of rows in sample_requests.
insert into public.generations (user_id, kind, created_at)
select s.user_id, 'mail:' || lower(s.id::text), s.created_at
from public.sample_requests s
where not exists (
  select 1 from public.generations g where g.kind = 'mail:' || lower(s.id::text)
);

-- 2) Accounts can no longer insert usage rows directly.
drop policy if exists "gen: add own" on public.generations;
