create table if not exists public.spool_email_requests (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 kind text not null check (kind in ('sample','inquiry')),
 subject text not null,
 message text not null,
 reply_to text not null,
 status text not null default 'pending' check (status in ('pending','sent','failed')),
 resend_id text,
 created_at timestamptz not null default now()
);
alter table public.spool_email_requests enable row level security;
revoke all on public.spool_email_requests from anon, authenticated;
grant all on public.spool_email_requests to service_role;
create index if not exists spool_email_requests_user_time on public.spool_email_requests(user_id, created_at desc);
create or replace function public.reserve_spool_email(p_id uuid,p_user uuid,p_kind text,p_subject text,p_message text,p_reply_to text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare existing public.spool_email_requests; recent_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into existing from public.spool_email_requests where id=p_id;
 if found then
  if existing.user_id<>p_user or existing.kind<>p_kind or existing.subject<>p_subject or existing.message<>p_message or existing.reply_to<>p_reply_to then
   return jsonb_build_object('error','conflict');
  end if;
  return jsonb_build_object('status',existing.status,'resend_id',existing.resend_id);
 end if;
 select count(*) into recent_count from public.spool_email_requests where user_id=p_user and created_at>now()-interval '1 hour';
 if recent_count>=5 or exists(select 1 from public.spool_email_requests where user_id=p_user and created_at>now()-interval '60 seconds') then
  return jsonb_build_object('error','rate_limit');
 end if;
 insert into public.spool_email_requests(id,user_id,kind,subject,message,reply_to) values(p_id,p_user,p_kind,p_subject,p_message,p_reply_to);
 return jsonb_build_object('status','pending');
end $$;
revoke all on function public.reserve_spool_email(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_spool_email(uuid,uuid,text,text,text,text) to service_role;
