-- ============================================================================
-- 0009 — find someone by part of their name, if you are an admin of the space
--
-- Exact-name sharing worked and was unusable: "mira" is not a short form of "Mira Member", it is a
-- name nobody has, so the dialog said "No one found" to somebody looking straight at the person.
--
-- Both limits are enforced HERE, not in the dialog:
--   * the caller must be an admin OF THIS WORKSPACE — a non-admin gets zero rows, not an error;
--   * at least 3 characters — `%a%` would otherwise return the whole user table.
-- A client-side check is a courtesy to the user; this is the rule.
-- ============================================================================

create or replace function public.search_members(ws text, q text)
returns table (user_id uuid, display_name text, already boolean)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.user_id,
         p.display_name,
         exists (
           select 1 from public.workspace_members m
           where m.workspace_id = ws and m.user_id = p.user_id and m.membership = 'active'
         ) as already
  from public.profiles p
  where public.is_workspace_admin(ws)
    and length(btrim(coalesce(q, ''))) >= 3
    and p.display_name <> ''
    and p.display_name ilike '%' || btrim(q) || '%'
  -- someone whose name STARTS with what was typed is what was meant; the rest follow
  order by case when lower(p.display_name) like lower(btrim(q)) || '%' then 0 else 1 end,
           p.display_name
  limit 8;
$$;

grant execute on function public.search_members(text, text) to authenticated;
