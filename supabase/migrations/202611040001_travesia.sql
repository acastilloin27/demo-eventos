-- Run this entire file in the Supabase SQL Editor before deploying the API.
-- These objects are private to the server. The browser never receives a secret key.
begin;

create table if not exists public.travesia_admins (
  id uuid primary key,
  email text not null unique check (char_length(email) <= 254),
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.travesia_sessions (
  token_hash text primary key check (char_length(token_hash) = 64),
  admin_id uuid not null references public.travesia_admins(id) on delete cascade,
  expires_at bigint not null
);
create index if not exists travesia_sessions_expiry on public.travesia_sessions(expires_at);

create table if not exists public.travesia_inquiries (
  id uuid primary key,
  request_key uuid not null unique,
  fingerprint text not null check (char_length(fingerprint) = 64),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null default '' check (char_length(phone) <= 30),
  type text not null check (type in ('Matrimonio', 'Evento corporativo', 'Celebración', 'Otro')),
  guests integer check (guests between 10 and 280),
  event_date date,
  message text not null default '' check (char_length(message) <= 5000),
  status text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'closed')),
  notes text not null default '' check (char_length(notes) <= 10000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists travesia_inquiries_created on public.travesia_inquiries(created_at desc, id desc);
create index if not exists travesia_inquiries_status on public.travesia_inquiries(status);

create table if not exists public.travesia_rate_limits (
  key text primary key check (char_length(key) = 64),
  hits integer not null default 1,
  expires_at bigint not null
);
create index if not exists travesia_rate_limits_expiry on public.travesia_rate_limits(expires_at);

alter table public.travesia_admins enable row level security;
alter table public.travesia_sessions enable row level security;
alter table public.travesia_inquiries enable row level security;
alter table public.travesia_rate_limits enable row level security;
revoke all on public.travesia_admins, public.travesia_sessions, public.travesia_inquiries, public.travesia_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.travesia_admins, public.travesia_sessions, public.travesia_inquiries, public.travesia_rate_limits to service_role;

create or replace function public.travesia_health()
returns boolean language sql security invoker set search_path = '' as $$
  select count(*) >= 0 from public.travesia_admins;
$$;

create or replace function public.travesia_find_admin(p_email text)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id', id, 'email', email, 'password_hash', password_hash)
  from public.travesia_admins where email = p_email;
$$;

create or replace function public.travesia_save_admin(p_id uuid, p_email text, p_password_hash text, p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved_id uuid;
begin
  insert into public.travesia_admins(id, email, password_hash, created_at)
  values (p_id, p_email, p_password_hash, p_now)
  on conflict (email) do update set password_hash = excluded.password_hash
  returning id into saved_id;
  delete from public.travesia_sessions where admin_id = saved_id;
  return jsonb_build_object('id', saved_id, 'email', p_email);
end;
$$;

create or replace function public.travesia_find_session(p_hash text, p_now bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'email', a.email)
  from public.travesia_sessions s join public.travesia_admins a on a.id = s.admin_id
  where s.token_hash = p_hash and s.expires_at > p_now;
$$;

create or replace function public.travesia_create_session(p_hash text, p_admin_id uuid, p_expires_at bigint, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.travesia_sessions where expires_at <= p_now;
  insert into public.travesia_sessions(token_hash, admin_id, expires_at) values (p_hash, p_admin_id, p_expires_at);
end;
$$;

create or replace function public.travesia_delete_session(p_hash text)
returns void language sql security invoker set search_path = '' as $$
  delete from public.travesia_sessions where token_hash = p_hash;
$$;

create or replace function public.travesia_submit_inquiry(
  p_id uuid, p_request_key uuid, p_fingerprint text, p_name text, p_email text, p_phone text,
  p_type text, p_guests integer, p_event_date date, p_message text, p_now timestamptz
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare inserted_id uuid; previous public.travesia_inquiries%rowtype;
begin
  insert into public.travesia_inquiries(id, request_key, fingerprint, name, email, phone, type, guests, event_date, message, created_at, updated_at)
  values (p_id, p_request_key, p_fingerprint, p_name, p_email, p_phone, p_type, p_guests, p_event_date, p_message, p_now, p_now)
  on conflict (request_key) do nothing returning id into inserted_id;
  if inserted_id is not null then return jsonb_build_object('kind', 'created', 'id', inserted_id); end if;
  select * into previous from public.travesia_inquiries where request_key = p_request_key;
  return jsonb_build_object('kind', case when previous.fingerprint = p_fingerprint then 'duplicate' else 'conflict' end, 'id', previous.id);
end;
$$;

create or replace function public.travesia_list_inquiries(p_page integer, p_status text, p_search text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare items jsonb; total bigint; counts jsonb;
begin
  if p_page not between 1 and 100000 or char_length(p_search) > 120
    or (p_status is not null and p_status not in ('new', 'contacted', 'quoted', 'closed')) then
    raise exception 'Invalid filters' using errcode = '22023';
  end if;
  select count(*) into total from public.travesia_inquiries
  where (p_status is null or status = p_status)
    and (strpos(lower(name), lower(p_search)) > 0 or strpos(lower(email), lower(p_search)) > 0 or strpos(lower(message), lower(p_search)) > 0);
  select coalesce(jsonb_agg(to_jsonb(item) order by item."createdAt" desc, item.id desc), '[]'::jsonb) into items from (
    select id, name, email, phone, type, guests, event_date as "eventDate", message, status, notes, version, created_at as "createdAt", updated_at as "updatedAt"
    from public.travesia_inquiries
    where (p_status is null or status = p_status)
      and (strpos(lower(name), lower(p_search)) > 0 or strpos(lower(email), lower(p_search)) > 0 or strpos(lower(message), lower(p_search)) > 0)
    order by created_at desc, id desc limit 20 offset (p_page - 1) * 20
  ) item;
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into counts from (
    select status, count(*) as n from public.travesia_inquiries group by status
  ) grouped;
  return jsonb_build_object('items', items, 'total', total, 'page', p_page, 'pageSize', 20, 'counts', counts);
end;
$$;

create or replace function public.travesia_update_inquiry(p_id uuid, p_status text, p_notes text, p_version integer, p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare updated public.travesia_inquiries%rowtype;
begin
  update public.travesia_inquiries set status = p_status, notes = p_notes, version = version + 1, updated_at = p_now
  where id = p_id and version = p_version returning * into updated;
  if not found then
    if exists (select 1 from public.travesia_inquiries where id = p_id) then return jsonb_build_object('kind', 'conflict'); end if;
    return jsonb_build_object('kind', 'missing');
  end if;
  return jsonb_build_object('kind', 'updated', 'item', jsonb_build_object(
    'id', updated.id, 'name', updated.name, 'email', updated.email, 'phone', updated.phone, 'type', updated.type,
    'guests', updated.guests, 'eventDate', updated.event_date, 'message', updated.message, 'status', updated.status,
    'notes', updated.notes, 'version', updated.version, 'createdAt', updated.created_at, 'updatedAt', updated.updated_at
  ));
end;
$$;

create or replace function public.travesia_rate_hit(p_key text, p_window_ms integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare time_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  counter public.travesia_rate_limits%rowtype;
begin
  if p_window_ms < 1000 or p_window_ms > 86400000 then raise exception 'Invalid rate window'; end if;
  if random() < 0.01 then delete from public.travesia_rate_limits where expires_at < time_ms - 86400000; end if;
  insert into public.travesia_rate_limits(key, hits, expires_at) values (p_key, 1, time_ms + p_window_ms)
  on conflict (key) do update set
    hits = case when travesia_rate_limits.expires_at <= time_ms then 1 else least(travesia_rate_limits.hits, 2147483646) + 1 end,
    expires_at = case when travesia_rate_limits.expires_at <= time_ms then time_ms + p_window_ms else travesia_rate_limits.expires_at end
  returning * into counter;
  return jsonb_build_object('hits', counter.hits, 'expiresAt', counter.expires_at);
end;
$$;

create or replace function public.travesia_rate_decrement(p_key text)
returns void language sql security invoker set search_path = '' as $$
  update public.travesia_rate_limits set hits = greatest(0, hits - 1) where key = p_key;
$$;
create or replace function public.travesia_rate_reset(p_key text)
returns void language sql security invoker set search_path = '' as $$
  delete from public.travesia_rate_limits where key = p_key;
$$;

-- Revoke the default PUBLIC execute privilege on every function in this migration.
do $$
declare function_name regprocedure;
begin
  for function_name in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and left(p.proname, 9) = 'travesia_'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', function_name);
    execute format('grant execute on function %s to service_role', function_name);
  end loop;
end;
$$;
commit;
