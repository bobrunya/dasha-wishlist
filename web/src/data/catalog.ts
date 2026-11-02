import type { Category, Currency, GiftKind, PublicGift } from '../lib/types'
import tattooRef from '../assets/tattoo-reference.webp'
import credits from '../assets/gifts/credits.json'

// Временные фото с Pexels (бесплатная лицензия Pexels). Заменяются в админке.
const PHOTOS = import.meta.glob<string>('../assets/gifts/*.webp', { eager: true, import: 'default' })
const photoFor = (slug: string) => PHOTOS[`../assets/gifts/${slug}.webp`]
const PEXELS = credits as Record<string, string>

// Зеркало supabase/migrations/0002_seed.sql — используется в режиме предпросмотра,
// пока сайт не подключён к базе.

export const CATEGORIES: Category[] = [
  { slug: 'experiences', title: 'Впечатления' },
  { slug: 'beauty', title: 'Красота и забота' },
  { slug: 'things', title: 'Вещи и техника' },
  { slug: 'small-joys', title: 'Маленькие радости' },
  { slug: 'learning', title: 'Обучение и хобби' },
  { slug: 'money', title: 'Денежные подарки' },
]

type Row = [slug: string, cat: string, emoji: string, title: string, description: string, kind: GiftKind,
  currency: Currency, goal: number | null, unit?: [price: number, label: string, target: number | null, min: number], note?: string]

