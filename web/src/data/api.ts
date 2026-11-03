import type { ContributionStatus, ContributionDraft, CreatedContribution, PublicGift, SiteSettings } from '../lib/types'
import { creditFor, payLimit, progressOf } from '../lib/money'
import { seedGifts } from './catalog'
import heroPhoto from '../assets/hero-dasha.webp'
import { DEFAULT_WELCOME } from './content'
import type { Currency, GiftImage, PaymentDetails } from '../lib/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SB_KEY, SB_URL, mediaUrl, sb as client } from './supabase'
import { getTurnstileToken } from './turnstile'

// Реквизиты для предпросмотра лежат в payment.local.ts, который не попадает в репозиторий.
const localModules = import.meta.glob<{ PAYMENT: Record<Currency, PaymentDetails> }>('./payment.local.ts', { eager: true })
const LOCAL_PAYMENT = Object.values(localModules)[0]?.PAYMENT

/**
 * Единый интерфейс данных. Сейчас работает «предпросмотр» на локальных данных;
 * на этапе C сюда подключается Supabase с той же сигнатурой.
 */
export interface WishlistApi {
  mode: 'preview' | 'live'
  loadCatalog(): Promise<{ gifts: PublicGift[]; settings: SiteSettings }>
  createContribution(draft: ContributionDraft): Promise<CreatedContribution>
  reportPaid(contributionId: string, cancelToken: string): Promise<void>
  status(contributionId: string, cancelToken: string): Promise<ContributionStatus | null>
  cancel(contributionId: string, cancelToken: string): Promise<void>
  uploadReceipt(contributionId: string, cancelToken: string, file: File): Promise<void>
}

export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024

export function checkReceipt(file: File): string | null {
  const heic = /\.heic$/i.test(file.name)
  if (!RECEIPT_TYPES.includes(file.type) && !heic) return 'Подойдёт фото (JPG, PNG, WEBP, HEIC) или PDF'
  if (file.size > RECEIPT_MAX_BYTES) return 'Файл больше 10 МБ — сделайте скриншот поменьше'
  return null
}

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

// Демо-прогресс, чтобы в предпросмотре были видны все состояния карточек.
const DEMO: Record<string, Partial<PublicGift>> = {}

function previewApi(): WishlistApi {
  const gifts = seedGifts().map(g => ({ ...g, ...DEMO[g.slug] }))
  const settings: SiteSettings = {
    heroImageUrl: heroPhoto,
    welcomeText: DEFAULT_WELCOME,
    telegramContact: null,
    countdownEndsAt: '2026-11-30T23:59:59+08:00',
    acceptingContributions: true,
    idrPerRub: '200',
    currencies: { RUB: true, IDR: true },
  }
  const used = new Set<string>()
  return {
    mode: 'preview',
    async loadCatalog() {
      await wait(450)
      return { gifts: structuredClone(gifts), settings: { ...settings } }
    },
    async createContribution(d) {
      await wait(500)
      if (used.has(d.idempotencyKey)) throw new ApiError('duplicate', 'Эта заявка уже отправлена.')
      const g = gifts.find(x => x.id === d.giftId)
      if (!g || !g.isOpen) throw new ApiError('closed', 'Этот подарок сейчас недоступен.')
      const p = progressOf(g)
      if (p.available !== null && d.payAmountMinor > payLimit(p.available, g.currency, d.payCurrency, settings.idrPerRub))
        throw new ApiError('too_much', 'Сумма больше, чем осталось собрать. Обновите страницу.')
      const giftAmount = creditFor(d.payAmountMinor, d.payCurrency, g.currency, settings.idrPerRub, p.available)
      if (giftAmount <= 0) throw new ApiError('too_little', 'Слишком маленькая сумма.')
      used.add(d.idempotencyKey)
      g.reservedMinor += giftAmount
      return {
        id: crypto.randomUUID(),
        publicRef: Math.random().toString(16).slice(2, 10).toUpperCase(),
        cancelToken: crypto.randomUUID(),
        status: 'pending_transfer',
        expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
        payCurrency: d.payCurrency,
        payAmountMinor: d.payAmountMinor,
        giftAmountMinor: giftAmount,
        payment: LOCAL_PAYMENT?.[d.payCurrency] ?? {
          currency: d.payCurrency,
          recipientName: null,
          detailsText: 'ДЕМО — настоящие реквизиты появятся после настройки в админке',
          instructions: 'Переведите точную сумму через ваш банк.',
        },
      }
    },
    async reportPaid() { await wait(400) },
    async status() { return null },
    async cancel() { await wait(400) },
    async uploadReceipt(_id, _token, file) {
      const err = checkReceipt(file)
      if (err) throw new ApiError('bad_file', err)
      await wait(700)
    },
  }
}

