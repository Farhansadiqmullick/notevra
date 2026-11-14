-- Landing page download counts: one row per browser per platform, reached only through the two functions below.

create table public.landing_downloads (
  visitor_id uuid not null,
  platform   text not null check (platform in ('ios', 'android', 'desktop')),
  created_at timestamptz not null default now(),
  primary key (visitor_id, platform)
);

alter table public.landing_downloads enable row level security;
-- default privileges in 0001 give authenticated DML on every new table; this one is function-only
revoke all on public.landing_downloads from anon, authenticated;

create or replace function public.record_landing_download(p_visitor_id uuid, p_platform text)
returns boolean
language sql
security definer
volatile
set search_path = public, pg_temp
as $$
  with ins as (
    insert into public.landing_downloads (visitor_id, platform)
    values (p_visitor_id, p_platform)
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from ins);
$$;

create or replace function public.landing_downloads_daily(p_days int, p_tz text)
returns table (day date, ios int, android int, desktop int)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with z as (
    -- an unknown zone name would raise, so fall back to UTC
    select coalesce((select name from pg_timezone_names where name = p_tz), 'UTC') as tz
  )
  select (d.created_at at time zone z.tz)::date as day,
         count(*) filter (where d.platform = 'ios')::int,
         count(*) filter (where d.platform = 'android')::int,
         count(*) filter (where d.platform = 'desktop')::int
  from public.landing_downloads d, z
  where d.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90) + 1)
  group by 1
  order by 1;
$$;

revoke execute on function public.record_landing_download(uuid, text) from public;
revoke execute on function public.landing_downloads_daily(int, text) from public;
grant execute on function public.record_landing_download(uuid, text) to anon, authenticated;
grant execute on function public.landing_downloads_daily(int, text) to anon, authenticated;
