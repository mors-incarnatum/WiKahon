-- Extended board_color enum values and compact domain enum types.
-- Executed outside a transaction block so ALTER TYPE ... ADD VALUE commits
-- before subsequent migrations reference the new enum values in DML.

alter type public.board_color add value if not exists 'yellow';
alter type public.board_color add value if not exists 'white';

do $$
begin
  create type public.language_tag as enum ('fil', 'en', 'taglish');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.chat_sender_role as enum ('guardian', 'child');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.layout_mode as enum ('manual', 'automatic');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.color_system as enum ('custom', 'modifiedFitzgerald', 'tobiiDynavox');
exception
  when duplicate_object then null;
end $$;
