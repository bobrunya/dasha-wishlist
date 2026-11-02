-- =====================================================================
-- Dasha's Birthday Wishlist 2026 — схема базы данных (этап A)
-- Все денежные суммы — bigint в минимальных единицах валюты:
--   RUB: копейки (1 RUB = 100), IDR: целые рупии (1 IDR = 1).
-- Курс хранится точным numeric: сколько IDR за 1 RUB.
-- Публичные пользователи НЕ пишут в таблицы напрямую: все изменения
-- идут через Edge Functions → SECURITY DEFINER функции (этап C).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Типы ----------
create type currency_code as enum ('RUB', 'IDR');

-- fixed    — обычный подарок с целевой суммой
-- quantity — подарок по штукам (массаж, Skittles, Instax)
-- open     — «Деньги»: любая сумма, без цели
create type gift_kind as enum ('fixed', 'quantity', 'open');

create type contribution_status as enum (
  'pending_transfer',       -- Создана, ожидает перевода (резерв 48 ч)
  'awaiting_confirmation',  -- Даритель нажал «Я перевёл(а)», не истекает
  'confirmed',              -- Подтверждена администратором
  'rejected',               -- Отклонена
  'cancelled',              -- Отменена дарителем или админом
  'expired'                 -- Истекла через 48 ч без отметки об оплате
);

create type contribution_source as enum ('public', 'manual');
create type conflict_kind as enum ('late_payment', 'overpayment', 'other');
create type image_kind as enum ('photo', 'reference');

-- Количество знаков у минимальной единицы валюты
create function currency_exponent(c currency_code)
returns int language sql immutable as $$
  select case c when 'RUB' then 2 when 'IDR' then 0 end
$$;

-- ---------- Администраторы ----------
create table admins (
  email      text primary key check (email = lower(email) and email like '%@%'),
  created_at timestamptz not null default now()
);

-- Проверка прав на стороне БД: email из auth.users (подтверждён Google),
-- а не из клиентских данных.
create function is_admin()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  )
$$;

-- ---------- Категории ----------
create table gift_categories (
  id         smallint generated always as identity primary key,
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title      text not null check (length(title) between 1 and 60),
  sort_order int  not null default 0
);

-- ---------- Подарки ----------
create table gifts (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9-]+$'),
  sort_order         int  not null default 0,
  category_id        smallint references gift_categories(id) on delete set null,
  title              text not null check (length(title) between 1 and 120),
  description        text not null default '' check (length(description) <= 2000),
  public_note        text check (length(public_note) <= 1000),   -- видна всем
  admin_note         text check (length(admin_note) <= 2000),    -- только админ
  kind               gift_kind     not null,
  currency           currency_code not null,                     -- исходная валюта цены
  goal_minor         bigint check (goal_minor > 0),              -- для fixed
  unit_price_minor   bigint check (unit_price_minor > 0),        -- для quantity
  unit_label         text,                                       -- «сеанс», «пачка»
  target_quantity    int check (target_quantity > 0),            -- желаемое кол-во (админ)
  min_order_quantity int not null default 1 check (min_order_quantity >= 1),
  is_visible         boolean not null default true,              -- скрыть с сайта
  is_open            boolean not null default true,              -- принимать взносы
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint gift_kind_amounts check (
    (kind = 'fixed'    and goal_minor is not null and unit_price_minor is null) or
    (kind = 'quantity' and unit_price_minor is not null and goal_minor is null) or
    (kind = 'open'     and goal_minor is null and unit_price_minor is null)
  )
);
create index gifts_sort_idx on gifts (sort_order);

-- Цель в исходной валюте; null = без цели («Деньги» или кол-во не задано)
create function gift_goal_minor(g gifts)
returns bigint language sql immutable as $$
  select case g.kind
    when 'fixed'    then g.goal_minor
    when 'quantity' then g.unit_price_minor * g.target_quantity
    else null end
$$;

create table gift_images (
  id           uuid primary key default gen_random_uuid(),
  gift_id      uuid not null references gifts(id) on delete cascade,
  kind         image_kind not null default 'photo',
  storage_path text not null,       -- путь в бакете public-media
  alt          text not null default '',
  credit       text,                -- автор/источник/лицензия открытого фото
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);
create index gift_images_gift_idx on gift_images (gift_id, sort_order);

-- ---------- Курс ----------
create table exchange_rates (
  id          bigint generated always as identity primary key,
  idr_per_rub numeric(18,6) not null check (idr_per_rub > 0),
  set_by      text not null,
  created_at  timestamptz not null default now()
);
create index exchange_rates_latest_idx on exchange_rates (created_at desc, id desc);

