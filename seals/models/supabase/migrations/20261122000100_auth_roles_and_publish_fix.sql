-- App user roles, server-controlled user_accounts table, and security-definer
-- publish_profile_snapshot update supporting public.words and editor members.
begin;

create type public.app_user_role as enum ('PARENT', 'CAREGIVER', 'CHILD');

create table public.user_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (length(btrim(username)) between 2 and 64),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  role public.app_user_role not null default 'CHILD',
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_accounts enable row level security;

create policy user_accounts_self_read on public.user_accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

create trigger touch_updated_at before update on public.user_accounts
  for each row execute function private.touch_updated_at();

revoke all on public.user_accounts from anon, authenticated;
grant select on public.user_accounts to authenticated;

drop function if exists public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb);

create or replace function public.publish_profile_snapshot(
  p_profile_id uuid,
  p_expected_revision integer,
  p_boards jsonb,
  p_tiles jsonb,
  p_words jsonb default '[]'::jsonb,
  p_settings jsonb default '{}'::jsonb
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
  update public.profiles set revision = v_next_revision where id = p_profile_id;
  return v_next_revision;
end;
$$;

revoke all on function public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb) to authenticated;

commit;
