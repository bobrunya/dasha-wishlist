-- =====================================================================
-- Этап C: бизнес-логика. Все операции с деньгами — атомарно в БД,
-- с блокировкой строки подарка (SELECT ... FOR UPDATE).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Денежные помощники (точная арифметика numeric) ----------
create or replace function current_rate() returns exchange_rates
language sql stable as $$
  select * from exchange_rates order by created_at desc, id desc limit 1
$$;

-- Максимум к переводу в валюте оплаты, чтобы покрыть остаток (вверх до целых рублей/рупий)
create or replace function pay_limit(p_avail bigint, p_gift currency_code, p_pay currency_code, p_rate numeric)
returns bigint language sql immutable as $$
  select case
    when p_gift = p_pay then p_avail
    when p_gift = 'IDR' and p_pay = 'RUB' then (ceil(p_avail / p_rate))::bigint * 100     -- рубли целые → копейки
    else ceil(p_avail * p_rate / 100)::bigint                                              -- RUB-подарок, оплата в IDR
  end
$$;

-- Сколько засчитать в цель (вниз)
create or replace function credit_amount(p_pay_minor bigint, p_pay currency_code, p_gift currency_code, p_rate numeric)
returns bigint language sql immutable as $$
  select case
    when p_gift = p_pay then p_pay_minor
    when p_pay = 'RUB' then floor(p_pay_minor * p_rate / 100)::bigint
    else floor(p_pay_minor * 100 / p_rate)::bigint
  end
$$;

create or replace function gift_confirmed(p_gift uuid) returns bigint
language sql stable as $$
  select coalesce(sum(gift_amount_minor), 0)::bigint from contributions
  where gift_id = p_gift and status = 'confirmed'
$$;

create or replace function gift_reserved(p_gift uuid) returns bigint
language sql stable as $$
  select coalesce(sum(r.amount_minor), 0)::bigint
  from reservations r join contributions c on c.id = r.contribution_id
  where r.gift_id = p_gift and r.released_at is null
    and c.status in ('pending_transfer', 'awaiting_confirmation')
    and (r.expires_at is null or r.expires_at > now())
$$;

create or replace function token_hash(p_token text) returns bytea
language sql immutable as $$ select extensions.digest(p_token, 'sha256') $$;

create or replace function actor() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', 'system')
$$;

create or replace function payment_public(p_cur currency_code) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('currency', currency, 'recipientName', recipient_name,
                            'detailsText', details_text, 'instructions', instructions)
  from payment_settings where currency = p_cur and is_enabled
$$;
revoke execute on function payment_public(currency_code) from public, anon, authenticated;

-- ---------- Публичный каталог ----------
create or replace function get_catalog() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object(
        'heroImagePath', s.hero_image_path, 'welcomeText', s.welcome_text,
        'telegramContact', s.telegram_contact, 'countdownEndsAt', s.countdown_ends_at,
        'acceptingContributions', s.accepting_contributions,
        'idrPerRub', (select idr_per_rub::text from current_rate()),
        'currencies', jsonb_build_object(
          'RUB', exists(select 1 from payment_settings where currency='RUB' and is_enabled),
          'IDR', exists(select 1 from payment_settings where currency='IDR' and is_enabled)))
      from site_settings s),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'title', title) order by sort_order), '[]') from gift_categories),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'slug', g.slug, 'sortOrder', g.sort_order,
        'category', (select slug from gift_categories c where c.id = g.category_id),
        'title', g.title, 'description', g.description, 'publicNote', g.public_note,
        'kind', g.kind, 'currency', g.currency, 'goalMinor', g.goal_minor,
        'unitPriceMinor', g.unit_price_minor, 'unitLabel', g.unit_label,
        'targetQuantity', g.target_quantity, 'minOrderQuantity', g.min_order_quantity,
        'isOpen', g.is_open,
        'confirmedMinor', gift_confirmed(g.id), 'reservedMinor', gift_reserved(g.id),
        'donorNames', (select coalesce(jsonb_agg(distinct c.donor_name), '[]') from contributions c
                       where c.gift_id = g.id and c.status = 'confirmed' and c.show_name_publicly),
        'images', (select coalesce(jsonb_agg(jsonb_build_object('path', i.storage_path, 'alt', i.alt, 'kind', i.kind) order by i.sort_order), '[]')
                   from gift_images i where i.gift_id = g.id)
      ) order by g.sort_order), '[]') from gifts g where g.is_visible)
  )