-- ---------- Реквизиты (только админ; дарителю — через функцию на шаге оплаты) ----------
create table payment_settings (
  currency       currency_code primary key,
  is_enabled     boolean not null default false,
  recipient_name text check (length(recipient_name) <= 200),
  details_text   text check (length(details_text) <= 2000),  -- номер карты/счёта и т.п.
  instructions   text check (length(instructions) <= 2000),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  -- нельзя включить валюту без реквизитов
  constraint enabled_requires_details check (
    not is_enabled or (coalesce(length(trim(details_text)), 0) > 0)
  )
);

-- ---------- Настройки сайта ----------
-- Публичные (читаются всеми)
create table site_settings (
  id                     boolean primary key default true check (id),
  hero_image_path        text,
  welcome_text           text not null default '',
  telegram_contact       text check (telegram_contact is null or telegram_contact ~ '^@?[A-Za-z0-9_]{5,32}$'),
  countdown_ends_at      timestamptz not null default '2026-11-30 23:59:59+08', -- Asia/Makassar
  accepting_contributions boolean not null default true,
  updated_at             timestamptz not null default now()
);

-- Приватные (только админ). Bot Token тут НЕ хранится — он в секретах Edge Functions.
create table admin_settings (
  id                    boolean primary key default true check (id),
  telegram_chat_id      text check (telegram_chat_id is null or telegram_chat_id ~ '^-?[0-9]{1,20}$'),
  notify_new            boolean not null default true,
  notify_reported_paid  boolean not null default true,
  notify_receipt        boolean not null default true,
  notify_expired        boolean not null default true,
  notify_fully_funded   boolean not null default true,
  notify_conflict       boolean not null default true,
  reservation_hours     int not null default 48 check (reservation_hours between 1 and 720),
  updated_at            timestamptz not null default now()
);

-- ---------- Заявки (взносы) ----------
create table contributions (
  id                  uuid primary key default gen_random_uuid(),
  public_ref          text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  gift_id             uuid not null references gifts(id) on delete restrict,
  status              contribution_status not null default 'pending_transfer',
  source              contribution_source not null default 'public',
  donor_name          text not null check (length(trim(donor_name)) between 1 and 80),
  donor_telegram      text not null check (donor_telegram ~ '^@?[A-Za-z0-9_]{5,32}$'),
  show_name_publicly  boolean not null default false,
  -- сколько даритель переводит, в выбранной валюте
  pay_currency        currency_code not null,
  pay_amount_minor    bigint not null check (pay_amount_minor > 0),
  -- сколько это засчитывается в цель, в валюте подарка (зафиксировано при создании)
  gift_currency       currency_code not null,
  gift_amount_minor   bigint not null check (gift_amount_minor > 0),
  quantity            int check (quantity > 0),                -- для подарков по штукам
  rate_id             bigint not null references exchange_rates(id),
  idr_per_rub         numeric(18,6) not null,                  -- копия курса на момент заявки
  cancel_token_hash   bytea not null unique,                   -- храним только SHA-256
  idempotency_key     uuid not null unique,                    -- защита от двойного клика
  has_conflict        boolean not null default false,
  admin_comment       text check (length(admin_comment) <= 2000),
  created_at          timestamptz not null default now(),
  reported_paid_at    timestamptz,
  confirmed_at        timestamptz,
  confirmed_by        text,
  rejected_at         timestamptz,
  cancelled_at        timestamptz,
  expired_at          timestamptz,
  updated_at          timestamptz not null default now(),
  constraint confirmed_has_meta check (status <> 'confirmed' or confirmed_at is not null)
);
create index contributions_gift_status_idx on contributions (gift_id, status);
create index contributions_status_created_idx on contributions (status, created_at desc);

-- ---------- Резервы ----------
-- Один резерв на заявку. Активный резерв = released_at is null.
-- expires_at = null означает «не истекает» (даритель сообщил об оплате).
create table reservations (
  id              uuid primary key default gen_random_uuid(),
  contribution_id uuid not null unique references contributions(id) on delete cascade,
  gift_id         uuid not null references gifts(id) on delete cascade,
  amount_minor    bigint not null check (amount_minor > 0),  -- в валюте подарка
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  released_at     timestamptz,
  release_reason  text check (release_reason in ('confirmed','rejected','cancelled','expired','admin'))
);
create index reservations_active_idx on reservations (gift_id) where released_at is null;
create index reservations_expiry_idx on reservations (expires_at) where released_at is null and expires_at is not null;