// ---------- Живой режим: Supabase ----------

type DbGift = Omit<PublicGift, 'images' | 'emoji'> & { images: { path: string; alt: string | null; kind: 'photo' | 'reference' }[] }
type DbCatalog = {
  settings: Omit<SiteSettings, 'heroImageUrl'> & { heroImagePath: string | null }
  gifts: DbGift[]
}

function liveApi(sb: SupabaseClient, url: string, key: string): WishlistApi {
  const bundled = new Map(seedGifts().map(g => [g.slug, g]))

  const rpcError = (e: { message?: string; hint?: string | null }) =>
    new ApiError((e.message ?? 'error').split(/\s/)[0], e.hint || 'Не получилось связаться с сайтом. Проверьте интернет и попробуйте ещё раз.')

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args)
    if (error) throw rpcError(error)
    return data as T
  }

  async function fn<T>(name: string, body: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${url}/functions/v1/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      })
    } catch { throw new ApiError('network', 'Нет связи. Проверьте интернет и попробуйте ещё раз.') }
    const data = await res.json().catch(() => null)
    if (!res.ok || !data || data.error) throw new ApiError(data?.error?.code ?? 'error', data?.error?.message ?? 'Что-то пошло не так. Попробуйте ещё раз.')
    return data as T
  }

  return {
    mode: 'live',
    async loadCatalog() {
      const d = await rpc<DbCatalog>('get_catalog', {})
      const { heroImagePath, ...rest } = d.settings
      const settings: SiteSettings = {
        ...rest,
        welcomeText: rest.welcomeText || DEFAULT_WELCOME,
        heroImageUrl: heroImagePath ? mediaUrl(heroImagePath) : heroPhoto,
        idrPerRub: String(rest.idrPerRub).includes('.') ? String(rest.idrPerRub).replace(/\.?0+$/, '') : String(rest.idrPerRub),
      }
      const gifts: PublicGift[] = d.gifts.map(g => {
        const seed = bundled.get(g.slug)
        const images: GiftImage[] = g.images.length
          ? g.images.map(i => ({ url: mediaUrl(i.path), alt: i.alt ?? g.title, kind: i.kind }))
          : seed?.images ?? []
        return { ...g, description: g.description ?? '', images, emoji: seed?.emoji ?? '🎁' }
      })
      return { gifts, settings }
    },
    async createContribution(draft) {
      let turnstileToken: string | undefined
      try { turnstileToken = await getTurnstileToken() }
      catch { throw new ApiError('captcha', 'Не получилось пройти проверку «я не робот». Обновите страницу и попробуйте ещё раз.') }
      return fn<CreatedContribution>('create-contribution', { draft, turnstileToken })
    },
    async reportPaid(id, token) { await rpc('report_paid', { p_id: id, p_token: token }) },
    async status(id, token) {
      try { return (await rpc<{ status: ContributionStatus }>('get_my_contribution', { p_id: id, p_token: token })).status }
      catch (e) { return e instanceof ApiError && e.code === 'not_found' ? 'cancelled' : null }
    },
    async cancel(id, token) { await rpc('cancel_my_contribution', { p_id: id, p_token: token }) },
    async uploadReceipt(id, token, file) {
      const err = checkReceipt(file)
      if (err) throw new ApiError('bad_file', err)
      const mime = file.type || (/\.heic$/i.test(file.name) ? 'image/heic' : '')
      const s = await fn<{ path: string; token: string }>('receipt-upload', { id, token, mime, size: file.size })
      const { error } = await sb.storage.from('receipts').uploadToSignedUrl(s.path, s.token, file, { contentType: mime })
      if (error) throw new ApiError('upload', 'Файл не загрузился. Попробуйте ещё раз.')
      await rpc('register_receipt', { p_id: id, p_token: token, p_path: s.path })
    },
  }
}

export const api: WishlistApi = client && SB_URL && SB_KEY ? liveApi(client, SB_URL, SB_KEY) : previewApi()
