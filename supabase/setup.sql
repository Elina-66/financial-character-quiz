-- Run once in Supabase > SQL Editor. No public read/write policies are created.
create table if not exists public.quiz_submissions (
  id uuid primary key,
  email text not null,
  result text not null check (result in ('matroskin','carrie','scrooge','forrest','ostap','krabs')),
  created_at timestamptz not null default now(),
  data_consent_at timestamptz not null default now(),
  consent_version text not null default '2026-11-21-v1',
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','accepted')),
  provider_id text,
  accepted_at timestamptz,
  ip_hash text not null
);
alter table public.quiz_submissions enable row level security;
revoke all on public.quiz_submissions from anon, authenticated;
grant select, insert, update on public.quiz_submissions to service_role;
create index if not exists quiz_submissions_email_time on public.quiz_submissions(email, created_at);
create index if not exists quiz_submissions_ip_time on public.quiz_submissions(ip_hash, created_at);

-- Atomic registration and rate limiting: retries reuse a submission rather than
-- creating duplicate records. The function is callable only by the backend.
create or replace function public.register_quiz_submission(
  p_id uuid, p_email text, p_result text, p_marketing boolean, p_ip_hash text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  existing public.quiz_submissions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('email:' || p_email, 0));
  select * into existing from public.quiz_submissions where id = p_id;
  if found then
    if existing.email <> p_email or existing.result <> p_result
       or existing.marketing_consent <> p_marketing then
      return jsonb_build_object('error', 'conflict');
    end if;
    if existing.status <> 'accepted' and existing.created_at < now() - interval '23 hours' then
      return jsonb_build_object('error', 'conflict');
    end if;
    return jsonb_build_object('status', existing.status);
  end if;
  if (select count(*) from public.quiz_submissions where email = p_email and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.quiz_submissions where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('error', 'rate_limit');
  end if;
  insert into public.quiz_submissions(id, email, result, marketing_consent, marketing_consent_at, ip_hash)
    values(p_id, p_email, p_result, p_marketing, case when p_marketing then now() else null end, p_ip_hash);
  return jsonb_build_object('status', 'pending');
end;
$$;
revoke all on function public.register_quiz_submission(uuid,text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.register_quiz_submission(uuid,text,text,boolean,text) to service_role;
