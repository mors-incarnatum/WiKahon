-- Revoke explicit anon execute privilege granted by Supabase default privileges
-- on public.publish_profile_snapshot (only authenticated users may invoke it).
revoke all on function public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.publish_profile_snapshot(uuid, integer, jsonb, jsonb, jsonb, jsonb, text)
  to authenticated;
