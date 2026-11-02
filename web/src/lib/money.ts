import type { Currency, PublicGift } from './types'

/**
 * Точная денежная арифметика без float.
 * Суммы — целые минимальные единицы: RUB — копейки, IDR — рупии.
 * Курс — десятичная строка «сколько IDR за 1 RUB», переводится в целое с масштабом 1e6.
 */
export const EXPONENT: Record<Currency, number> = { RUB: 2, IDR: 0 }
const RATE_SCALE = 1_000_000n

export function parseRate(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate.trim())
  if (!m) throw new Error('Некорректный курс')
  const frac = (m[2] ?? '').padEnd(6, '0')
  const scaled = BigInt(m[1]) * RATE_SCALE + BigInt(frac)
  if (scaled <= 0n) throw new Error('Курс должен быть больше нуля')
  return scaled
}

type Rounding = 'floor' | 'ceil' | 'half-up'
function div(a: bigint, b: bigint, mode: Rounding): bigint {
  const q = a / b, r = a % b
  if (r === 0n) return q
  if (mode === 'floor') return q
  if (mode === 'ceil') return q + 1n
  return r * 2n >= b ? q + 1n : q
}

/** Перевод суммы между валютами по курсу. */
export function convert(amountMinor: number, from: Currency, to: Currency, rate: string, mode: Rounding = 'half-up'): number {
  if (from === to) return amountMinor
  const r = parseRate(rate)
  const a = BigInt(amountMinor)
  // 1 RUB = rate IDR → 100 копеек = rate рупий
  if (from === 'RUB') return Number(div(a * r, 100n * RATE_SCALE, mode))
  return Number(div(a * 100n * RATE_SCALE, r, mode))
}

const nf = new Intl.NumberFormat('ru-RU')

export function format(amountMinor: number, currency: Currency): string {
  if (currency === 'IDR') return `${nf.format(amountMinor)} IDR`
  const whole = Math.trunc(amountMinor / 100)
  const kop = Math.abs(amountMinor % 100)
  return kop ? `${nf.format(whole)},${String(kop).padStart(2, '0')} ₽` : `${nf.format(whole)} ₽`
}

/** Показ в рублях (основная валюта) и в рупиях. Рубли округляются до целых для витрины. */
export function dual(amountMinor: number, currency: Currency, rate: string) {
  const rub = convert(amountMinor, currency, 'RUB', rate)
  const idr = convert(amountMinor, currency, 'IDR', rate)
  return { rub: format(Math.round(rub / 100) * 100, 'RUB'), idr: format(idr, 'IDR'), rubMinor: rub, idrMinor: idr }
}

/** Ввод пользователя «1 500» → минимальные единицы (только целые рубли/рупии). */
export function parseUserAmount(text: string, currency: Currency): number | null {
  const clean = text.replace(/[\s ]/g, '')
  if (!/^\d{1,12}$/.test(clean)) return null
  const n = Number(clean)
  if (n <= 0) return null
  return currency === 'RUB' ? n * 100 : n
}

export function goalOf(g: PublicGift): number | null {
  if (g.kind === 'fixed') return g.goalMinor
  if (g.kind === 'quantity' && g.unitPriceMinor && g.targetQuantity) return g.unitPriceMinor * g.targetQuantity
  return null
}

export function progressOf(g: PublicGift) {
  const goal = goalOf(g)
  const confirmed = g.confirmedMinor
  if (goal === null) return { goal, confirmed, remaining: null, available: null, percent: null, funded: false }
  const remaining = Math.max(0, goal - confirmed)
  const available = Math.max(0, goal - confirmed - g.reservedMinor)
  const percent = Math.min(100, Math.floor((confirmed * 100) / goal))
  return { goal, confirmed, remaining, available, percent, funded: remaining === 0 }
}

const UNIT: Record<Currency, number> = { RUB: 100, IDR: 1 }

/** Сколько максимум можно перевести в валюте оплаты, чтобы закрыть `availableGift` (вверх до целых рублей/рупий). */
export function payLimit(availableGift: number, giftCur: Currency, payCur: Currency, rate: string): number {
  const raw = convert(availableGift, giftCur, payCur, rate, 'ceil')
  const u = UNIT[payCur]
  return Math.ceil(raw / u) * u
}

/** Сколько засчитается в цель: вниз, но не больше остатка (если перевод в пределах лимита). */
export function creditFor(payMinor: number, payCur: Currency, giftCur: Currency, rate: string, availableGift: number | null): number {
  const c = convert(payMinor, payCur, giftCur, rate, 'floor')
  return availableGift === null ? c : Math.min(c, availableGift)
}

/** Цена для фильтра «по бюджету»: полная стоимость (или цена за штуку) в рублях. */
export function budgetPriceRub(g: PublicGift, rate: string): number | null {
  const base = g.kind === 'quantity' ? g.unitPriceMinor : g.kind === 'fixed' ? g.goalMinor : null
  return base === null ? null : convert(base, g.currency, 'RUB', rate) / 100
}
