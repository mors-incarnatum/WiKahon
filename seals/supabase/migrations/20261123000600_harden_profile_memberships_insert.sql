-- Prevent profile owners from inserting or reassigning memberships for CHILD
-- accounts they do not own as guardian (closes foreign membership injection
-- and legacy guardian_id fallback takeover).
begin;

create or replace function private.can_assign_profile_member(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.user_accounts ua
      where ua.user_id = p_user_id
        and (
          ua.role <> 'CHILD'::public.app_user_role
          or ua.guardian_id = (select auth.uid())
        )
    );
$$;

revoke all on function private.can_assign_profile_member(uuid) from public, anon;
grant execute on function private.can_assign_profile_member(uuid) to authenticated;

drop policy if exists memberships_insert on public.profile_memberships;
create policy memberships_insert on public.profile_memberships
  for insert to authenticated
  with check (
    profile_id in (select private.owned_profile_ids())
    and private.can_assign_profile_member(user_id)
  );

drop policy if exists memberships_update on public.profile_memberships;
create policy memberships_update on public.profile_memberships
  for update to authenticated
  using (profile_id in (select private.owned_profile_ids()))
  with check (
    profile_id in (select private.owned_profile_ids())
    and private.can_assign_profile_member(user_id)
  );

commit;
