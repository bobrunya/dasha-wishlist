-- =====================================================================
-- Начальные данные: категории, 28 подарков, курс 1 RUB = 200 IDR,
-- настройки. Реквизиты НЕ заполнены — валюты выключены до ввода в админке.
-- Суммы: IDR — целые рупии, RUB — копейки.
-- =====================================================================

insert into gift_categories (slug, title, sort_order) values
  ('experiences', 'Впечатления',        1),
  ('beauty',      'Красота и забота',   2),
  ('things',      'Вещи и техника',     3),
  ('small-joys',  'Маленькие радости',  4),
  ('learning',    'Обучение и хобби',   5),
  ('money',       'Денежные подарки',   6);

insert into exchange_rates (idr_per_rub, set_by) values (200, 'system:seed');

insert into site_settings (id, welcome_text) values (true,
'25 ноября у меня день рождения! 💗

В этом году я решила попробовать кое-что новенькое и собрать свой первый интерактивный Wishlist.

Здесь всё, что мне действительно хочется: полезные вещи, маленькие радости, давние хотелки и впечатления, которые подарят классные эмоции.

Если вдруг вам захочется меня порадовать, выбирайте подарок по душе и по кошельку. Здесь есть варианты на самые разные бюджеты, а на большие мечты можно скинуться вместе.

Никаких обязательств, конечно! Просто теперь у вас есть место, где можно подсмотреть, что меня точно обрадует.

P. S. Сайт я делала сама с помощью AI, поэтому если что-то сломается, заглючит или не захочет работать — пишите мне в Telegram. Буду чинить 😂');

insert into admin_settings (id) values (true);

insert into payment_settings (currency, is_enabled) values ('RUB', false), ('IDR', false);

-- Подарки
with c as (select id, slug from gift_categories)
insert into gifts (sort_order, slug, category_id, title, description, public_note, admin_note,
                   kind, currency, goal_minor, unit_price_minor, unit_label, target_quantity, min_order_quantity)
select v.sort_order, v.slug, c.id, v.title, v.description, v.public_note::text, v.admin_note::text,
       v.kind::gift_kind, v.currency::currency_code, v.goal::bigint, v.unit_price::bigint, v.unit_label::text, v.target_qty::int, v.min_qty::int
from (values
  ( 1,'lips','beauty','Увеличение губ','Давно хочу — бережно и естественно.',null,null,'fixed','IDR',4000000,null,null,null,1),
  ( 2,'fine-line-tattoo','beauty','Татуировка на спине Fine Line','Тонкая симметричная орнаментальная композиция вдоль позвоночника.',null,'Загрузить референс в админке (тип: reference).','fixed','IDR',2500000,null,null,null,1),
  ( 3,'pov-glasses','things','Умные очки с камерой для POV-съёмки','Очки для съёмки видео от первого лица, совместимые с iPhone.',null,'Рассматриваю ELANGEONE AI Smart Glasses V03-T5, HT3 или аналоги до 1 млн IDR. Не Ray-Ban Meta.','fixed','IDR',1000000,null,null,null,1),
  ( 4,'helicopter','experiences','Полёт на вертолёте над Бали','Около 10 минут над островом.',null,null,'fixed','IDR',2300000,null,null,null,1),
  ( 5,'paragliding','experiences','Параглайдинг на Бали','Полёт на параплане над побережьем.',null,null,'fixed','IDR',1500000,null,null,null,1),
  ( 6,'perfume-workshop','learning','Мастер-класс по созданию парфюма','Собрать свой собственный аромат.',null,null,'fixed','IDR',600000,null,null,null,1),
  ( 7,'water-spa','beauty','Water Spa Therapy with Detox Hair Spa','Водная спа-терапия и детокс-уход для волос.',null,null,'fixed','IDR',1100000,null,null,null,1),
  ( 8,'robot-vacuum','things','Робот-пылесос','Чтобы чистота наводилась сама.',null,null,'fixed','IDR',4600000,null,null,null,1),
  ( 9,'photoshoot-yulia','experiences','Фотосессия с Юлей','Красивые кадры на память.',null,null,'fixed','IDR',2000000,null,null,null,1),
  (10,'high-heels-lesson','learning','Индивидуальный урок High Heels','Индивидуальное занятие, 2 часа.','Полная стоимость — 3 540 000 IDR, включая аренду студии 540 000 IDR. Цель сбора — 3 000 000 IDR, остальное Даша оплачивает сама.',null,'fixed','IDR',3000000,null,null,null,1),
  (11,'flyboarding','experiences','Флайбординг на Бали','Полетать над водой на флайборде.',null,'Уточнить местный тариф для обладателей KITAS.','fixed','IDR',500000,null,null,null,1),
  (12,'massage','beauty','Абонемент на массаж','Можно подарить один или несколько сеансов.',null,null,'quantity','IDR',null,180000,'сеанс',10,1),
  (13,'flowers','small-joys','Букет цветов','Просто чтобы было красиво.',null,null,'fixed','IDR',500000,null,null,null,1),
  (14,'skittles','small-joys','Запас Skittles','Сладкий запас на каждый день. Минимум 5 пачек.',null,null,'quantity','IDR',null,20000,'пачка',null,5),
  (15,'instax-mini','small-joys','Картриджи Instax Mini','Чтобы печатать моменты сразу.',null,null,'quantity','IDR',null,200000,'упаковка',5,1),
  (16,'jet-ski','experiences','Катание на гидроцикле','Самостоятельное управление.',null,null,'fixed','IDR',400000,null,null,null,1),
  (17,'sneakers-money','money','Деньги на новые кроссовки','Выберу пару сама.',null,null,'fixed','IDR',1000000,null,null,null,1),
  (18,'istana-spa','beauty','Спа The Istana Bali','Расслабляющий спа-день.',null,null,'fixed','IDR',450000,null,null,null,1),
  (19,'hair-treatment','beauty','Салонный уход: кератин или Tokio Inkarami','Один уход на выбор — кератин или Tokio Inkarami.',null,null,'fixed','IDR',2000000,null,null,null,1),
  (20,'xiaomi-band-10','things','Xiaomi Smart Band 10 Mystic Rose','Именно в цвете Mystic Rose.',null,null,'fixed','IDR',700000,null,null,null,1),
  (21,'teeth-cleaning','beauty','Профессиональная чистка зубов','Забота об улыбке.',null,null,'fixed','IDR',500000,null,null,null,1),
  (22,'bedding','things','Постельное бельё','Мягкое и красивое.',null,null,'fixed','IDR',1000000,null,null,null,1),
  (23,'money','money','Деньги','Любая сумма — потрачу на что-то приятное.',null,null,'open','IDR',null,null,null,null,1),
  (24,'high-heels-shoes','learning','Туфли для High Heels','Специальные туфли для занятий.',null,null,'fixed','RUB',1000000,null,null,null,1),
  (25,'coffee-machine','things','Кофемашина','Вкусный кофе каждое утро.',null,null,'fixed','IDR',4500000,null,null,null,1),
  (26,'xbox-controller','things','Оригинальный геймпад Xbox Wireless Controller','Оригинальный геймпад, совместимый с Xbox Series S.',null,null,'fixed','IDR',1000000,null,null,null,1),
  (27,'gta-vi','things','GTA VI для Xbox Series S','',null,'Статус доступности для покупки указать в public_note, когда будет известен.','fixed','IDR',1450000,null,null,null,1),
  (28,'piano-lessons','learning','Четыре индивидуальных урока пианино','Пакет из четырёх занятий по 60 минут.',null,null,'fixed','IDR',860000,null,null,null,1)
) as v(sort_order, slug, cat, title, description, public_note, admin_note, kind, currency, goal, unit_price, unit_label, target_qty, min_qty)
join c on c.slug = v.cat;
