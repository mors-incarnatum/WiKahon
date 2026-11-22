-- Security hardening: remove shadow password_hash storage, lock down Realtime
-- chat broadcast channels to profile readers, and add NOT VALID integrity checks.
begin;

-- (a) Rely solely on Supabase Auth for password verification.
drop function if exists public.set_own_password_hash(text);
alter table public.user_accounts drop column if exists password_hash;

-- (b) Extract profile UUID from private chat channel topics ("wikahon:parent-child-chat:<uuid>").
create or replace function private.chat_topic_profile_id(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_topic ~ '^wikahon:parent-child-chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_topic, ':', 3)::uuid
    else null
  end;
$$;

grant usage on schema private to authenticated;
revoke all on function private.chat_topic_profile_id(text) from public;
grant execute on function private.chat_topic_profile_id(text) to authenticated;

-- (c) Scope Realtime Broadcast messages to authenticated profile readers.
drop policy if exists chat_broadcast_read on realtime.messages;
create policy chat_broadcast_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.can_read_profile(private.chat_topic_profile_id((select realtime.topic())))
  );

drop policy if exists chat_broadcast_insert on realtime.messages;
create policy chat_broadcast_insert on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and private.can_read_profile(private.chat_topic_profile_id((select realtime.topic())))
  );

-- (d) NOT VALID CHECK constraints for new/updated rows without breaking legacy rows.
-- Note: speech_valid (20261117000200) already enforces speech_config->>'provider' in ('local','cloud-puter','none').
alter table public.profile_settings
  drop constraint if exists profile_settings_no_pin_verifier,
  add constraint profile_settings_no_pin_verifier
    check (not (access_config ? 'pinVerifier')) not valid;

alter table public.tiles
  drop constraint if exists tiles_language_valid,
  add constraint tiles_language_valid
    check (language is null or language in ('fil', 'en', 'taglish')) not valid;

alter table public.words
  drop constraint if exists words_language_valid,
  add constraint words_language_valid
    check (language is null or language in ('fil', 'en', 'taglish')) not valid;

commit;
