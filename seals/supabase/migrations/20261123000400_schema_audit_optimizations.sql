-- Schema efficiency audit optimizations:
-- 1. Normalized lowercase usernames + fast indexed resolve_login_email
-- 2. Set-returning RLS helpers without nested SECURITY DEFINER calls
-- 3. Consolidate public.words into public.tiles
-- 4. Covering and partial indexes
-- 5. Compact enum columns and normalized board/settings columns
-- 6. Tightened CHECK constraints, bounds, and transaction-stable touch_updated_at
-- 7. Set-based upsert/diff-delete publish_profile_snapshot
-- 8. Single-query send_profile_chat_message

begin;
set constraints all immediate;

-- ============================================================================
-- 1. Critical #1: Fast resolve_login_email & lowercase user_accounts.username
-- ============================================================================
with normalized as (
  select
    user_id,
    lower(btrim(username)) as base_username,
    row_number() over (
      partition by lower(btrim(username))
      order by (username = lower(btrim(username))) desc, created_at asc, user_id asc
    ) as rn
  from public.user_accounts
),
colliding as (
  select
    user_id,
    left(base_username, 55) || '_' || left(replace(user_id::text, '-', ''), 8) as next_username
  from normalized
  where rn > 1
)
update public.user_accounts ua
set username = c.next_username
from colliding c
where ua.user_id = c.user_id
  and ua.username is distinct from c.next_username;

update public.user_accounts
set username = lower(btrim(username))
where username is distinct from lower(btrim(username));

alter table public.user_accounts
  drop constraint if exists user_accounts_username_lowercase,
  add constraint user_accounts_username_lowercase
    check (username = lower(btrim(username)));

create or replace function public.resolve_login_email(p_identifier text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from public.user_accounts ua
  join auth.users u on u.id = ua.user_id
  where nullif(lower(btrim(p_identifier)), '') is not null
    and ua.username = lower(btrim(p_identifier))
    and u.deleted_at is null
  limit 1;
$$;

revoke all on function public.resolve_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text) to service_role;

-- ============================================================================
-- 2. Critical #2: Set-returning RLS helpers & non-nested definer checks
-- ============================================================================
create or replace function private.can_read_profile(profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.profiles
    where id = profile
      and owner_id = (select auth.uid())
  ) or exists(
    select 1
    from public.profile_memberships
    where profile_id = profile
      and user_id = (select auth.uid())
  );
$$;

create or replace function private.can_edit_profile(profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.profiles
    where id = profile
      and owner_id = (select auth.uid())
  ) or exists(
    select 1
    from public.profile_memberships
    where profile_id = profile
      and user_id = (select auth.uid())
      and role = 'editor'::public.profile_member_role
  );
$$;

create or replace function private.owned_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.profiles
  where owner_id = (select auth.uid());
$$;

create or replace function private.member_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile_id
  from public.profile_memberships
  where user_id = (select auth.uid());
$$;

create or replace function private.readable_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.profiles
  where owner_id = (select auth.uid())
  union
  select profile_id
  from public.profile_memberships
  where user_id = (select auth.uid());
$$;

create or replace function private.editable_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.profiles
  where owner_id = (select auth.uid())
  union
  select profile_id
  from public.profile_memberships
  where user_id = (select auth.uid())
    and role = 'editor'::public.profile_member_role;
$$;

revoke all on function
  private.owned_profile_ids(),
  private.member_profile_ids(),
  private.readable_profile_ids(),
  private.editable_profile_ids()
from public;

grant execute on function
  private.owned_profile_ids(),
  private.member_profile_ids(),
  private.readable_profile_ids(),
  private.editable_profile_ids()
to authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (owner_id = (select auth.uid()) or id in (select private.member_profile_ids()));

drop policy if exists memberships_read on public.profile_memberships;
create policy memberships_read on public.profile_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or profile_id in (select private.owned_profile_ids()));

drop policy if exists memberships_insert on public.profile_memberships;
create policy memberships_insert on public.profile_memberships
  for insert to authenticated
  with check (profile_id in (select private.owned_profile_ids()));

drop policy if exists memberships_update on public.profile_memberships;
create policy memberships_update on public.profile_memberships
  for update to authenticated
  using (profile_id in (select private.owned_profile_ids()))
  with check (profile_id in (select private.owned_profile_ids()));

