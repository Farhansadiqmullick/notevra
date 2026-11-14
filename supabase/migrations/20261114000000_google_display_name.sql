-- Google sign-in sends the person's name as full_name / name, not display_name; use it before the email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    public.suggest_display_name(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
        split_part(coalesce(new.email, ''), '@', 1)
      )
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- True when the name is blank or only the email fallback ("ada", "ada 2"), i.e. never chosen by the person.
create or replace function public.is_fallback_display_name(display_name text, email text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(coalesce(display_name, '')) = ''
      or lower(display_name) = lower(split_part(coalesce(email, ''), '@', 1))
      or (
        lower(display_name) like lower(split_part(coalesce(email, ''), '@', 1)) || ' %'
        and substr(display_name, length(split_part(coalesce(email, ''), '@', 1)) + 2) ~ '^[0-9]+$'
      );
$$;

-- Google linked to an existing account: take Google's name only if the person never saved one.
create or replace function public.adopt_linked_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  linked text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
  );
begin
  if linked is null or linked is not distinct from coalesce(
    nullif(btrim(old.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(old.raw_user_meta_data ->> 'name'), '')
  ) then
    return new;
  end if;

  update public.profiles p
     set display_name = public.suggest_display_name(linked),
         updated_at = now()
   where p.user_id = new.id
     and public.is_fallback_display_name(p.display_name, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_linked on auth.users;
create trigger on_auth_user_linked
  after update of raw_user_meta_data on auth.users
  for each row execute function public.adopt_linked_name();
