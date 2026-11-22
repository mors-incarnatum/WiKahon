begin;

-- 1. Revoke public execution of resolve_login_email
revoke all on function public.resolve_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text) to service_role;

-- 2. Verified Chat Messages Table
create table if not exists public.profile_chat_messages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('guardian', 'child')),
  sender_name text not null check (length(btrim(sender_name)) between 1 and 120),
  text text not null check (length(btrim(text)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists profile_chat_messages_profile_created_idx
  on public.profile_chat_messages(profile_id, created_at desc);

alter table public.profile_chat_messages enable row level security;

drop policy if exists chat_messages_read on public.profile_chat_messages;
create policy chat_messages_read on public.profile_chat_messages
  for select to authenticated
  using (private.can_read_profile(profile_id));

revoke all on public.profile_chat_messages from anon, authenticated;
grant select on public.profile_chat_messages to authenticated;

-- 3. Trusted Chat Send RPC
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
  v_trimmed text;
  v_account_role text;
  v_display_name text;
  v_sender_role text;
  v_sender_name text;
  v_msg_id uuid;
  v_row public.profile_chat_messages%rowtype;
  v_payload jsonb;
  v_inserted boolean;
begin
  v_uid := (select auth.uid());
  if v_uid is null or not private.can_read_profile(p_profile_id) then
    raise exception 'PERMISSION_DENIED: Not authorized to chat in this profile';
  end if;

  v_trimmed := btrim(coalesce(p_text, ''));
  if length(v_trimmed) < 1 or length(v_trimmed) > 1000 then
    raise exception 'INVALID_MESSAGE: Message text must be between 1 and 1000 characters';
  end if;

  select ua.role, ua.display_name
    into v_account_role, v_display_name
    from public.user_accounts ua
   where ua.user_id = v_uid;

  if private.can_edit_profile(p_profile_id) and v_account_role in ('PARENT', 'CAREGIVER') then
    v_sender_role := 'guardian';
  else
    v_sender_role := 'child';
  end if;

  v_sender_name := coalesce(
    nullif(btrim(v_display_name), ''),
    case when v_sender_role = 'guardian' then 'Guardian' else 'Child' end
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
    'sender', v_row.sender_role,
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

-- 4. Drop direct client broadcast INSERT policy on realtime.messages
drop policy if exists chat_broadcast_insert on realtime.messages;

commit;