drop policy if exists memberships_delete on public.profile_memberships;
create policy memberships_delete on public.profile_memberships
  for delete to authenticated
  using (profile_id in (select private.owned_profile_ids()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array['boards', 'tiles', 'profile_settings'] loop
    execute format('drop policy if exists member_read on public.%I', table_name);
    execute format(
      'create policy member_read on public.%I for select to authenticated using (profile_id in (select private.readable_profile_ids()))',
      table_name
    );

    execute format('drop policy if exists editor_insert on public.%I', table_name);
    execute format(
      'create policy editor_insert on public.%I for insert to authenticated with check (profile_id in (select private.editable_profile_ids()))',
      table_name
    );

    execute format('drop policy if exists editor_update on public.%I', table_name);
    execute format(
      'create policy editor_update on public.%I for update to authenticated using (profile_id in (select private.editable_profile_ids())) with check (profile_id in (select private.editable_profile_ids()))',
      table_name
    );

    execute format('drop policy if exists editor_delete on public.%I', table_name);
    execute format(
      'create policy editor_delete on public.%I for delete to authenticated using (profile_id in (select private.editable_profile_ids()))',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists chat_messages_read on public.profile_chat_messages;
create policy chat_messages_read on public.profile_chat_messages
  for select to authenticated
  using (profile_id in (select private.readable_profile_ids()));

-- ============================================================================
-- 3. High #4: Consolidate public.words into public.tiles
-- ============================================================================
do $$
begin
  if to_regclass('public.words') is not null then
    insert into public.tiles (
      profile_id, id, kind, label, spoken_text, icon_name, media_id, language, is_quick_phrase,
      category_id, target_board_id, color_key, word_class, is_custom, created_at, updated_at
    )
    select
      w.profile_id,
      w.id,
      'word'::public.tile_kind,
      w.label,
      w.spoken_text,
      w.icon_name,
      w.media_id,
      case when w.language in ('fil', 'en', 'taglish') then w.language else 'fil' end,
      w.is_quick_phrase,
      w.category_id,
      null,
      w.color_key,
      w.word_class,
      w.is_custom,
      w.created_at,
      w.updated_at
    from public.words w
    on conflict (profile_id, id) do nothing;
  end if;
end;
$$;

drop table if exists public.words;

-- ============================================================================
-- 4. High #5: Indexes
-- ============================================================================
create index if not exists profile_chat_messages_sender_idx
  on public.profile_chat_messages(sender_user_id);

drop index if exists public.profile_chat_messages_profile_created_idx;
create index profile_chat_messages_profile_created_idx
  on public.profile_chat_messages(profile_id, created_at desc, id desc);

-- Ensure guardian_id and its backfill/trigger exist even if 20261123000200 was
-- marked applied without executing on an existing remote database.
alter table public.user_accounts
  add column if not exists guardian_id uuid references auth.users(id) on delete set null;

update public.user_accounts ua
set guardian_id = sub.owner_id
from (
  select distinct on (pm.user_id)
    pm.user_id,
    p.owner_id
  from public.profile_memberships pm
  join public.profiles p on p.id = pm.profile_id
  order by pm.user_id, p.created_at asc, pm.created_at asc, p.id asc
) sub
where ua.user_id = sub.user_id
  and ua.role = 'CHILD'
  and ua.guardian_id is null;

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
  v_guardian_id uuid;
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

  v_guardian_id := private.try_parse_uuid(new.raw_app_meta_data->>'guardian_id');
  if v_guardian_id is not null and not exists (select 1 from auth.users u where u.id = v_guardian_id) then
    v_guardian_id := null;
  end if;

  insert into public.user_accounts (user_id, username, display_name, role, guardian_id)
  values (new.id, v_username, v_display_name, v_role, v_guardian_id)
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

revoke all on function private.handle_new_auth_user() from public;

drop index if exists public.user_accounts_guardian_id_idx;
create index user_accounts_guardian_id_idx
  on public.user_accounts(guardian_id)
  where guardian_id is not null;

drop index if exists public.tiles_target_board_idx;
create index tiles_target_board_idx
  on public.tiles(profile_id, target_board_id)
  where target_board_id is not null;

drop index if exists public.profile_memberships_user_id_idx;
create index profile_memberships_user_id_idx
  on public.profile_memberships(user_id, profile_id) include (role);

-- ============================================================================
-- 5. Medium #6: Eliminate JSONB workarounds & double-stored inactive boards
-- ============================================================================
update public.tiles
set language = 'fil'
where language is null
   or language not in ('fil', 'en', 'taglish');

alter table public.tiles
  drop constraint if exists tiles_language_valid,
  alter column language drop default,
  alter column language type public.language_tag using language::public.language_tag,
  alter column language set default 'fil'::public.language_tag,
  alter column language set not null;

do $$
declare
  v_con text;
begin
  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.profile_chat_messages'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '\ysender_role\y'
  loop
    execute format('alter table public.profile_chat_messages drop constraint %I', v_con);
  end loop;
end;
$$;

alter table public.profile_chat_messages
  alter column sender_role type public.chat_sender_role
  using sender_role::public.chat_sender_role;

alter table public.boards
  add column if not exists layout_mode_override public.layout_mode,
  add column if not exists catalog_system public.color_system;

update public.boards
set
  layout_mode_override = case
    when (grid_override->>'layoutMode') in ('manual', 'automatic')
      then (grid_override->>'layoutMode')::public.layout_mode
    else layout_mode_override
  end,
  grid_override = case
    when grid_override is null then null
    when (grid_override->>'inheritGrid') = 'true' then null
    when private.valid_grid(grid_override - 'layoutMode' - 'inheritGrid')
      then grid_override - 'layoutMode' - 'inheritGrid'
    else null
  end
where grid_override is not null
  and (
    grid_override ? 'layoutMode'
    or grid_override ? 'inheritGrid'
  );

alter table public.profile_settings
  add column if not exists color_system public.color_system not null default 'custom',
  add column if not exists layout_mode public.layout_mode not null default 'manual',
  add column if not exists inactive_catalog_layouts jsonb not null default '{}'::jsonb;

update public.boards b
set color_key = (kv.value)::public.board_color
from public.profile_settings ps,
     jsonb_each_text(
       case
         when jsonb_typeof(ps.tile_appearance->'colorOverrides'->'boards') = 'object'
           then ps.tile_appearance->'colorOverrides'->'boards'
         else '{}'::jsonb
       end
     ) as kv(key, value)
where b.profile_id = ps.profile_id
  and b.id = kv.key
  and kv.value in ('yellow', 'white');

update public.tiles t
set color_key = (kv.value)::public.board_color
from public.profile_settings ps,
     jsonb_each_text(
       case
         when jsonb_typeof(ps.tile_appearance->'colorOverrides'->'tiles') = 'object'
           then ps.tile_appearance->'colorOverrides'->'tiles'
         else '{}'::jsonb
       end
     ) as kv(key, value)
where t.profile_id = ps.profile_id
  and t.id = kv.key
  and kv.value in ('yellow', 'white');

update public.boards b
set catalog_system = sys.key::public.color_system
from public.profile_settings ps,
     jsonb_each(
       case
         when jsonb_typeof(ps.tile_appearance->'inactiveCatalogLayouts') = 'object'
           then ps.tile_appearance->'inactiveCatalogLayouts'
         else '{}'::jsonb
       end
     ) as sys(key, value)
where b.profile_id = ps.profile_id
  and sys.key in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
  and jsonb_typeof(sys.value) = 'object'
  and jsonb_typeof(sys.value->'boards') = 'object'
  and b.id <> 'home'
  and not (b.id = any(ps.catalog_order))
  and (sys.value->'boards') ? b.id;

update public.profile_settings
set
  color_system = case
    when (tile_appearance->>'colorSystem') in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
      then (tile_appearance->>'colorSystem')::public.color_system
    else color_system
  end,
  layout_mode = case
    when (grid_config->>'layoutMode') in ('manual', 'automatic')
      then (grid_config->>'layoutMode')::public.layout_mode
    else layout_mode
  end,
  inactive_catalog_layouts = case
    when jsonb_typeof(tile_appearance->'inactiveCatalogLayouts') = 'object' then
      coalesce((
        select jsonb_object_agg(
          sys.key,
          jsonb_build_object(
            'home', coalesce(sys.value->'home', sys.value->'boards'->'home'),
            'catalogOrder', sys.value->'catalogOrder'
          )
        )
        from jsonb_each(tile_appearance->'inactiveCatalogLayouts') as sys(key, value)
        where sys.key in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
          and jsonb_typeof(sys.value) = 'object'
          and jsonb_typeof(coalesce(sys.value->'home', sys.value->'boards'->'home')) = 'object'
          and jsonb_typeof(sys.value->'catalogOrder') = 'array'
      ), '{}'::jsonb)
    else inactive_catalog_layouts
  end,
  tile_appearance = tile_appearance - 'colorSystem' - 'inactiveCatalogLayouts' - 'colorOverrides',
  grid_config = grid_config - 'layoutMode',
  access_config = access_config - 'pinVerifier';

-- ============================================================================
-- 6. Medium #7: Constraints, bounds, and touch_updated_at
-- ============================================================================
alter table public.profile_settings
  validate constraint profile_settings_no_pin_verifier;

create or replace function private.valid_pages(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  page jsonb;
  cell record;
begin
  if jsonb_typeof(value) is distinct from 'array' then return false; end if;
  if jsonb_array_length(value) = 0 or jsonb_array_length(value) > 50 then return false; end if;
  for page in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(page->'cells') is distinct from 'object' then return false; end if;
    for cell in select * from jsonb_each(page->'cells') loop
      -- Keep out-of-current-grid placements so resizing never discards vocabulary.
      if cell.key !~ '^(0|[1-9]|1[0-5]):(0|[1-9]|1[0-5])$'
        or jsonb_typeof(cell.value->'tileId') is distinct from 'string'
        or length(cell.value->>'tileId') = 0
        or (cell.value ? 'hidden' and jsonb_typeof(cell.value->'hidden') <> 'boolean')
      then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create or replace function private.valid_feature_flags(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'object'
    and not exists (
      select 1
      from jsonb_each(value) as e(k, v)
      where jsonb_typeof(v) is distinct from 'boolean'
    ),
    false
  );
$$;

create or replace function private.valid_inactive_catalog_layouts(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'object'
    and not exists (
      select 1
      from jsonb_each(value) as e(k, v)
      where k not in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
        or jsonb_typeof(v) is distinct from 'object'
        or jsonb_typeof(v->'home') is distinct from 'object'
        or jsonb_typeof(v->'catalogOrder') is distinct from 'array'
    ),
    false
  );
$$;

revoke all on function
  private.valid_feature_flags(jsonb),
  private.valid_inactive_catalog_layouts(jsonb)
from public;

grant execute on function
  private.valid_feature_flags(jsonb),
  private.valid_inactive_catalog_layouts(jsonb)
to authenticated;

alter table public.profile_settings
  drop constraint if exists appearance_valid,
  add constraint appearance_valid check (coalesce(
    jsonb_typeof(tile_appearance) = 'object'
    and tile_appearance ?& array['labelPosition','fontScale','iconScale','showIcons','gridGap','colorMode']
    and tile_appearance->>'labelPosition' in ('top','bottom')
    and tile_appearance->>'fontScale' in ('sm','md','lg')
    and tile_appearance->>'iconScale' in ('sm','md','lg')
    and jsonb_typeof(tile_appearance->'showIcons') = 'boolean'
    and tile_appearance->>'gridGap' in ('compact','normal','relaxed')
    and tile_appearance->>'colorMode' in ('catalog','wordClass','neutral')
    and (not (tile_appearance ? 'tileWidth') or (
      jsonb_typeof(tile_appearance->'tileWidth') = 'number'
      and (tile_appearance->>'tileWidth') ~ '^(100|[1-9][0-9]?)$'
    ))
    and (not (tile_appearance ? 'tileHeight') or (
      jsonb_typeof(tile_appearance->'tileHeight') = 'number'
      and (tile_appearance->>'tileHeight') ~ '^(100|[1-9][0-9]?)$'
    )), false)),
  drop constraint if exists speech_valid,
  add constraint speech_valid check (coalesce(
    jsonb_typeof(speech_config) = 'object'
    and speech_config ?& array['volume','speakOnTap','autoClear']
    and jsonb_typeof(speech_config->'volume') = 'number'
    and (speech_config->>'volume')::numeric between 0 and 1
    and jsonb_typeof(speech_config->'speakOnTap') = 'boolean'
    and speech_config->>'autoClear' in ('off','afterSpeak','nextTap')
    and (not (speech_config ? 'rate') or (
      jsonb_typeof(speech_config->'rate') = 'number'
      and (speech_config->>'rate')::numeric between 0.5 and 2
    )), false)),
  drop constraint if exists feature_flags_valid,
  add constraint feature_flags_valid check (private.valid_feature_flags(feature_flags)),
  drop constraint if exists inactive_catalog_layouts_valid,
  add constraint inactive_catalog_layouts_valid check (private.valid_inactive_catalog_layouts(inactive_catalog_layouts)),
  drop constraint if exists catalog_order_bounds,
  add constraint catalog_order_bounds check (cardinality(catalog_order) <= 200);

alter table public.boards
  drop constraint if exists boards_id_length,
  add constraint boards_id_length check (length(id) <= 128),
  drop constraint if exists boards_name_length,
  add constraint boards_name_length check (length(name) <= 120),
  drop constraint if exists boards_short_name_length,
  add constraint boards_short_name_length check (length(short_name) <= 64),
  drop constraint if exists boards_icon_name_length,
  add constraint boards_icon_name_length check (icon_name is null or length(icon_name) <= 128);

alter table public.tiles
  drop constraint if exists tiles_id_length,
  add constraint tiles_id_length check (length(id) <= 128),
  drop constraint if exists tiles_label_length,
  add constraint tiles_label_length check (length(label) <= 200),
  drop constraint if exists tiles_spoken_text_length,
  add constraint tiles_spoken_text_length check (spoken_text is null or length(spoken_text) <= 500),
  drop constraint if exists tiles_icon_name_length,
  add constraint tiles_icon_name_length check (icon_name is null or length(icon_name) <= 128);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 7. High #3: Set-based upsert/diff-delete publish_profile_snapshot
-- ============================================================================
drop function if exists public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb);

create or replace function public.publish_profile_snapshot(
  p_profile_id uuid,
  p_expected_revision integer,
  p_boards jsonb,
  p_tiles jsonb,
  p_words jsonb default '[]'::jsonb,
  p_settings jsonb default '{}'::jsonb,
  p_profile_name text default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner_id uuid;
  v_current_revision integer;
  v_next_revision integer;
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_board_overrides jsonb := coalesce(v_settings->'tile_appearance'->'colorOverrides'->'boards', '{}'::jsonb);
  v_tile_overrides jsonb := coalesce(v_settings->'tile_appearance'->'colorOverrides'->'tiles', '{}'::jsonb);
  v_inactive_board_systems jsonb := '{}'::jsonb;
  v_inactive_layouts jsonb := '{}'::jsonb;
  v_color_system public.color_system;
  v_layout_mode public.layout_mode;
  v_has_color_system boolean;
  v_has_layout_mode boolean;
  v_has_inactive_layouts boolean;
  v_grid_config jsonb;
  v_tile_appearance jsonb;
  v_access_config jsonb;
  v_catalog_order text[] := '{}'::text[];
  v_keep_board_ids text[] := '{}'::text[];
  v_keep_tile_ids text[] := '{}'::text[];
begin
  if v_uid is null or not private.can_edit_profile(p_profile_id) then
    raise exception 'PERMISSION_DENIED: Not authorized to edit this profile';
  end if;

  select revision, owner_id
    into v_current_revision, v_owner_id
  from public.profiles
  where id = p_profile_id
  for update;

  if v_current_revision is null then
    raise exception 'NOT_FOUND: Cloud profile does not exist';
  end if;

  if p_expected_revision is not null and v_current_revision <> p_expected_revision then
    raise exception 'STALE_REVISION: Cloud profile has revision %, expected %', v_current_revision, p_expected_revision;
  end if;

  if jsonb_typeof(v_board_overrides) is distinct from 'object' then
    v_board_overrides := '{}'::jsonb;
  end if;
  if jsonb_typeof(v_tile_overrides) is distinct from 'object' then
    v_tile_overrides := '{}'::jsonb;
  end if;

  v_has_color_system := (v_settings ? 'color_system')
    or (jsonb_typeof(v_settings->'tile_appearance') = 'object' and (v_settings->'tile_appearance') ? 'colorSystem');
  v_color_system := case
    when (v_settings->>'color_system') in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
      then (v_settings->>'color_system')::public.color_system
    when (v_settings->'tile_appearance'->>'colorSystem') in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
      then (v_settings->'tile_appearance'->>'colorSystem')::public.color_system
    else 'custom'::public.color_system
  end;

  v_has_layout_mode := (v_settings ? 'layout_mode')
    or (jsonb_typeof(v_settings->'grid_config') = 'object' and (v_settings->'grid_config') ? 'layoutMode');
  v_layout_mode := case
    when (v_settings->>'layout_mode') in ('manual', 'automatic')
      then (v_settings->>'layout_mode')::public.layout_mode
    when (v_settings->'grid_config'->>'layoutMode') in ('manual', 'automatic')
      then (v_settings->'grid_config'->>'layoutMode')::public.layout_mode
    else 'manual'::public.layout_mode
  end;

  v_has_inactive_layouts := (v_settings ? 'inactive_catalog_layouts')
    or (jsonb_typeof(v_settings->'tile_appearance') = 'object' and (v_settings->'tile_appearance') ? 'inactiveCatalogLayouts');

  if jsonb_typeof(v_settings->'inactive_catalog_layouts') = 'object' then
    v_inactive_layouts := v_settings->'inactive_catalog_layouts';
  elsif jsonb_typeof(v_settings->'tile_appearance'->'inactiveCatalogLayouts') = 'object' then
    select coalesce(
      jsonb_object_agg(
        sys.key,
        jsonb_build_object(
          'home', coalesce(sys.value->'home', sys.value->'boards'->'home'),
          'catalogOrder', sys.value->'catalogOrder'
        )
      ),
      '{}'::jsonb
    )
    into v_inactive_layouts
    from jsonb_each(v_settings->'tile_appearance'->'inactiveCatalogLayouts') as sys(key, value)
    where sys.key in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
      and jsonb_typeof(sys.value) = 'object'
      and jsonb_typeof(coalesce(sys.value->'home', sys.value->'boards'->'home')) = 'object'
      and jsonb_typeof(sys.value->'catalogOrder') = 'array';

    select coalesce(jsonb_object_agg(b.key, sys.key), '{}'::jsonb)
    into v_inactive_board_systems
    from jsonb_each(v_settings->'tile_appearance'->'inactiveCatalogLayouts') as sys(key, value),
         jsonb_each(
           case
             when jsonb_typeof(sys.value) = 'object' and jsonb_typeof(sys.value->'boards') = 'object'
               then sys.value->'boards'
             else '{}'::jsonb
           end
         ) as b(key, val)
    where sys.key in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
      and b.key <> 'home';
  end if;

  v_catalog_order := case
    when jsonb_typeof(v_settings->'catalog_order') = 'array'
      then array(select jsonb_array_elements_text(v_settings->'catalog_order'))
    else coalesce(
      (select ps.catalog_order from public.profile_settings ps where ps.profile_id = p_profile_id),
      '{}'::text[]
    )
  end;

  -- 1. Set-based upsert of deduplicated boards
  with raw_boards as (
    select
      b->>'id' as id,
      b->>'name' as name,
      b->>'short_name' as short_name,
      case
        when v_board_overrides ? (b->>'id') and (v_board_overrides->>(b->>'id')) in ('yellow', 'white')
          then (v_board_overrides->>(b->>'id'))::public.board_color
        else (b->>'color_key')::public.board_color
      end as color_key,
      b->>'icon_name' as icon_name,
      coalesce((b->>'is_built_in')::boolean, false) as is_built_in,
      case
        when b->'grid_override' is null
          or b->'grid_override' = 'null'::jsonb
          or (b->'grid_override'->>'inheritGrid') = 'true'
          then null
        else (b->'grid_override') - 'layoutMode' - 'inheritGrid'
      end as grid_override,
      case
        when (b->>'layout_mode_override') in ('manual', 'automatic')
          then (b->>'layout_mode_override')::public.layout_mode
        when (b->'grid_override'->>'layoutMode') in ('manual', 'automatic')
          then (b->'grid_override'->>'layoutMode')::public.layout_mode
        else null
      end as layout_mode_override,
      case
        when (b->>'catalog_system') in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
          then (b->>'catalog_system')::public.color_system
        when (v_inactive_board_systems ? (b->>'id'))
          and not ((b->>'id') = any(v_catalog_order))
          and (v_inactive_board_systems->>(b->>'id')) in ('custom', 'modifiedFitzgerald', 'tobiiDynavox')
          then (v_inactive_board_systems->>(b->>'id'))::public.color_system
        else null
      end as catalog_system,
      coalesce(b->'pages', '[{"cells":{}}]'::jsonb) as pages,
      ord
    from jsonb_array_elements(coalesce(p_boards, '[]'::jsonb)) with ordinality as t(b, ord)
    where nullif(b->>'id', '') is not null
  ),
  dedup_boards as (
    select distinct on (id)
      id, name, short_name, color_key, icon_name, is_built_in,
      grid_override, layout_mode_override, catalog_system, pages
    from raw_boards
    order by id, ord desc
  ),
  upserted as (
    insert into public.boards (
      profile_id, id, name, short_name, color_key, icon_name, is_built_in,
      grid_override, layout_mode_override, catalog_system, pages
    )
    select
      p_profile_id, id, name, short_name, color_key, icon_name, is_built_in,
      grid_override, layout_mode_override, catalog_system, pages
    from dedup_boards
    on conflict (profile_id, id) do update set
      name = excluded.name,
      short_name = excluded.short_name,
      color_key = excluded.color_key,
      icon_name = excluded.icon_name,
      is_built_in = excluded.is_built_in,
      grid_override = excluded.grid_override,
      layout_mode_override = excluded.layout_mode_override,
      catalog_system = excluded.catalog_system,
      pages = excluded.pages
    where (
      public.boards.name,
      public.boards.short_name,
      public.boards.color_key,
      public.boards.icon_name,
      public.boards.is_built_in,
      public.boards.grid_override,
      public.boards.layout_mode_override,
      public.boards.catalog_system,
      public.boards.pages
    ) is distinct from (
      excluded.name,
      excluded.short_name,
      excluded.color_key,
      excluded.icon_name,
      excluded.is_built_in,
      excluded.grid_override,
      excluded.layout_mode_override,
      excluded.catalog_system,
      excluded.pages
    )
    returning 1
  )
  select coalesce(array_agg(d.id), '{}'::text[])
  into v_keep_board_ids
  from dedup_boards d
  where (select count(*) from upserted) >= 0;

  -- 2. Set-based upsert of merged tiles + legacy words (preferring p_tiles)
  with raw_tiles as (
    select
      t->>'id' as id,
      (t->>'kind')::public.tile_kind as kind,
      t->>'label' as label,
      t->>'spoken_text' as spoken_text,
      t->>'icon_name' as icon_name,
      t->>'media_id' as media_id,
      (case when (t->>'language') in ('fil', 'en', 'taglish') then t->>'language' else 'fil' end)::public.language_tag as language,
      coalesce((t->>'is_quick_phrase')::boolean, false) as is_quick_phrase,
      t->>'category_id' as category_id,
      case when (t->>'kind') = 'folder' then t->>'target_board_id' else null end as target_board_id,
      case
        when v_tile_overrides ? (t->>'id') and (v_tile_overrides->>(t->>'id')) in ('yellow', 'white')
          then (v_tile_overrides->>(t->>'id'))::public.board_color
        when t->>'color_key' is null then null
        else (t->>'color_key')::public.board_color
      end as color_key,
      case when t->>'word_class' is null then null else (t->>'word_class')::public.word_class end as word_class,
      coalesce((t->>'is_custom')::boolean, false) as is_custom,
      1 as priority,
      ord
    from jsonb_array_elements(coalesce(p_tiles, '[]'::jsonb)) with ordinality as x(t, ord)
    where nullif(t->>'id', '') is not null
    union all
    select
      w->>'id' as id,
      'word'::public.tile_kind as kind,
      w->>'label' as label,
      w->>'spoken_text' as spoken_text,
      w->>'icon_name' as icon_name,
      w->>'media_id' as media_id,
      (case when (w->>'language') in ('fil', 'en', 'taglish') then w->>'language' else 'fil' end)::public.language_tag as language,
      coalesce((w->>'is_quick_phrase')::boolean, false) as is_quick_phrase,
      w->>'category_id' as category_id,
      null::text as target_board_id,
      case
        when v_tile_overrides ? (w->>'id') and (v_tile_overrides->>(w->>'id')) in ('yellow', 'white')
          then (v_tile_overrides->>(w->>'id'))::public.board_color
        when w->>'color_key' is null then null
        else (w->>'color_key')::public.board_color
      end as color_key,
      case when w->>'word_class' is null then null else (w->>'word_class')::public.word_class end as word_class,
      coalesce((w->>'is_custom')::boolean, false) as is_custom,
      0 as priority,
      ord
    from jsonb_array_elements(coalesce(p_words, '[]'::jsonb)) with ordinality as x(w, ord)
    where nullif(w->>'id', '') is not null
  ),
  dedup_tiles as (
    select distinct on (id)
      id, kind, label, spoken_text, icon_name, media_id, language, is_quick_phrase,
      category_id, target_board_id, color_key, word_class, is_custom
    from raw_tiles
    order by id, priority desc, ord desc
  ),
  upserted as (
    insert into public.tiles (
      profile_id, id, kind, label, spoken_text, icon_name, media_id, language, is_quick_phrase,
      category_id, target_board_id, color_key, word_class, is_custom
    )
    select
      p_profile_id, id, kind, label, spoken_text, icon_name, media_id, language, is_quick_phrase,
      category_id, target_board_id, color_key, word_class, is_custom
    from dedup_tiles
    on conflict (profile_id, id) do update set
      kind = excluded.kind,
      label = excluded.label,
      spoken_text = excluded.spoken_text,
      icon_name = excluded.icon_name,
      media_id = excluded.media_id,
      language = excluded.language,
      is_quick_phrase = excluded.is_quick_phrase,
      category_id = excluded.category_id,
      target_board_id = excluded.target_board_id,
      color_key = excluded.color_key,
      word_class = excluded.word_class,
      is_custom = excluded.is_custom
    where (
      public.tiles.kind,
      public.tiles.label,
      public.tiles.spoken_text,
      public.tiles.icon_name,
      public.tiles.media_id,
      public.tiles.language,
      public.tiles.is_quick_phrase,
      public.tiles.category_id,
      public.tiles.target_board_id,
      public.tiles.color_key,
      public.tiles.word_class,
      public.tiles.is_custom
    ) is distinct from (
      excluded.kind,
      excluded.label,
      excluded.spoken_text,
      excluded.icon_name,
      excluded.media_id,
      excluded.language,
      excluded.is_quick_phrase,
      excluded.category_id,
      excluded.target_board_id,
      excluded.color_key,
      excluded.word_class,
      excluded.is_custom
    )
    returning 1
  )
  select coalesce(array_agg(d.id), '{}'::text[])
  into v_keep_tile_ids
  from dedup_tiles d
  where (select count(*) from upserted) >= 0;

  -- 3. Diff-delete removed tiles then removed boards
  delete from public.tiles
  where profile_id = p_profile_id
    and not (id = any(v_keep_tile_ids));

  delete from public.boards
  where profile_id = p_profile_id
    and not (id = any(v_keep_board_ids));

  -- 4. Upsert normalized profile_settings
  v_grid_config := coalesce(
    case when jsonb_typeof(v_settings->'grid_config') = 'object'
      then (v_settings->'grid_config') - 'layoutMode'
      else null
    end,
    '{"rows":5,"cols":4}'::jsonb
  );
  v_tile_appearance := coalesce(
    case when jsonb_typeof(v_settings->'tile_appearance') = 'object'
      then (v_settings->'tile_appearance') - 'colorSystem' - 'inactiveCatalogLayouts' - 'colorOverrides'
      else null
    end,
    '{"labelPosition":"bottom","fontScale":"md","iconScale":"md","showIcons":true,"gridGap":"normal","colorMode":"catalog"}'::jsonb
  );
  v_access_config := coalesce(
    case when jsonb_typeof(v_settings->'access_config') = 'object'
      then (v_settings->'access_config') - 'pinVerifier'
      else null
    end,
    '{"longPressToEdit":true,"holdDurationMs":650,"moveTolerancePx":12,"swipeThresholdPx":60}'::jsonb
  );

  insert into public.profile_settings (
    profile_id,
    catalog_order,
    grid_config,
    tile_appearance,
    speech_config,
    access_config,
    feature_flags,
    color_system,
    layout_mode,
    inactive_catalog_layouts
  ) values (
    p_profile_id,
    v_catalog_order,
    v_grid_config,
    v_tile_appearance,
    coalesce(
      case when jsonb_typeof(v_settings->'speech_config') = 'object'
        then v_settings->'speech_config'
        else null
      end,
      '{"volume":1,"speakOnTap":true,"autoClear":"off"}'::jsonb
    ),
    v_access_config,
    coalesce(
      case when jsonb_typeof(v_settings->'feature_flags') = 'object'
        then v_settings->'feature_flags'
        else null
      end,
      '{}'::jsonb
    ),
    v_color_system,
    v_layout_mode,
    v_inactive_layouts
  )
  on conflict (profile_id) do update set
    catalog_order = case when v_settings ? 'catalog_order' then excluded.catalog_order else public.profile_settings.catalog_order end,
    grid_config = case when v_settings ? 'grid_config' then excluded.grid_config else public.profile_settings.grid_config end,
    tile_appearance = case when v_settings ? 'tile_appearance' then excluded.tile_appearance else public.profile_settings.tile_appearance end,
    speech_config = case when v_settings ? 'speech_config' then excluded.speech_config else public.profile_settings.speech_config end,
    access_config = case when v_settings ? 'access_config' then excluded.access_config else public.profile_settings.access_config end,
    feature_flags = case when v_settings ? 'feature_flags' then excluded.feature_flags else public.profile_settings.feature_flags end,
    color_system = case when v_has_color_system then excluded.color_system else public.profile_settings.color_system end,
    layout_mode = case when v_has_layout_mode then excluded.layout_mode else public.profile_settings.layout_mode end,
    inactive_catalog_layouts = case when v_has_inactive_layouts then excluded.inactive_catalog_layouts else public.profile_settings.inactive_catalog_layouts end;

  -- 5. Advance revision and apply owner-only profile rename
  v_next_revision := v_current_revision + 1;
  update public.profiles
  set
    revision = v_next_revision,
    name = case
      when p_profile_name is not null
        and length(btrim(p_profile_name)) between 1 and 120
        and v_owner_id = v_uid
      then btrim(p_profile_name)
      else name
    end
  where id = p_profile_id;

  return v_next_revision;
end;
$$;

revoke all on function public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb, text) to authenticated;

-- ============================================================================
-- 8. Medium #8: Single-query send_profile_chat_message
-- ============================================================================
create or replace function public.send_profile_chat_message(
  p_profile_id uuid,
  p_text text,
  p_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_can_read boolean;
  v_can_edit boolean;
  v_trimmed text;
  v_account_role text;
  v_display_name text;
  v_sender_role public.chat_sender_role;
  v_sender_name text;
  v_msg_id uuid;
  v_row public.profile_chat_messages%rowtype;
  v_payload jsonb;
  v_inserted boolean;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'PERMISSION_DENIED: Not authorized to chat in this profile';
  end if;

  select
    (p.owner_id = v_uid or pm.user_id is not null),
    (p.owner_id = v_uid or pm.role = 'editor'::public.profile_member_role),
    ua.role::text,
    ua.display_name
  into v_can_read, v_can_edit, v_account_role, v_display_name
  from public.profiles p
  left join public.profile_memberships pm
    on pm.profile_id = p.id
   and pm.user_id = v_uid
  left join public.user_accounts ua
    on ua.user_id = v_uid
  where p.id = p_profile_id;

  if not coalesce(v_can_read, false) then
    raise exception 'PERMISSION_DENIED: Not authorized to chat in this profile';
  end if;

  v_trimmed := btrim(coalesce(p_text, ''));
  if length(v_trimmed) < 1 or length(v_trimmed) > 1000 then
    raise exception 'INVALID_MESSAGE: Message text must be between 1 and 1000 characters';
  end if;

  if coalesce(v_can_edit, false) and v_account_role in ('PARENT', 'CAREGIVER') then
    v_sender_role := 'guardian'::public.chat_sender_role;
  else
    v_sender_role := 'child'::public.chat_sender_role;
  end if;

  v_sender_name := coalesce(
    nullif(btrim(v_display_name), ''),
    case when v_sender_role = 'guardian'::public.chat_sender_role then 'Guardian' else 'Child' end
  );

  v_msg_id := coalesce(p_message_id, gen_random_uuid());

  insert into public.profile_chat_messages (
    id,
    profile_id,
    sender_user_id,
    sender_role,
    sender_name,
    text
  )
  values (
    v_msg_id,
    p_profile_id,
    v_uid,
    v_sender_role,
    v_sender_name,
    v_trimmed
  )
  on conflict (id) do nothing
  returning * into v_row;
  v_inserted := found;

  if not v_inserted then
    select *
      into v_row
      from public.profile_chat_messages
     where id = v_msg_id
       and profile_id = p_profile_id
       and sender_user_id = v_uid;

    if not found then
      raise exception 'MESSAGE_ID_CONFLICT: Message ID is unavailable';
    end if;
  end if;

  v_payload := jsonb_build_object(
    'id', v_row.id::text,
    'sender', v_row.sender_role::text,
    'text', v_row.text,
    'senderUserId', v_row.sender_user_id::text,
    'senderName', v_row.sender_name,
    'verified', true,
    'createdAt', v_row.created_at
  );

  if v_inserted then
    begin
      perform realtime.send(
        jsonb_build_object('id', v_row.id::text),
        'chat:message',
        'wikahon:parent-child-chat:' || p_profile_id::text,
        true
      );
    exception when others then
      null;
    end;
  end if;

  return v_payload;
end;
$$;

revoke all on function public.send_profile_chat_message(uuid, text, uuid) from public, anon;
grant execute on function public.send_profile_chat_message(uuid, text, uuid) to authenticated;

commit;
