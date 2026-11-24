-- Guardian self-signup default role, auth.users signup trigger, and
-- security-definer RPC for recording initial bcrypt password hash.
begin;

alter table public.user_accounts alter column role set default 'CAREGIVER';

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_role text;
  v_role public.app_user_role;
  v_suffix text;
  v_username text;
  v_display_name text;
begin
  v_app_role := upper(coalesce(new.raw_app_meta_data->>'role', ''));
  if v_app_role in ('PARENT', 'CAREGIVER', 'CHILD') then
    v_role := v_app_role::public.app_user_role;
  elsif upper(coalesce(new.raw_user_meta_data->>'guardian_type', '')) = 'PARENT' then
    v_role := 'PARENT'::public.app_user_role;
  else
    v_role := 'CAREGIVER'::public.app_user_role;
  end if;

  v_suffix := left(replace(new.id::text, '-', ''), 8);
  v_username := left(
    regexp_replace(
      lower(coalesce(new.raw_user_meta_data->>'username', new.raw_app_meta_data->>'username', '')),
      '[^a-z0-9._-]+',
      '',
      'g'
    ),
    64
  );
  if length(v_username) < 2 then
    v_username := left(
      regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9._-]+', '', 'g'),
      64
    );
  end if;
  if length(v_username) < 2 then
    v_username := 'user_' || v_suffix;
  end if;

  if exists (
    select 1
    from public.user_accounts ua
    where ua.username = v_username
      and ua.user_id <> new.id
  ) then
    v_username := left(v_username, 55) || '_' || v_suffix;
  end if;

  v_display_name := btrim(left(btrim(coalesce(new.raw_user_meta_data->>'name', new.raw_app_meta_data->>'name', '')), 120));
  if length(v_display_name) < 1 then
    v_display_name := v_username;
  end if;

  insert into public.user_accounts (user_id, username, display_name, role)
  values (new.id, v_username, v_display_name, v_role)
  on conflict (user_id) do nothing;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'role', v_role::text,
    'username', v_username,
    'name', v_display_name
  )
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

revoke all on function private.handle_new_auth_user() from public;

do $$
declare
  u record;
  v_app_role text;
  v_role public.app_user_role;
  v_suffix text;
  v_username text;
  v_display_name text;
  v_account public.user_accounts%rowtype;
begin
  for u in
    select id, email, raw_app_meta_data, raw_user_meta_data
    from auth.users
    order by created_at asc
  loop
    v_app_role := upper(coalesce(u.raw_app_meta_data->>'role', ''));
    if v_app_role in ('PARENT', 'CAREGIVER', 'CHILD') then
      v_role := v_app_role::public.app_user_role;
    elsif upper(coalesce(u.raw_user_meta_data->>'guardian_type', '')) = 'PARENT' then
      v_role := 'PARENT'::public.app_user_role;
    else
      v_role := 'CAREGIVER'::public.app_user_role;
    end if;

    v_suffix := left(replace(u.id::text, '-', ''), 8);
    v_username := left(
      regexp_replace(
        lower(coalesce(u.raw_user_meta_data->>'username', u.raw_app_meta_data->>'username', '')),
        '[^a-z0-9._-]+',
        '',
        'g'
      ),
      64
    );
    if length(v_username) < 2 then
      v_username := left(
        regexp_replace(lower(split_part(coalesce(u.email, ''), '@', 1)), '[^a-z0-9._-]+', '', 'g'),
        64
      );
    end if;
    if length(v_username) < 2 then
      v_username := 'user_' || v_suffix;
    end if;

    if exists (
      select 1
      from public.user_accounts ua
      where ua.username = v_username
        and ua.user_id <> u.id
    ) then
      v_username := left(v_username, 55) || '_' || v_suffix;
    end if;

    v_display_name := btrim(left(btrim(coalesce(u.raw_user_meta_data->>'name', u.raw_app_meta_data->>'name', '')), 120));
    if length(v_display_name) < 1 then
      v_display_name := v_username;
    end if;

    insert into public.user_accounts (user_id, username, display_name, role)
    values (u.id, v_username, v_display_name, v_role)
    on conflict (user_id) do nothing;

    select * into v_account
    from public.user_accounts
    where user_id = u.id;

    if found then
      update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
        'role', v_account.role::text,
        'username', v_account.username,
        'name', v_account.display_name
      )
      where id = u.id;
    end if;
  end loop;
end;
$$;

create or replace function public.resolve_login_email(p_identifier text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from auth.users u
  left join public.user_accounts ua on ua.user_id = u.id
  where nullif(lower(btrim(p_identifier)), '') is not null
    and u.deleted_at is null
    and (
      lower(ua.username) = lower(btrim(p_identifier))
      or lower(u.raw_user_meta_data->>'username') = lower(btrim(p_identifier))
      or lower(u.raw_app_meta_data->>'username') = lower(btrim(p_identifier))
    )
  order by (lower(ua.username) = lower(btrim(p_identifier))) desc nulls last, u.created_at asc
  limit 1;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

create or replace function public.set_own_password_hash(p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'PERMISSION_DENIED: Authentication required';
  end if;

  if p_hash is null or p_hash !~ '^\$2[aby]\$\d{2}\$.{53}$' then
    raise exception 'INVALID_HASH: Invalid bcrypt password hash';
  end if;

  update public.user_accounts
  set password_hash = p_hash
  where user_id = v_uid
    and password_hash is null;
end;
$$;

revoke all on function public.set_own_password_hash(text) from public;
grant execute on function public.set_own_password_hash(text) to authenticated;

commit;
