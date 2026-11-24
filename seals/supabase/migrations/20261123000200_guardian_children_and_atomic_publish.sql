-- Guardian-child linkage on user_accounts and atomic profile rename inside publish_profile_snapshot.
begin;

-- 1. Link child accounts directly to their guardian auth user
alter table public.user_accounts
  add column if not exists guardian_id uuid references auth.users(id) on delete set null;

create index if not exists user_accounts_guardian_id_idx
  on public.user_accounts(guardian_id);

-- Backfill existing CHILD rows using the earliest profile owner linked via profile_memberships
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

-- 2. Populate guardian_id from raw_app_meta_data when provisioning auth users
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

-- 3. Atomic snapshot publish with optional owner-only profile rename
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
  v_current_revision integer;
  v_next_revision integer;
  v_board jsonb;
  v_word jsonb;
  v_tile jsonb;
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
begin
  if not private.can_edit_profile(p_profile_id) then
    raise exception 'PERMISSION_DENIED: Not authorized to edit this profile';
  end if;

  select revision into v_current_revision
  from public.profiles
  where id = p_profile_id
  for update;

  if v_current_revision is null then
    raise exception 'NOT_FOUND: Cloud profile does not exist';
  end if;

  if p_expected_revision is not null and v_current_revision <> p_expected_revision then
    raise exception 'STALE_REVISION: Cloud profile has revision %, expected %', v_current_revision, p_expected_revision;
  end if;

  -- Replace snapshot atomically inside this transaction
  delete from public.words where profile_id = p_profile_id;
  delete from public.tiles where profile_id = p_profile_id;
  delete from public.boards where profile_id = p_profile_id;

  for v_board in select * from jsonb_array_elements(coalesce(p_boards, '[]'::jsonb)) loop
    insert into public.boards (
      profile_id, id, name, short_name, color_key, icon_name, is_built_in, grid_override, pages
    ) values (
      p_profile_id,
      v_board->>'id',
      v_board->>'name',
      v_board->>'short_name',
      (v_board->>'color_key')::public.board_color,
      v_board->>'icon_name',
      coalesce((v_board->>'is_built_in')::boolean, false),
      case when v_board->'grid_override' is null or v_board->'grid_override' = 'null'::jsonb then null else v_board->'grid_override' end,
      coalesce(v_board->'pages', '[{"cells":{}}]'::jsonb)
    );
  end loop;

  for v_word in select * from jsonb_array_elements(coalesce(p_words, '[]'::jsonb)) loop
    insert into public.words (
      profile_id, id, label, spoken_text, icon_name, media_id, language,
      category_id, color_key, word_class, is_custom, is_quick_phrase
    ) values (
      p_profile_id,
      v_word->>'id',
      v_word->>'label',
      v_word->>'spoken_text',
      v_word->>'icon_name',
      v_word->>'media_id',
      coalesce(v_word->>'language', 'fil'),
      v_word->>'category_id',
      case when v_word->>'color_key' is null then null else (v_word->>'color_key')::public.board_color end,
      case when v_word->>'word_class' is null then null else (v_word->>'word_class')::public.word_class end,
      coalesce((v_word->>'is_custom')::boolean, false),
      coalesce((v_word->>'is_quick_phrase')::boolean, false)
    );
  end loop;

  for v_tile in select * from jsonb_array_elements(coalesce(p_tiles, '[]'::jsonb)) loop
    insert into public.tiles (
      profile_id, id, kind, label, spoken_text, icon_name, media_id, language, is_quick_phrase,
      category_id, target_board_id, color_key, word_class, is_custom
    ) values (
      p_profile_id,
      v_tile->>'id',
      (v_tile->>'kind')::public.tile_kind,
      v_tile->>'label',
      v_tile->>'spoken_text',
      v_tile->>'icon_name',
      v_tile->>'media_id',
      coalesce(v_tile->>'language', 'fil'),
      coalesce((v_tile->>'is_quick_phrase')::boolean, false),
      v_tile->>'category_id',
      v_tile->>'target_board_id',
      case when v_tile->>'color_key' is null then null else (v_tile->>'color_key')::public.board_color end,
      case when v_tile->>'word_class' is null then null else (v_tile->>'word_class')::public.word_class end,
      coalesce((v_tile->>'is_custom')::boolean, false)
    );
  end loop;

  insert into public.profile_settings (
    profile_id, catalog_order, grid_config, tile_appearance, speech_config, access_config, feature_flags
  ) values (
    p_profile_id,
    case
      when jsonb_typeof(v_settings->'catalog_order') = 'array'
        then array(select jsonb_array_elements_text(v_settings->'catalog_order'))
      else '{}'::text[]
    end,
    coalesce(v_settings->'grid_config', '{"rows":5,"cols":4}'::jsonb),
    coalesce(v_settings->'tile_appearance', '{"labelPosition":"bottom","fontScale":"md","iconScale":"md","showIcons":true,"gridGap":"normal","colorMode":"catalog"}'::jsonb),
    coalesce(v_settings->'speech_config', '{"volume":1,"speakOnTap":true,"autoClear":"off"}'::jsonb),
    coalesce(v_settings->'access_config', '{"longPressToEdit":true,"holdDurationMs":650,"moveTolerancePx":12,"swipeThresholdPx":60}'::jsonb),
    coalesce(v_settings->'feature_flags', '{}'::jsonb)
  )
  on conflict (profile_id) do update set
    catalog_order = case when v_settings ? 'catalog_order' then excluded.catalog_order else public.profile_settings.catalog_order end,
    grid_config = case when v_settings ? 'grid_config' then excluded.grid_config else public.profile_settings.grid_config end,
    tile_appearance = case when v_settings ? 'tile_appearance' then excluded.tile_appearance else public.profile_settings.tile_appearance end,
    speech_config = case when v_settings ? 'speech_config' then excluded.speech_config else public.profile_settings.speech_config end,
    access_config = case when v_settings ? 'access_config' then excluded.access_config else public.profile_settings.access_config end,
    feature_flags = case when v_settings ? 'feature_flags' then excluded.feature_flags else public.profile_settings.feature_flags end;

  v_next_revision := v_current_revision + 1;
  update public.profiles
  set
    revision = v_next_revision,
    name = case
      when p_profile_name is not null
        and length(btrim(p_profile_name)) between 1 and 120
        and private.owns_profile(p_profile_id)
      then btrim(p_profile_name)
      else name
    end
  where id = p_profile_id;

  return v_next_revision;
end;
$$;

revoke all on function public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb, text) to authenticated;

commit;