$$;
grant execute on function get_catalog() to anon, authenticated;

-- ---------- Ограничение частоты ----------
create or replace function hit_rate_limit(p_key text, p_bucket text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz := date_bin(p_window, now(), timestamptz '2000-01-01'); n int;
begin
  if p_key is null or p_key = '' then return false; end if;
  insert into rate_limits(key_hash, bucket, window_start, hits) values (p_key, p_bucket, w, 1)
  on conflict (key_hash, bucket, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  return n > p_max;
end $$;
revoke execute on function hit_rate_limit(text, text, int, interval) from public, anon, authenticated;

-- ---------- Создание заявки (вызывается только Edge Function с service role) ----------
create or replace function create_contribution(p jsonb, p_client_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  g gifts; r exchange_rates; s site_settings; a admin_settings;
  v_pay currency_code := (p->>'payCurrency')::currency_code;
  v_amount bigint := nullif(p->>'payAmountMinor', '')::bigint;
  v_qty int := nullif(p->>'quantity', '')::int;
  v_name text := btrim(coalesce(p->>'donorName', ''));
  v_tg text := '@' || regexp_replace(btrim(coalesce(p->>'donorTelegram', '')), '^(https?://t\.me/|@)', '');
  v_key uuid := (p->>'idempotencyKey')::uuid;
  v_goal bigint; v_avail bigint; v_limit bigint; v_credit bigint;
  v_token text; c contributions; v_exp timestamptz;
begin
  if hit_rate_limit(p_client_key, 'create', 12, interval '1 hour') then
    raise exception 'rate_limited' using hint = 'Слишком много заявок подряд. Попробуйте через час.';
  end if;

  select * into c from contributions where idempotency_key = v_key;
  if found then raise exception 'duplicate' using hint = 'Эта заявка уже отправлена.'; end if;

  select * into s from site_settings;
  if not s.accepting_contributions then raise exception 'paused' using hint = 'Приём подарков сейчас приостановлен.'; end if;

  if length(v_name) < 1 or length(v_name) > 80 then raise exception 'bad_name' using hint = 'Укажите имя.'; end if;
  if v_tg !~ '^@[A-Za-z0-9_]{5,32}$' then raise exception 'bad_telegram' using hint = 'Проверьте ник в Telegram.'; end if;
  if payment_public(v_pay) is null then raise exception 'currency_off' using hint = 'Эта валюта сейчас недоступна.'; end if;

  select * into g from gifts where id = (p->>'giftId')::uuid for update;   -- блокировка подарка
  if not found or not g.is_visible or not g.is_open then raise exception 'closed' using hint = 'Этот подарок сейчас недоступен.'; end if;

  r := current_rate();
  v_goal := gift_goal_minor(g);
  v_avail := case when v_goal is null then null else v_goal - gift_confirmed(g.id) - gift_reserved(g.id) end;

  if g.kind = 'quantity' and v_qty is not null then
    if v_qty < g.min_order_quantity then raise exception 'min_qty' using hint = format('Минимум %s шт.', g.min_order_quantity); end if;
    v_amount := pay_limit(g.unit_price_minor * v_qty, g.currency, v_pay, r.idr_per_rub);   -- сумму считает сервер
  elsif g.kind = 'quantity' and g.min_order_quantity > 1 then
    raise exception 'qty_required' using hint = format('Этот подарок оформляется от %s шт.', g.min_order_quantity);
  end if;

  if v_amount is null or v_amount <= 0 then raise exception 'bad_amount' using hint = 'Укажите сумму.'; end if;
  if v_pay = 'RUB' and v_amount % 100 <> 0 then raise exception 'bad_amount' using hint = 'Сумма в рублях — целым числом.'; end if;
  if v_amount > 100000000000 then raise exception 'bad_amount' using hint = 'Слишком большая сумма.'; end if;

  if v_avail is not null then
    if v_avail <= 0 then raise exception 'too_much' using hint = 'Оставшаяся сумма уже забронирована. Загляните чуть позже.'; end if;
    v_limit := pay_limit(v_avail, g.currency, v_pay, r.idr_per_rub);
    if v_amount > v_limit then raise exception 'too_much' using hint = 'Сумма больше, чем осталось собрать. Обновите страницу.'; end if;
  end if;

  v_credit := credit_amount(v_amount, v_pay, g.currency, r.idr_per_rub);
  if v_avail is not null then v_credit := least(v_credit, v_avail); end if;
  if v_credit <= 0 then raise exception 'too_little' using hint = 'Слишком маленькая сумма.'; end if;

  select * into a from admin_settings;
  v_token := encode(gen_random_bytes(24), 'hex');
  v_exp := now() + make_interval(hours => a.reservation_hours);

  insert into contributions (gift_id, donor_name, donor_telegram, show_name_publicly, pay_currency, pay_amount_minor,
                             gift_currency, gift_amount_minor, quantity, rate_id, idr_per_rub, cancel_token_hash, idempotency_key)
  values (g.id, v_name, v_tg, coalesce((p->>'showNamePublicly')::boolean, false), v_pay, v_amount,
          g.currency, v_credit, case when g.kind = 'quantity' then v_qty end, r.id, r.idr_per_rub, token_hash(v_token), v_key)
  returning * into c;

  insert into reservations (contribution_id, gift_id, amount_minor, expires_at) values (c.id, g.id, v_credit, v_exp);
  insert into audit_log (actor, action, entity, entity_id, after) values ('donor', 'contribution.create', 'contribution', c.id::text,
    jsonb_build_object('gift', g.slug, 'pay', v_amount, 'currency', v_pay, 'credit', v_credit));
  insert into notification_outbox (event, payload) values ('new', jsonb_build_object('id', c.id));

  return jsonb_build_object('id', c.id, 'publicRef', c.public_ref, 'cancelToken', v_token, 'status', c.status,
    'expiresAt', v_exp, 'payCurrency', v_pay, 'payAmountMinor', v_amount, 'giftAmountMinor', v_credit,
    'payment', payment_public(v_pay));
end $$;
revoke execute on function create_contribution(jsonb, text) from public, anon, authenticated;

-- ---------- Действия дарителя по секретной ссылке ----------
create or replace function donor_contribution(p_id uuid, p_token text) returns contributions
language plpgsql stable security definer set search_path = public, extensions as $$
declare c contributions;
begin
  select * into c from contributions where id = p_id and cancel_token_hash = token_hash(p_token);
  if not found then raise exception 'not_found' using hint = 'Заявка не найдена.'; end if;
  return c;
end $$;
revoke execute on function donor_contribution(uuid, text) from public, anon, authenticated;

create or replace function get_my_contribution(p_id uuid, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare c contributions; v_exp timestamptz;
begin
  c := donor_contribution(p_id, p_token);
  select expires_at into v_exp from reservations where contribution_id = c.id;
  return jsonb_build_object('id', c.id, 'publicRef', c.public_ref, 'status', c.status, 'expiresAt', v_exp,
    'payCurrency', c.pay_currency, 'payAmountMinor', c.pay_amount_minor, 'giftAmountMinor', c.gift_amount_minor,
    'hasReceipt', exists(select 1 from receipts where contribution_id = c.id),
    'payment', payment_public(c.pay_currency));
end $$;
grant execute on function get_my_contribution(uuid, text) to anon, authenticated;

create or replace function report_paid(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c contributions; v_expired boolean;
begin
  c := donor_contribution(p_id, p_token);
  if c.status = 'awaiting_confirmation' or c.status = 'confirmed' then
    return jsonb_build_object('status', c.status);                -- повторное нажатие — без изменений
  end if;
  if c.status not in ('pending_transfer', 'expired') then
    raise exception 'bad_status' using hint = 'Эта заявка уже закрыта.';
  end if;
  perform 1 from gifts where id = c.gift_id for update;
  v_expired := c.status = 'expired' or exists(select 1 from reservations where contribution_id = c.id and expires_at <= now());
  update contributions set status = 'awaiting_confirmation', reported_paid_at = now(), has_conflict = has_conflict or v_expired
    where id = c.id;
  if v_expired then
    update reservations set released_at = coalesce(released_at, now()), release_reason = coalesce(release_reason, 'expired')
      where contribution_id = c.id;
    insert into conflicts (contribution_id, kind, details) values (c.id, 'late_payment',
      jsonb_build_object('note', 'Даритель сообщил о переводе после окончания брони'));
    insert into notification_outbox (event, payload) values ('conflict', jsonb_build_object('id', c.id, 'kind', 'late_payment'));
  else
    update reservations set expires_at = null where contribution_id = c.id and released_at is null;   -- бронь больше не истекает
  end if;
  insert into audit_log (actor, action, entity, entity_id) values ('donor', 'contribution.report_paid', 'contribution', c.id::text);
  insert into notification_outbox (event, payload) values ('reported', jsonb_build_object('id', c.id));
  return jsonb_build_object('status', 'awaiting_confirmation');
end $$;
grant execute on function report_paid(uuid, text) to anon, authenticated;

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
  return jsonb_build_object('status', 'cancelled');
end $$;
grant execute on function cancel_my_contribution(uuid, text) to anon, authenticated;

-- Регистрация чека после загрузки по подписанной ссылке
create or replace function register_receipt(p_id uuid, p_token text, p_path text) returns jsonb
language plpgsql security definer set search_path = public, extensions, storage as $$
declare c contributions; o record;
begin
  c := donor_contribution(p_id, p_token);
  if p_path !~ ('^' || c.id::text || '/[A-Za-z0-9._-]+$') then raise exception 'bad_path'; end if;
  select metadata into o from storage.objects where bucket_id = 'receipts' and name = p_path;
  if not found then raise exception 'not_uploaded' using hint = 'Файл не загрузился, попробуйте ещё раз.'; end if;
  insert into receipts (contribution_id, storage_path, mime_type, size_bytes)
  values (c.id, p_path, coalesce(o.metadata->>'mimetype', 'application/octet-stream'), coalesce((o.metadata->>'size')::int, 1))
  on conflict (storage_path) do nothing;
  insert into notification_outbox (event, payload) values ('receipt', jsonb_build_object('id', c.id));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function register_receipt(uuid, text, text) to anon, authenticated;

-- ---------- Истечение броней (pg_cron каждые 5 минут) ----------
create or replace function expire_reservations() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; rec record;
begin
  for rec in
    select c.id from contributions c join reservations r on r.contribution_id = c.id
    where c.status = 'pending_transfer' and r.released_at is null and r.expires_at <= now()
    for update of c skip locked
  loop
    update contributions set status = 'expired', expired_at = now() where id = rec.id;
    update reservations set released_at = now(), release_reason = 'expired' where contribution_id = rec.id;
    insert into notification_outbox (event, payload) values ('expired', jsonb_build_object('id', rec.id));
    n := n + 1;
  end loop;
  delete from rate_limits where window_start < now() - interval '2 days';
  return n;
end $$;
revoke execute on function expire_reservations() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'expire-reservations';
select cron.schedule('expire-reservations', '*/5 * * * *', 'select public.expire_reservations()');

-- ---------- Администратор ----------
create or replace function require_admin() returns void language plpgsql stable as $$
begin if not is_admin() then raise exception 'forbidden' using hint = 'Нет прав администратора.'; end if; end $$;

create or replace function admin_confirm(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contributions; g gifts; v_goal bigint; v_before bigint; v_after bigint;
begin
  perform require_admin();
  select * into c from contributions where id = p_id;
  if not found then raise exception 'not_found'; end if;
  select * into g from gifts where id = c.gift_id for update;
  select * into c from contributions where id = p_id for update;           -- перечитываем под блокировкой
  if c.status = 'confirmed' then return jsonb_build_object('status', 'confirmed', 'already', true); end if;   -- защита от повторного подтверждения
  v_goal := gift_goal_minor(g); v_before := gift_confirmed(g.id);
  update contributions set status = 'confirmed', confirmed_at = now(), confirmed_by = actor() where id = c.id;
  update reservations set released_at = coalesce(released_at, now()), release_reason = coalesce(release_reason, 'confirmed')
    where contribution_id = c.id;
  v_after := v_before + c.gift_amount_minor;
  if v_goal is not null and v_after > v_goal then
    update contributions set has_conflict = true where id = c.id;
    insert into conflicts (contribution_id, kind, details) values (c.id, 'overpayment',
      jsonb_build_object('goal', v_goal, 'confirmed', v_after, 'over', v_after - v_goal));
    insert into notification_outbox (event, payload) values ('conflict', jsonb_build_object('id', c.id, 'kind', 'overpayment'));
  end if;
  if v_goal is not null and v_before < v_goal and v_after >= v_goal then
    insert into notification_outbox (event, payload) values ('funded', jsonb_build_object('gift', g.id));
  end if;
  insert into audit_log (actor, action, entity, entity_id, before) values (actor(), 'contribution.confirm', 'contribution', c.id::text,
    jsonb_build_object('status', c.status));
  return jsonb_build_object('status', 'confirmed');
end $$;
grant execute on function admin_confirm(uuid) to authenticated;

create or replace function admin_set_status(p_id uuid, p_status contribution_status, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contributions;
begin
  perform require_admin();
  if p_status not in ('rejected', 'cancelled') then raise exception 'bad_status'; end if;
  select * into c from contributions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update contributions set status = p_status,
    rejected_at = case when p_status = 'rejected' then now() else rejected_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    admin_comment = coalesce(p_comment, admin_comment)
  where id = c.id;
  update reservations set released_at = coalesce(released_at, now()), release_reason = 'admin' where contribution_id = c.id;
  insert into audit_log (actor, action, entity, entity_id, before, after) values (actor(), 'contribution.' || p_status, 'contribution', c.id::text,
    jsonb_build_object('status', c.status), jsonb_build_object('status', p_status, 'comment', p_comment));
  return jsonb_build_object('status', p_status);
end $$;
grant execute on function admin_set_status(uuid, contribution_status, text) to authenticated;

-- Исправление данных заявки с журналом
create or replace function admin_update_contribution(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contributions; n contributions;
begin
  perform require_admin();
  select * into c from contributions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update contributions set
    donor_name = coalesce(nullif(btrim(p->>'donorName'), ''), donor_name),
    donor_telegram = coalesce(nullif(btrim(p->>'donorTelegram'), ''), donor_telegram),
    show_name_publicly = coalesce((p->>'showNamePublicly')::boolean, show_name_publicly),
    pay_amount_minor = coalesce((p->>'payAmountMinor')::bigint, pay_amount_minor),
    gift_amount_minor = coalesce((p->>'giftAmountMinor')::bigint, gift_amount_minor),
    admin_comment = coalesce(p->>'adminComment', admin_comment)
  where id = c.id returning * into n;
  update reservations set amount_minor = n.gift_amount_minor where contribution_id = c.id and released_at is null;
  insert into audit_log (actor, action, entity, entity_id, before, after) values (actor(), 'contribution.edit', 'contribution', c.id::text,
    to_jsonb(c) - 'cancel_token_hash', to_jsonb(n) - 'cancel_token_hash');
  return jsonb_build_object('ok', true);
end $$;
grant execute on function admin_update_contribution(uuid, jsonb) to authenticated;

-- Ручное добавление реально полученного перевода
create or replace function admin_add_manual(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare g gifts; r exchange_rates; v_pay currency_code := (p->>'payCurrency')::currency_code; v_amount bigint := (p->>'payAmountMinor')::bigint;
  v_credit bigint; c contributions;
begin
  perform require_admin();
  select * into g from gifts where id = (p->>'giftId')::uuid for update;
  if not found then raise exception 'not_found'; end if;
  r := current_rate();
  v_credit := coalesce((p->>'giftAmountMinor')::bigint, credit_amount(v_amount, v_pay, g.currency, r.idr_per_rub));
  insert into contributions (gift_id, status, source, donor_name, donor_telegram, show_name_publicly, pay_currency, pay_amount_minor,
    gift_currency, gift_amount_minor, rate_id, idr_per_rub, cancel_token_hash, idempotency_key, confirmed_at, confirmed_by, admin_comment)
  values (g.id, 'confirmed', 'manual', coalesce(nullif(btrim(p->>'donorName'), ''), 'Без имени'),
    coalesce(nullif(btrim(p->>'donorTelegram'), ''), '@unknown'), coalesce((p->>'showNamePublicly')::boolean, false),
    v_pay, v_amount, g.currency, v_credit, r.id, r.idr_per_rub, token_hash(encode(gen_random_bytes(24), 'hex')), gen_random_uuid(),
    now(), actor(), p->>'adminComment')
  returning * into c;
  insert into audit_log (actor, action, entity, entity_id, after) values (actor(), 'contribution.manual', 'contribution', c.id::text,
    to_jsonb(c) - 'cancel_token_hash');
  return jsonb_build_object('id', c.id);
end $$;
grant execute on function admin_add_manual(jsonb) to authenticated;

create or replace function admin_resolve_conflict(p_id uuid, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update conflicts set resolved_at = now(), resolved_by = actor(), resolution = p_resolution where id = p_id;
  update contributions set has_conflict = exists(select 1 from conflicts where contribution_id = contributions.id and resolved_at is null)
    where id = (select contribution_id from conflicts where id = p_id);
  insert into audit_log (actor, action, entity, entity_id, after) values (actor(), 'conflict.resolve', 'conflict', p_id::text,
    jsonb_build_object('resolution', p_resolution));
end $$;
grant execute on function admin_resolve_conflict(uuid, text) to authenticated;

create or replace function admin_set_rate(p_rate numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_rate is null or p_rate <= 0 or p_rate > 100000 then raise exception 'bad_rate'; end if;
  insert into exchange_rates (idr_per_rub, set_by) values (p_rate, actor());
  insert into audit_log (actor, action, entity, after) values (actor(), 'rate.set', 'exchange_rate', jsonb_build_object('idr_per_rub', p_rate));
end $$;
grant execute on function admin_set_rate(numeric) to authenticated;

create or replace function admin_report() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_admin() then null else jsonb_build_object(
    'confirmedRub', (select coalesce(sum(pay_amount_minor), 0) from contributions where status = 'confirmed' and pay_currency = 'RUB'),
    'confirmedIdr', (select coalesce(sum(pay_amount_minor), 0) from contributions where status = 'confirmed' and pay_currency = 'IDR'),
    'donors', (select count(distinct lower(donor_telegram)) from contributions where status = 'confirmed'),
    'funded', (select count(*) from gifts g where gift_goal_minor(g) is not null and gift_confirmed(g.id) >= gift_goal_minor(g)),
    'pending', (select count(*) from contributions where status = 'pending_transfer'),
    'awaiting', (select count(*) from contributions where status = 'awaiting_confirmation'),
    'conflicts', (select count(*) from conflicts where resolved_at is null)
  ) end
$$;
grant execute on function admin_report() to authenticated;

-- Админ может добавлять курс только через функцию; прямые вставки запрещены (политик нет).

-- ---------- Журнал изменений настроек и подарков ----------
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, action, entity, entity_id, before, after)
  values (actor(), lower(tg_op), tg_table_name,
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
             (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'currency'),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger if exists gifts_audit on gifts;            create trigger gifts_audit after insert or update or delete on gifts for each row execute function audit_row();
drop trigger if exists payment_audit on payment_settings; create trigger payment_audit after update on payment_settings for each row execute function audit_row();
drop trigger if exists site_audit on site_settings;      create trigger site_audit after update on site_settings for each row execute function audit_row();
drop trigger if exists admin_settings_audit on admin_settings; create trigger admin_settings_audit after update on admin_settings for each row execute function audit_row();

-- ---------- Хранилище файлов ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']),
  ('public-media', 'public-media', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media read" on storage.objects;
drop policy if exists "media admin write" on storage.objects;
drop policy if exists "media admin update" on storage.objects;
drop policy if exists "media admin delete" on storage.objects;
drop policy if exists "receipts admin read" on storage.objects;
create policy "media read" on storage.objects for select using (bucket_id = 'public-media');
create policy "media admin write" on storage.objects for insert to authenticated with check (bucket_id = 'public-media' and public.is_admin());
create policy "media admin update" on storage.objects for update to authenticated using (bucket_id = 'public-media' and public.is_admin());
create policy "media admin delete" on storage.objects for delete to authenticated using (bucket_id = 'public-media' and public.is_admin());
create policy "receipts admin read" on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.is_admin());
-- Загрузка чеков — только по одноразовой подписанной ссылке от Edge Function.

-- Прямой доступ к служебным функциям для анонимов закрыт
revoke execute on function gift_confirmed(uuid), gift_reserved(uuid) from anon;