const ROWS: Row[] = [
  ['lips', 'beauty', '💋', 'Увеличение губ', 'Давно хочу — бережно и естественно.', 'fixed', 'IDR', 4_000_000],
  ['fine-line-tattoo', 'beauty', '🖋️', 'Татуировка на спине Fine Line', 'Тонкая симметричная орнаментальная композиция вдоль позвоночника.', 'fixed', 'IDR', 2_500_000],
  ['pov-glasses', 'things', '🕶️', 'Умные очки с камерой для POV-съёмки', 'Очки для съёмки видео от первого лица, совместимые с iPhone.', 'fixed', 'IDR', 1_000_000],
  ['helicopter', 'experiences', '🚁', 'Полёт на вертолёте над Бали', 'Около 10 минут над островом.', 'fixed', 'IDR', 2_300_000],
  ['paragliding', 'experiences', '🪂', 'Параглайдинг на Бали', 'Полёт на параплане над побережьем.', 'fixed', 'IDR', 1_500_000],
  ['perfume-workshop', 'learning', '🌸', 'Мастер-класс по созданию парфюма', 'Собрать свой собственный аромат.', 'fixed', 'IDR', 600_000],
  ['water-spa', 'beauty', '💧', 'Water Spa Therapy with Detox Hair Spa', 'Водная спа-терапия и детокс-уход для волос.', 'fixed', 'IDR', 1_100_000],
  ['robot-vacuum', 'things', '🤖', 'Робот-пылесос', 'Чтобы чистота наводилась сама.', 'fixed', 'IDR', 4_600_000],
  ['photoshoot-yulia', 'experiences', '📸', 'Фотосессия с Юлей', 'Красивые кадры на память.', 'fixed', 'IDR', 2_000_000],
  ['high-heels-lesson', 'learning', '👠', 'Индивидуальный урок High Heels', 'Индивидуальное занятие, 2 часа.', 'fixed', 'IDR', 3_000_000, undefined,
    'Полная стоимость — 3 540 000 IDR, включая аренду студии 540 000 IDR. Цель сбора — 3 000 000 IDR, остальное Даша оплачивает сама.'],
  ['flyboarding', 'experiences', '🌊', 'Флайбординг на Бали', 'Полетать над водой на флайборде.', 'fixed', 'IDR', 500_000],
  ['massage', 'beauty', '🤍', 'Абонемент на массаж', 'Можно подарить один или несколько сеансов.', 'quantity', 'IDR', null, [180_000, 'сеанс', 10, 1]],
  ['flowers', 'small-joys', '💐', 'Букет цветов', 'Просто чтобы было красиво.', 'fixed', 'IDR', 500_000],
  ['skittles', 'small-joys', '🍬', 'Запас Skittles', 'Сладкий запас на каждый день. Минимум 5 пачек.', 'quantity', 'IDR', null, [20_000, 'пачка', null, 5]],
  ['instax-mini', 'small-joys', '🎞️', 'Картриджи Instax Mini', 'Чтобы печатать моменты сразу.', 'quantity', 'IDR', null, [200_000, 'упаковка', 5, 1]],
  ['jet-ski', 'experiences', '🚤', 'Катание на гидроцикле', 'Самостоятельное управление.', 'fixed', 'IDR', 400_000],
  ['sneakers-money', 'money', '👟', 'Деньги на новые кроссовки', 'Выберу пару сама.', 'fixed', 'IDR', 1_000_000],
  ['istana-spa', 'beauty', '🌺', 'Спа The Istana Bali', 'Расслабляющий спа-день.', 'fixed', 'IDR', 450_000],
  ['hair-treatment', 'beauty', '✨', 'Салонный уход: кератин или Tokio Inkarami', 'Один уход на выбор — кератин или Tokio Inkarami.', 'fixed', 'IDR', 2_000_000],
  ['xiaomi-band-10', 'things', '⌚', 'Xiaomi Smart Band 10 Mystic Rose', 'Именно в цвете Mystic Rose.', 'fixed', 'IDR', 700_000],
  ['teeth-cleaning', 'beauty', '🦷', 'Профессиональная чистка зубов', 'Забота об улыбке.', 'fixed', 'IDR', 500_000],
  ['bedding', 'things', '🛏️', 'Постельное бельё', 'Мягкое и красивое.', 'fixed', 'IDR', 1_000_000],
  ['money', 'money', '💌', 'Деньги', 'Любая сумма — потрачу на что-то приятное.', 'open', 'IDR', null],
  ['high-heels-shoes', 'learning', '👡', 'Туфли для High Heels', 'Специальные туфли для занятий.', 'fixed', 'RUB', 1_000_000],
  ['coffee-machine', 'things', '☕', 'Кофемашина', 'Вкусный кофе каждое утро.', 'fixed', 'IDR', 4_500_000],
  ['xbox-controller', 'things', '🎮', 'Оригинальный геймпад Xbox Wireless Controller', 'Оригинальный геймпад, совместимый с Xbox Series S.', 'fixed', 'IDR', 1_000_000],
  ['gta-vi', 'things', '🕹️', 'GTA VI для Xbox Series S', '', 'fixed', 'IDR', 1_450_000],
  ['piano-lessons', 'learning', '🎹', 'Четыре индивидуальных урока пианино', 'Пакет из четырёх занятий по 60 минут.', 'fixed', 'IDR', 860_000],
]

export function seedGifts(): PublicGift[] {
  return ROWS.map(([slug, cat, emoji, title, description, kind, currency, goal, unit, note], i) => ({
    id: slug,
    slug,
    sortOrder: i + 1,
    category: cat,
    title,
    description,
    publicNote: note ?? null,
    kind,
    currency,
    goalMinor: goal,
    unitPriceMinor: unit?.[0] ?? null,
    unitLabel: unit?.[1] ?? null,
    targetQuantity: unit?.[2] ?? null,
    minOrderQuantity: unit?.[3] ?? 1,
    isOpen: true,
    confirmedMinor: 0,
    reservedMinor: 0,
    donorNames: [],
    images: slug === 'fine-line-tattoo'
      ? [{ url: tattooRef, alt: 'Референс татуировки Fine Line вдоль позвоночника', kind: 'reference' }]
      : photoFor(slug)
        ? [{ url: photoFor(slug), alt: title, kind: 'photo', credit: `Pexels #${PEXELS[slug]}` }]
        : [],
    emoji,
  }))
}
