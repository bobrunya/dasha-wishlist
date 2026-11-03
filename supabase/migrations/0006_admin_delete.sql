-- Полное удаление заявки администратором (для тестов и ошибок). В журнале остаётся запись об удалении.
create or replace function admin_delete_contribution(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contributions; paths text[];
begin
  perform require_admin();
  select * into c from contributions where id = p_id for update;
  if not found then raise exception 'not_found' using hint = 'Заявка не найдена.'; end if;
  perform 1 from gifts where id = c.gift_id for update;
  select coalesce(array_agg(storage_path), '{}') into paths from receipts where contribution_id = c.id;
  delete from receipts where contribution_id = c.id;
  delete from conflicts where contribution_id = c.id;
  delete from reservations where contribution_id = c.id;
  delete from notification_outbox where payload->>'id' = c.id::text and sent_at is null;
  delete from contributions where id = c.id;
  insert into audit_log (actor, action, entity, entity_id, before) values (actor(), 'contribution.delete', 'contribution', c.id::text,
    to_jsonb(c) - 'cancel_token_hash');
  return jsonb_build_object('receipts', to_jsonb(paths));   -- файлы чеков удаляет клиент
end $$;
grant execute on function admin_delete_contribution(uuid) to authenticated;

drop policy if exists "receipts admin delete" on storage.objects;
create policy "receipts admin delete" on storage.objects for delete to authenticated using (bucket_id = 'receipts' and public.is_admin());
