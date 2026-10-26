-- Explicitly remove anonymous execution from all client-facing PWA RPCs.
revoke all on function public.trameli_upsert_push_subscription(text,text,text,text,text) from anon;
revoke all on function public.trameli_disable_push_subscription(text) from anon;
revoke all on function public.trameli_mark_notification_read(uuid) from anon;
revoke all on function public.trameli_unread_notification_count() from anon;
revoke all on function public.trameli_notification_inbox(integer) from anon;
revoke all on function public.trameli_create_notification(text,text,text,text,uuid[]) from anon;
revoke all on function public.trameli_queue_order_event(uuid,text) from anon;
revoke all on function public.trameli_push_public_key() from anon;

grant execute on function public.trameli_upsert_push_subscription(text,text,text,text,text) to authenticated;
grant execute on function public.trameli_disable_push_subscription(text) to authenticated;
grant execute on function public.trameli_mark_notification_read(uuid) to authenticated;
grant execute on function public.trameli_unread_notification_count() to authenticated;
grant execute on function public.trameli_notification_inbox(integer) to authenticated;
grant execute on function public.trameli_create_notification(text,text,text,text,uuid[]) to authenticated;
grant execute on function public.trameli_queue_order_event(uuid,text) to authenticated;
grant execute on function public.trameli_push_public_key() to authenticated;

create index if not exists trameli_notifications_created_by_idx
  on public.trameli_notifications(created_by)
  where created_by is not null;
