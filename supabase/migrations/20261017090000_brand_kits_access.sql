-- Brand Kit: signed-in accounts read and save only their own kit.
-- Before this, the table had no privileges for "authenticated", so every editor open got
-- 403 "permission denied for table brand_kits" and saved kits never loaded.

grant select, insert, update on public.brand_kits to authenticated;

alter table public.brand_kits enable row level security;

drop policy if exists "brand kit: read own" on public.brand_kits;
drop policy if exists "brand kit: add own" on public.brand_kits;
drop policy if exists "brand kit: update own" on public.brand_kits;

create policy "brand kit: read own" on public.brand_kits
  for select to authenticated using (user_id::text = auth.uid()::text);
create policy "brand kit: add own" on public.brand_kits
  for insert to authenticated with check (user_id::text = auth.uid()::text);
create policy "brand kit: update own" on public.brand_kits
  for update to authenticated using (user_id::text = auth.uid()::text) with check (user_id::text = auth.uid()::text);
