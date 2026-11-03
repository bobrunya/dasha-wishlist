-- Уведомления: при каждом событии база сразу «будит» функцию notify; раз в 5 минут — повтор неотправленных.
-- Секрет лежит в Vault (vault.create_secret(..., 'notify_secret')), в коде его нет.
create or replace function kick_notify() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'notify_secret';
  if s is null then return; end if;
  perform net.http_post(
    url := 'https://tagqsgqzfagecolyeddr.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', s),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
end $$;
revoke execute on function kick_notify() from public, anon, authenticated;

create or replace function outbox_kick() returns trigger language plpgsql security definer set search_path = public as $$
begin perform kick_notify(); return null; end $$;
drop trigger if exists outbox_kick on notification_outbox;
create trigger outbox_kick after insert on notification_outbox for each statement execute function outbox_kick();

select cron.unschedule(jobid) from cron.job where jobname = 'notify-retry';
select cron.schedule('notify-retry', '*/5 * * * *',
  $$select public.kick_notify() where exists (select 1 from public.notification_outbox where sent_at is null and attempts < 5)$$);
