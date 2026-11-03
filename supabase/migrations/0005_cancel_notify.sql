-- Уведомление, когда гость сам отменяет выбор
create or replace function cancel_my_contribution(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c contributions;
begin
  c := donor_contribution(p_id, p_token);
  if c.status <> 'pending_transfer' then
    raise exception 'bad_status' using hint = 'Эту заявку уже нельзя отменить самостоятельно — напишите Даше.';
  end if;
  update contributions set status = 'cancelled', cancelled_at = now() where id = c.id;
  update reservations set released_at = now(), release_reason = 'cancelled' where contribution_id = c.id and released_at is null;
  insert into audit_log (actor, action, entity, entity_id) values ('donor', 'contribution.cancel', 'contribution', c.id::text);
  insert into notification_outbox (event, payload) values ('cancelled', jsonb_build_object('id', c.id));
  return jsonb_build_object('status', 'cancelled');
end $$;
grant execute on function cancel_my_contribution(uuid, text) to anon, authenticated;