-- ---------- Чеки (файлы в приватном бакете receipts) ----------
create table receipts (
  id              uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references contributions(id) on delete cascade,
  storage_path    text not null unique,
  mime_type       text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/heic','application/pdf')),
  size_bytes      int  not null check (size_bytes between 1 and 10485760),  -- до 10 МБ
  uploaded_at     timestamptz not null default now()
);

-- ---------- Конфликты для ручного решения ----------
create table conflicts (
  id              uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references contributions(id) on delete cascade,
  kind            conflict_kind not null,
  details         jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution      text
);

-- ---------- Журнал действий ----------
create table audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      text not null,           -- email админа | 'donor' | 'system'
  action     text not null,           -- 'contribution.confirm', 'gift.update', 'rate.set' …
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb
);
create index audit_log_entity_idx on audit_log (entity, entity_id, at desc);

-- ---------- Очередь Telegram-уведомлений ----------
create table notification_outbox (
  id         bigint generated always as identity primary key,
  event      text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   int not null default 0,
  last_error text
);
create index notification_outbox_pending_idx on notification_outbox (created_at) where sent_at is null;

-- ---------- Ограничение частоты публичных запросов ----------
create table rate_limits (
  key_hash     text not null,          -- SHA-256(IP + соль), сам IP не хранится
  bucket       text not null,          -- 'create', 'report', 'upload', 'cancel'
  window_start timestamptz not null,
  hits         int not null default 1,
  primary key (key_hash, bucket, window_start)
);

-- ---------- updated_at ----------
create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger gifts_touch before update on gifts for each row execute function touch_updated_at();
create trigger contributions_touch before update on contributions for each row execute function touch_updated_at();
create trigger payment_settings_touch before update on payment_settings for each row execute function touch_updated_at();
create trigger site_settings_touch before update on site_settings for each row execute function touch_updated_at();
create trigger admin_settings_touch before update on admin_settings for each row execute function touch_updated_at();

-- =====================================================================
-- Row Level Security
-- Публично читается только каталог и публичные настройки.
-- Всё остальное — только админ. Публичные записи — только через
-- Edge Functions (service role) и функции этапа C.
-- =====================================================================
alter table admins              enable row level security;
alter table gift_categories     enable row level security;
alter table gifts               enable row level security;
alter table gift_images         enable row level security;
alter table exchange_rates      enable row level security;
alter table payment_settings    enable row level security;
alter table site_settings       enable row level security;
alter table admin_settings      enable row level security;
alter table contributions       enable row level security;
alter table reservations        enable row level security;
alter table receipts            enable row level security;
alter table conflicts           enable row level security;
alter table audit_log           enable row level security;
alter table notification_outbox enable row level security;
alter table rate_limits         enable row level security;

-- Публичное чтение каталога
create policy categories_public_read on gift_categories for select using (true);
create policy gifts_public_read      on gifts for select using (is_visible or is_admin());
create policy images_public_read     on gift_images for select
  using (exists (select 1 from gifts g where g.id = gift_id and (g.is_visible or is_admin())));
create policy site_public_read       on site_settings for select using (true);
create policy rates_public_read      on exchange_rates for select using (true);

-- Админ: полный доступ
create policy admin_all_admins        on admins              for all using (is_admin()) with check (is_admin());
create policy admin_all_categories    on gift_categories     for all using (is_admin()) with check (is_admin());
create policy admin_all_gifts         on gifts               for all using (is_admin()) with check (is_admin());
create policy admin_all_images        on gift_images         for all using (is_admin()) with check (is_admin());
create policy admin_all_payment       on payment_settings    for all using (is_admin()) with check (is_admin());
create policy admin_all_site          on site_settings       for all using (is_admin()) with check (is_admin());
create policy admin_all_admin_settings on admin_settings     for all using (is_admin()) with check (is_admin());
create policy admin_read_contrib      on contributions       for select using (is_admin());
create policy admin_read_reservations on reservations        for select using (is_admin());
create policy admin_read_receipts     on receipts            for select using (is_admin());
create policy admin_all_conflicts     on conflicts           for all using (is_admin()) with check (is_admin());
create policy admin_read_audit        on audit_log           for select using (is_admin());
create policy admin_read_outbox       on notification_outbox for select using (is_admin());
-- Изменения заявок, резервов, курса — только через функции с журналом (этап C),
-- поэтому прямых UPDATE/INSERT-политик для них нет даже у админа.
-- rate_limits: политик нет — доступ только у service role.
