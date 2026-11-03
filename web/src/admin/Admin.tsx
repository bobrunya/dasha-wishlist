import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb, mediaUrl } from '../data/supabase'
import { format, parseUserAmount } from '../lib/money'
import type { Currency, GiftKind } from '../lib/types'
import { seedGifts } from '../data/catalog'

// ---------- Типы строк базы ----------
type Status = 'pending_transfer' | 'awaiting_confirmation' | 'confirmed' | 'rejected' | 'cancelled' | 'expired'
interface Contribution {
  id: string; public_ref: string; gift_id: string; status: Status; source: 'site' | 'manual'
  donor_name: string; donor_telegram: string; show_name_publicly: boolean
  pay_currency: Currency; pay_amount_minor: number; gift_currency: Currency; gift_amount_minor: number
  quantity: number | null; idr_per_rub: string; has_conflict: boolean; admin_comment: string | null
  created_at: string; reported_paid_at: string | null; confirmed_at: string | null
}
interface Gift {
  id: string; slug: string; sort_order: number; category_id: string | null; title: string; description: string | null
  public_note: string | null; admin_note: string | null; kind: GiftKind; currency: Currency; goal_minor: number | null
  unit_price_minor: number | null; unit_label: string | null; target_quantity: number | null; min_order_quantity: number
  is_visible: boolean; is_open: boolean
}
interface Category { id: string; slug: string; title: string }
interface Reservation { contribution_id: string; expires_at: string | null; released_at: string | null }
interface Receipt { id: string; contribution_id: string; storage_path: string; mime_type: string; uploaded_at: string }
interface Conflict { id: string; contribution_id: string; kind: string; details: Record<string, unknown>; resolved_at: string | null; resolution: string | null }
interface Rate { id: string; idr_per_rub: string; set_by: string | null; created_at: string }
interface Payment { currency: Currency; is_enabled: boolean; recipient_name: string | null; details_text: string | null; instructions: string | null }
interface Site { id: string; hero_image_path: string | null; welcome_text: string | null; telegram_contact: string | null; countdown_ends_at: string; accepting_contributions: boolean }
interface AdminSettings { id: string; telegram_chat_id: string | null; reservation_hours: number; notify_new: boolean; notify_reported_paid: boolean; notify_receipt: boolean; notify_expired: boolean; notify_fully_funded: boolean; notify_conflict: boolean }
interface Audit { id: number; at: string; actor: string; action: string; entity: string; entity_id: string | null }
interface GiftImageRow { id: string; gift_id: string; storage_path: string; sort_order: number }
interface Report { confirmedRub: number; confirmedIdr: number; donors: number; funded: number; pending: number; awaiting: number; conflicts: number }

interface Data {
  report: Report; gifts: Gift[]; categories: Category[]; contributions: Contribution[]; reservations: Reservation[]
  receipts: Receipt[]; conflicts: Conflict[]; rates: Rate[]; payments: Payment[]; site: Site; settings: AdminSettings
  audit: Audit[]; images: GiftImageRow[]
}

const STATUS: Record<Status, [string, string]> = {
  pending_transfer: ['Ждёт перевода', 'bg-baby-soft'],
  awaiting_confirmation: ['Перевёл(а) — проверить', 'bg-blush'],
  confirmed: ['Подтверждено', 'bg-emerald-100'],
  rejected: ['Отклонено', 'bg-cream-deep'],
  cancelled: ['Отменено', 'bg-cream-deep'],  // гостем или вами
  expired: ['Бронь истекла', 'bg-cream-deep'],
}
const CONFLICT: Record<string, string> = { overpayment: 'Переплата', late_payment: 'Перевод после окончания брони' }

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const units = (minor: number | null, cur: Currency) => minor == null ? '' : String(cur === 'RUB' ? minor / 100 : minor)
const rateText = (r: string | number) => { const t = String(r); return t.includes('.') ? t.replace(/\.?0+$/, '') : t }

function errText(e: unknown) {
  const o = e as { hint?: string; message?: string }
  return o?.hint || o?.message || 'Ошибка'
}

// ---------- UI-кирпичики ----------
const input = 'w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-cocoa'
const btn = 'rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-50'
const btnMain = `${btn} bg-cocoa text-cream hover:bg-cocoa-soft`
const btnSoft = `${btn} border border-cream-deep bg-white hover:border-cocoa`

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cocoa-mute">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-cocoa-mute">{hint}</span>}
    </label>
  )
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="size-4 accent-cocoa" />
      {label}
    </label>
  )
}
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl bg-white/90 p-4 shadow-soft sm:p-5 ${className}`}>{children}</div>
}

// ---------- Вход ----------
export default function Admin() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    if (!sb) return
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!sb) return <Center>Админка работает только на опубликованном сайте.</Center>
  if (session === undefined) return <Center>Загрузка…</Center>
  if (!session) return <Login />
  return <Panel session={session} />
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6 text-center">{children}</div>
}

function Login() {
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    const redirectTo = `${location.origin}${import.meta.env.BASE_URL}?admin`
    const { error } = await sb!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } })
    if (error) setErr(error.message.includes('provider is not enabled') ? 'Вход через Google ещё не настроен.' : error.message)
  }
  return (
    <Center>
      <div className="w-full max-w-sm">
        <p className="text-4xl">🎀</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">Админка вишлиста</h1>
        <p className="mt-2 text-sm text-cocoa-mute">Вход только для Даши.</p>
        <button onClick={go} className={`${btnMain} mt-6 w-full py-3`}>Войти через Google</button>
        {err && <p className="mt-3 rounded-2xl bg-blush-soft px-4 py-3 text-sm">{err}</p>}
        <a href={import.meta.env.BASE_URL} className="mt-6 block text-sm text-cocoa-mute underline">← На сайт</a>
      </div>
    </Center>
  )
}

// ---------- Панель ----------
type Tab = 'contrib' | 'gifts' | 'settings' | 'log'

function Panel({ session }: { session: Session }) {
  const [data, setData] = useState<Data | null>(null)
  const [denied, setDenied] = useState(false)
  const [tab, setTab] = useState<Tab>('contrib')
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    const db = sb!
    const { data: report, error } = await db.rpc('admin_report')
    if (error || !report) { setDenied(true); return }
    const q = <T,>(p: PromiseLike<{ data: T[] | null }>) => p.then(r => r.data ?? [])
    const [gifts, categories, contributions, reservations, receipts, conflicts, rates, payments, site, settings, audit, images] = await Promise.all([
      q<Gift>(db.from('gifts').select('*').order('sort_order')),
      q<Category>(db.from('gift_categories').select('id,slug,title').order('sort_order')),
      q<Contribution>(db.from('contributions').select('*').order('created_at', { ascending: false }).limit(2000)),
      q<Reservation>(db.from('reservations').select('contribution_id,expires_at,released_at')),
      q<Receipt>(db.from('receipts').select('*').order('uploaded_at')),
      q<Conflict>(db.from('conflicts').select('*').order('created_at')),
      q<Rate>(db.from('exchange_rates').select('*').order('created_at', { ascending: false }).limit(30)),
      q<Payment>(db.from('payment_settings').select('*').order('currency', { ascending: false })),
      q<Site>(db.from('site_settings').select('*').limit(1)),
      q<AdminSettings>(db.from('admin_settings').select('*').limit(1)),
      q<Audit>(db.from('audit_log').select('id,at,actor,action,entity,entity_id').order('at', { ascending: false }).limit(300)),
      q<GiftImageRow>(db.from('gift_images').select('id,gift_id,storage_path,sort_order').order('sort_order')),
    ])
    setData({ report: report as Report, gifts, categories, contributions, reservations, receipts, conflicts, rates, payments,
      site: site[0], settings: settings[0], audit, images })
  }, [])
  useEffect(() => { load() }, [load])

  const notify = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2500) }
  const run = useCallback(async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await fn()
    if (error) { alert(errText(error)); return false }
    notify(ok); await load(); return true
  }, [load])

  if (denied) return (
    <Center>
      <div>
        <p className="font-display text-2xl">Нет доступа</p>
        <p className="mt-2 text-sm text-cocoa-mute">{session.user.email} — не администратор этого сайта.</p>
        <button onClick={() => sb!.auth.signOut()} className={`${btnSoft} mt-5`}>Выйти</button>
      </div>
    </Center>
  )
  if (!data) return <Center>Загрузка…</Center>

  const tabs: [Tab, string, number?][] = [
    ['contrib', 'Заявки', data.report.awaiting + data.report.conflicts],
    ['gifts', 'Подарки'], ['settings', 'Настройки'], ['log', 'Журнал'],
  ]
  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-24 pt-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Админка 🎀</h1>
          <p className="text-xs text-cocoa-mute">{session.user.email}</p>
        </div>
        <div className="flex gap-2">
          <a href={import.meta.env.BASE_URL} className={btnSoft}>Сайт</a>
          <button onClick={() => sb!.auth.signOut()} className={btnSoft}>Выйти</button>
        </div>
      </header>

      <Summary r={data.report} />

      <nav className="sticky top-0 z-10 -mx-4 mt-5 flex gap-2 overflow-x-auto bg-cream/90 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
        {tabs.map(([k, t, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`${btn} shrink-0 ${tab === k ? 'bg-cocoa text-cream' : 'bg-white text-cocoa shadow-soft'}`}>
            {t}{n ? <span className="ml-1.5 rounded-full bg-blush-deep px-1.5 text-xs text-cocoa">{n}</span> : null}
          </button>
        ))}
      </nav>

      <div className="mt-4">
        {tab === 'contrib' && <Contributions data={data} run={run} />}
        {tab === 'gifts' && <Gifts data={data} run={run} reload={load} notify={notify} />}
        {tab === 'settings' && <Settings data={data} run={run} reload={load} notify={notify} />}
        {tab === 'log' && <Log audit={data.audit} />}
      </div>

      {toast && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-cocoa px-5 py-2.5 text-sm text-cream shadow-lift">{toast}</div>}
    </div>
  )
}

type Run = (fn: () => PromiseLike<{ error: unknown }>, ok: string) => Promise<boolean>

function Summary({ r }: { r: Report }) {
  const items: [string, string][] = [
    ['Получено ₽', format(r.confirmedRub, 'RUB')], ['Получено IDR', format(r.confirmedIdr, 'IDR')],
    ['Дарителей', String(r.donors)], ['Собрано подарков', String(r.funded)],
    ['Проверить переводы', String(r.awaiting)], ['Ждут перевода', String(r.pending)], ['Конфликты', String(r.conflicts)],
  ]
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-2xl bg-white/80 px-3 py-2.5 shadow-soft">
          <p className="text-[11px] uppercase tracking-wide text-cocoa-mute">{k}</p>
          <p className="mt-0.5 font-semibold">{v}</p>
        </div>
      ))}
    </div>
  )
}

// ---------- Заявки ----------
type Filter = 'todo' | 'pending' | 'confirmed' | 'closed' | 'all'

function Contributions({ data, run }: { data: Data; run: Run }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const giftById = useMemo(() => new Map(data.gifts.map(g => [g.id, g])), [data.gifts])

  const match = (c: Contribution, f: Filter) => f === 'all' ? true
    : f === 'todo' ? c.status === 'awaiting_confirmation' || c.has_conflict
    : f === 'pending' ? c.status === 'pending_transfer'
    : f === 'confirmed' ? c.status === 'confirmed'
    : ['rejected', 'cancelled', 'expired'].includes(c.status)
  const count = (f: Filter) => data.contributions.filter(c => match(c, f)).length
  const list = data.contributions.filter(c => {
    const okF = match(c, filter)
    const s = search.trim().toLowerCase()
    const okS = !s || [c.donor_name, c.donor_telegram, c.public_ref, giftById.get(c.gift_id)?.title ?? ''].some(x => x.toLowerCase().includes(s))
    return okF && okS
  })

  const filters: [Filter, string][] = [['all', 'Все'], ['todo', 'Проверить перевод'], ['pending', 'Ждут перевода'], ['confirmed', 'Подтверждённые'], ['closed', 'Отменённые и истёкшие']]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {filters.map(([k, t]) => (
          <button key={k} onClick={() => setFilter(k)} className={`${btn} py-1.5 ${filter === k ? 'bg-blush-deep' : 'bg-white shadow-soft'}`}>{t} <span className="opacity-60">{count(k)}</span></button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: имя, Telegram, номер, подарок" className={`${input} min-w-0 flex-1`} />
        <button onClick={() => setAdding(a => !a)} className={btnSoft}>{adding ? 'Скрыть' : '+ Добавить перевод вручную'}</button>
        <button onClick={() => exportCsv(data)} className={btnSoft}>Скачать CSV</button>
      </div>
      {adding && <ManualAdd gifts={data.gifts} run={run} onDone={() => setAdding(false)} />}
      {list.length === 0 && <p className="py-10 text-center text-sm text-cocoa-mute">{data.contributions.length ? 'В этом разделе пусто — загляните во «Все».' : 'Заявок пока нет.'}</p>}
      {list.map(c => <ContributionCard key={c.id} c={c} gift={giftById.get(c.gift_id)} data={data} run={run} />)}
    </div>
  )
}

function ContributionCard({ c, gift, data, run }: { c: Contribution; gift?: Gift; data: Data; run: Run }) {
  const [editing, setEditing] = useState(false)
  const res = data.reservations.find(r => r.contribution_id === c.id)
  const receipts = data.receipts.filter(r => r.contribution_id === c.id)
  const conflicts = data.conflicts.filter(x => x.contribution_id === c.id)
  const [label, color] = STATUS[c.status]
  const tg = c.donor_telegram.replace(/^@/, '')

  async function openReceipt(path: string) {
    const w = window.open('', '_blank')
    const { data: s, error } = await sb!.storage.from('receipts').createSignedUrl(path, 600)
    if (error || !s) { w?.close(); alert('Не удалось открыть чек'); return }
    if (w) w.location.href = s.signedUrl; else location.href = s.signedUrl
  }
  const act = (fn: string, args: Record<string, unknown>, ok: string, ask?: string) => {
    if (ask && !confirm(ask)) return
    run(() => sb!.rpc(fn, args), ok)
  }
  const sameCur = c.pay_currency === c.gift_currency

  return (
    <Card className={c.has_conflict ? 'ring-2 ring-blush-deep' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{gift?.title ?? 'Подарок удалён'}</p>
          <p className="text-xs text-cocoa-mute">№ {c.public_ref} · {when(c.created_at)}{c.source === 'manual' ? ' · добавлено вручную' : ''}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{label}</span>
      </div>

      <div className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <p><span className="text-cocoa-mute">От:</span> {c.donor_name} · <a className="underline" href={`https://t.me/${tg}`} target="_blank" rel="noreferrer">@{tg}</a>{c.show_name_publicly ? '' : ' · имя скрыто'}</p>
        <p><span className="text-cocoa-mute">Перевод:</span> <b>{format(c.pay_amount_minor, c.pay_currency)}</b>{c.quantity ? ` · ${c.quantity} шт.` : ''}</p>
        {!sameCur && <p><span className="text-cocoa-mute">В цель:</span> {format(c.gift_amount_minor, c.gift_currency)} · курс {rateText(c.idr_per_rub)}</p>}
        {c.status === 'pending_transfer' && res?.expires_at && <p><span className="text-cocoa-mute">Бронь до:</span> {when(res.expires_at)}</p>}
        {c.reported_paid_at && <p><span className="text-cocoa-mute">Сообщил(а) о переводе:</span> {when(c.reported_paid_at)}</p>}
        {c.confirmed_at && <p><span className="text-cocoa-mute">Подтверждено:</span> {when(c.confirmed_at)}</p>}
        {c.admin_comment && <p className="sm:col-span-2"><span className="text-cocoa-mute">Комментарий:</span> {c.admin_comment}</p>}
      </div>

      {receipts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {receipts.map((r, i) => <button key={r.id} onClick={() => openReceipt(r.storage_path)} className={`${btnSoft} py-1.5`}>📎 Чек{receipts.length > 1 ? ` ${i + 1}` : ''}</button>)}
        </div>
      )}

      {conflicts.map(x => <ConflictBox key={x.id} x={x} gift={gift} run={run} />)}

      <div className="mt-4 flex flex-wrap gap-2">
        {c.status !== 'confirmed' && (
          <button onClick={() => act('admin_confirm', { p_id: c.id }, 'Подтверждено 💗',
            `Деньги ${format(c.pay_amount_minor, c.pay_currency)} от ${c.donor_name} действительно пришли?`)} className={btnMain}>Подтвердить получение</button>
        )}
        {['pending_transfer', 'awaiting_confirmation', 'expired'].includes(c.status) && (
          <button onClick={() => {
            const comment = prompt('Почему отклоняете? (видно только вам)', 'Перевод не найден')
            if (comment !== null) act('admin_set_status', { p_id: c.id, p_status: 'rejected', p_comment: comment }, 'Отклонено')
          }} className={btnSoft}>Отклонить</button>
        )}
        {c.status !== 'cancelled' && (
          <button onClick={() => act('admin_set_status', { p_id: c.id, p_status: 'cancelled', p_comment: null }, 'Отменено',
            c.status === 'confirmed' ? 'Отменить уже подтверждённый перевод? Сумма уйдёт из прогресса подарка.' : 'Отменить заявку и снять бронь?')} className={btnSoft}>Отменить</button>
        )}
        <button onClick={() => setEditing(e => !e)} className={btnSoft}>{editing ? 'Закрыть' : 'Изменить'}</button>
        <button onClick={() => {
          if (!confirm(`Удалить заявку № ${c.public_ref} от ${c.donor_name} навсегда?\n\nОна исчезнет из списка и из прогресса подарка. Используйте для тестов и ошибок.`)) return
          run(async () => {
            const { data: r, error } = await sb!.rpc('admin_delete_contribution', { p_id: c.id })
            const files = (r as { receipts?: string[] } | null)?.receipts ?? []
            if (!error && files.length) await sb!.storage.from('receipts').remove(files)
            return { error }
          }, 'Заявка удалена')
        }} className={`${btn} text-cocoa-mute underline underline-offset-4 hover:text-cocoa`}>Удалить навсегда</button>
      </div>
      {editing && <EditContribution c={c} run={run} onDone={() => setEditing(false)} />}
    </Card>
  )
}

function ConflictBox({ x, gift, run }: { x: Conflict; gift?: Gift; run: Run }) {
  const [text, setText] = useState('')
  const over = typeof x.details?.over === 'number' && gift ? ` на ${format(x.details.over as number, gift.currency)}` : ''
  if (x.resolved_at) return <p className="mt-3 rounded-2xl bg-cream-deep/60 px-3 py-2 text-xs">✓ {CONFLICT[x.kind] ?? x.kind} — решено: {x.resolution}</p>
  return (
    <div className="mt-3 rounded-2xl bg-blush-soft px-3 py-3 text-sm">
      <p className="font-semibold">⚠️ {CONFLICT[x.kind] ?? x.kind}{over}</p>
      <p className="mt-1 text-xs text-cocoa-mute">Свяжитесь с дарителем и решите: вернуть разницу, перенести на другой подарок или оставить. Затем отметьте решение.</p>
      <div className="mt-2 flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Как решили" className={`${input} flex-1`} />
        <button disabled={!text.trim()} onClick={() => run(() => sb!.rpc('admin_resolve_conflict', { p_id: x.id, p_resolution: text.trim() }), 'Конфликт закрыт')} className={btnMain}>Решено</button>
      </div>
    </div>
  )
}

function EditContribution({ c, run, onDone }: { c: Contribution; run: Run; onDone: () => void }) {
  const [f, setF] = useState({
    donorName: c.donor_name, donorTelegram: c.donor_telegram, showNamePublicly: c.show_name_publicly,
    pay: units(c.pay_amount_minor, c.pay_currency), credit: units(c.gift_amount_minor, c.gift_currency), adminComment: c.admin_comment ?? '',
  })
  const pay = parseUserAmount(f.pay, c.pay_currency), credit = parseUserAmount(f.credit, c.gift_currency)
  async function save() {
    if (pay === null || credit === null) { alert('Суммы — целыми числами'); return }
    const ok = await run(() => sb!.rpc('admin_update_contribution', { p_id: c.id, p: {
      donorName: f.donorName, donorTelegram: f.donorTelegram, showNamePublicly: f.showNamePublicly,
      payAmountMinor: pay, giftAmountMinor: c.pay_currency === c.gift_currency ? pay : credit, adminComment: f.adminComment,
    } }), 'Сохранено')
    if (ok) onDone()
  }
  return (
    <div className="mt-4 grid gap-3 border-t border-cream-deep pt-4 sm:grid-cols-2">
      <Field label="Имя"><input className={input} value={f.donorName} onChange={e => setF({ ...f, donorName: e.target.value })} /></Field>
      <Field label="Telegram"><input className={input} value={f.donorTelegram} onChange={e => setF({ ...f, donorTelegram: e.target.value })} /></Field>
      <Field label={`Сумма перевода, ${c.pay_currency === 'RUB' ? '₽' : 'IDR'}`}><input className={input} inputMode="numeric" value={f.pay} onChange={e => setF({ ...f, pay: e.target.value })} /></Field>
      {c.pay_currency !== c.gift_currency && (
        <Field label={`Засчитать в цель, ${c.gift_currency === 'RUB' ? '₽' : 'IDR'}`}><input className={input} inputMode="numeric" value={f.credit} onChange={e => setF({ ...f, credit: e.target.value })} /></Field>
      )}
      <Field label="Комментарий (только для вас)"><input className={input} value={f.adminComment} onChange={e => setF({ ...f, adminComment: e.target.value })} /></Field>
      <div className="flex items-end"><Check label="Показывать имя на сайте" checked={f.showNamePublicly} onChange={v => setF({ ...f, showNamePublicly: v })} /></div>
      <div className="sm:col-span-2"><button onClick={save} className={btnMain}>Сохранить</button></div>
    </div>
  )
}

function ManualAdd({ gifts, run, onDone }: { gifts: Gift[]; run: Run; onDone: () => void }) {
  const [f, setF] = useState({ giftId: gifts[0]?.id ?? '', cur: 'RUB' as Currency, amount: '', name: '', tg: '', comment: '', show: false })
  const amount = parseUserAmount(f.amount, f.cur)
  async function save() {
    if (!f.giftId || amount === null) return
    const ok = await run(() => sb!.rpc('admin_add_manual', { p: {
      giftId: f.giftId, payCurrency: f.cur, payAmountMinor: amount, donorName: f.name, donorTelegram: f.tg ? '@' + f.tg.replace(/^@/, '') : '',
      adminComment: f.comment, showNamePublicly: f.show,
    } }), 'Перевод добавлен')
    if (ok) onDone()
  }
  return (
    <Card>
      <p className="font-semibold">Перевод, полученный не через сайт</p>
      <p className="text-xs text-cocoa-mute">Сразу засчитывается как подтверждённый.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Подарок">
          <select className={input} value={f.giftId} onChange={e => setF({ ...f, giftId: e.target.value })}>
            {gifts.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Сумма"><input className={input} inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Валюта">
            <select className={input} value={f.cur} onChange={e => setF({ ...f, cur: e.target.value as Currency })}><option>RUB</option><option>IDR</option></select>
          </Field>
        </div>
        <Field label="Имя"><input className={input} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Telegram (необязательно)"><input className={input} value={f.tg} onChange={e => setF({ ...f, tg: e.target.value })} /></Field>
        <Field label="Комментарий"><input className={input} value={f.comment} onChange={e => setF({ ...f, comment: e.target.value })} /></Field>
        <div className="flex items-end"><Check label="Показывать имя на сайте" checked={f.show} onChange={v => setF({ ...f, show: v })} /></div>
      </div>
      <button onClick={save} disabled={amount === null || !f.name.trim()} className={`${btnMain} mt-4`}>Добавить</button>
    </Card>
  )
}

function exportCsv(data: Data) {
  const gift = new Map(data.gifts.map(g => [g.id, g.title]))
  const head = ['Номер', 'Создано', 'Статус', 'Подарок', 'Имя', 'Telegram', 'Имя публично', 'Валюта перевода', 'Сумма перевода', 'Валюта цели', 'В цель', 'Кол-во', 'Курс', 'Сообщил о переводе', 'Подтверждено', 'Чеков', 'Конфликт', 'Комментарий', 'Источник']
  const amt = (m: number, c: Currency) => c === 'RUB' ? (m / 100).toFixed(2) : String(m)
  const rows = data.contributions.map(c => [
    c.public_ref, c.created_at, STATUS[c.status][0], gift.get(c.gift_id) ?? '', c.donor_name, c.donor_telegram, c.show_name_publicly ? 'да' : 'нет',
    c.pay_currency, amt(c.pay_amount_minor, c.pay_currency), c.gift_currency, amt(c.gift_amount_minor, c.gift_currency), c.quantity ?? '',
    rateText(c.idr_per_rub), c.reported_paid_at ?? '', c.confirmed_at ?? '', data.receipts.filter(r => r.contribution_id === c.id).length,
    c.has_conflict ? 'да' : '', c.admin_comment ?? '', c.source === 'manual' ? 'вручную' : 'сайт',
  ])
  const esc = (v: unknown) => { const s = String(v); return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = '﻿' + [head, ...rows].map(r => r.map(esc).join(';')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `wishlist-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ---------- Подарки ----------
async function toWebp(file: File, maxW = 1400): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxW / bmp.width)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('convert')), 'image/webp', 0.86))
}

async function uploadMedia(file: File, prefix: string): Promise<string> {
  const blob = await toWebp(file)
  const path = `${prefix}-${Date.now()}.webp`
  const { error } = await sb!.storage.from('public-media').upload(path, blob, { contentType: 'image/webp', upsert: false })
  if (error) throw error
  return path
}

function Gifts({ data, run, reload, notify }: { data: Data; run: Run; reload: () => Promise<void>; notify: (t: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const confirmed = (id: string) => data.contributions.filter(c => c.gift_id === id && c.status === 'confirmed').reduce((s, c) => s + c.gift_amount_minor, 0)
  const goal = (g: Gift) => g.kind === 'fixed' ? g.goal_minor : g.kind === 'quantity' && g.target_quantity && g.unit_price_minor ? g.unit_price_minor * g.target_quantity : null
  return (
    <div className="space-y-2">
      <button onClick={() => setCreating(c => !c)} className={btnSoft}>{creating ? 'Скрыть' : '+ Новый подарок'}</button>
      {creating && <GiftEditor data={data} run={run} reload={reload} notify={notify} onDone={() => setCreating(false)} />}
      {data.gifts.map(g => {
        const got = confirmed(g.id), gl = goal(g)
        return (
          <Card key={g.id} className="!p-0">
            <button onClick={() => setOpen(open === g.id ? null : g.id)} className="flex w-full items-center gap-3 p-4 text-left">
              <span className="w-6 text-xs text-cocoa-mute">{g.sort_order}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{g.title}</span>
                <span className="text-xs text-cocoa-mute">
                  {format(got, g.currency)}{gl ? ` из ${format(gl, g.currency)}` : ' собрано'}
                  {!g.is_visible && ' · скрыт'}{!g.is_open && ' · сбор закрыт'}
                </span>
              </span>
              <span className="text-cocoa-mute">{open === g.id ? '▴' : '▾'}</span>
            </button>
            {open === g.id && <div className="border-t border-cream-deep p-4"><GiftEditor gift={g} data={data} run={run} reload={reload} notify={notify} onDone={() => setOpen(null)} /></div>}
          </Card>
        )
      })}
    </div>
  )
}

function GiftEditor({ gift, data, run, reload, notify, onDone }: { gift?: Gift; data: Data; run: Run; reload: () => Promise<void>; notify: (t: string) => void; onDone: () => void }) {
  const g = gift
  const [f, setF] = useState({
    title: g?.title ?? '', description: g?.description ?? '', public_note: g?.public_note ?? '', admin_note: g?.admin_note ?? '',
    kind: g?.kind ?? 'fixed' as GiftKind, currency: g?.currency ?? 'IDR' as Currency, category_id: g?.category_id ?? data.categories[0]?.id ?? '',
    goal: units(g?.goal_minor ?? null, g?.currency ?? 'IDR'), unit_price: units(g?.unit_price_minor ?? null, g?.currency ?? 'IDR'),
    unit_label: g?.unit_label ?? '', target_quantity: g?.target_quantity ? String(g.target_quantity) : '', min_order_quantity: String(g?.min_order_quantity ?? 1),
    sort_order: String(g?.sort_order ?? (Math.max(0, ...data.gifts.map(x => x.sort_order)) + 1)), is_visible: g?.is_visible ?? true, is_open: g?.is_open ?? true,
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const images = g ? data.images.filter(i => i.gift_id === g.id) : []
  const bundled = g ? seedGifts().find(s => s.slug === g.slug)?.images[0]?.url : undefined
  const photo = images[0] ? mediaUrl(images[0].storage_path) : bundled

  async function save() {
    const goal = f.kind === 'fixed' ? parseUserAmount(f.goal, f.currency) : null
    const unit = f.kind === 'quantity' ? parseUserAmount(f.unit_price, f.currency) : null
    if (!f.title.trim()) return alert('Укажите название')
    if (f.kind === 'fixed' && goal === null) return alert('Укажите цену целым числом')
    if (f.kind === 'quantity' && (unit === null || !f.unit_label.trim())) return alert('Укажите цену за единицу и название единицы')
    const row = {
      title: f.title.trim(), description: f.description.trim(), public_note: f.public_note.trim() || null, admin_note: f.admin_note.trim() || null,
      category_id: f.category_id || null, goal_minor: goal, unit_price_minor: unit, unit_label: f.kind === 'quantity' ? f.unit_label.trim() : null,
      target_quantity: f.kind === 'quantity' && f.target_quantity ? Number(f.target_quantity) : null,
      min_order_quantity: f.kind === 'quantity' ? Math.max(1, Number(f.min_order_quantity) || 1) : 1,
      sort_order: Number(f.sort_order) || 0, is_visible: f.is_visible, is_open: f.is_open,
    }
    const ok = g
      ? await run(() => sb!.from('gifts').update(row).eq('id', g.id), 'Подарок сохранён')
      : await run(() => sb!.from('gifts').insert({ ...row, kind: f.kind, currency: f.currency, slug: `gift-${Date.now().toString(36)}` }), 'Подарок добавлен')
    if (ok) onDone()
  }

  async function upload(file: File) {
    if (!g) return
    setBusy(true)
    try {
      const path = await uploadMedia(file, `gifts/${g.slug}`)
      const { error } = await sb!.from('gift_images').insert({ gift_id: g.id, storage_path: path, alt: g.title, kind: 'photo', sort_order: 0 })
      if (error) throw error
      for (const old of images) {
        await sb!.from('gift_images').delete().eq('id', old.id)
        await sb!.storage.from('public-media').remove([old.storage_path])
      }
      notify('Фото обновлено'); await reload()
    } catch (e) { alert(errText(e)) } finally { setBusy(false) }
  }
  async function resetPhoto() {
    if (!confirm('Вернуть стандартное фото?')) return
    for (const old of images) {
      await sb!.from('gift_images').delete().eq('id', old.id)
      await sb!.storage.from('public-media').remove([old.storage_path])
    }
    notify('Фото сброшено'); await reload()
  }
  const curSign = f.currency === 'RUB' ? '₽' : 'IDR'

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {g && (
        <div className="flex items-center gap-3 sm:col-span-2">
          {photo ? <img src={photo} alt="" className="h-20 w-28 rounded-xl object-cover" /> : <div className="flex h-20 w-28 items-center justify-center rounded-xl bg-blush-soft text-2xl">🎁</div>}
          <div className="space-y-1.5">
            <label className={`${btnSoft} inline-block cursor-pointer`}>
              {busy ? 'Загрузка…' : 'Заменить фото'}
              <input type="file" accept="image/*" hidden disabled={busy} onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            {images.length > 0 && <button onClick={resetPhoto} className="block text-xs text-cocoa-mute underline">Вернуть стандартное</button>}
          </div>
        </div>
      )}
      <Field label="Название"><input className={input} value={f.title} onChange={set('title')} /></Field>
      <Field label="Категория">
        <select className={input} value={f.category_id} onChange={set('category_id')}>
          {data.categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="Описание"><textarea rows={2} className={input} value={f.description} onChange={set('description')} /></Field>
      <Field label="Заметка на сайте (необязательно)"><textarea rows={2} className={input} value={f.public_note} onChange={set('public_note')} /></Field>
      {!g && (
        <>
          <Field label="Тип">
            <select className={input} value={f.kind} onChange={set('kind')}>
              <option value="fixed">Фиксированная цена</option><option value="quantity">Поштучно</option><option value="open">Любая сумма</option>
            </select>
          </Field>
          <Field label="Валюта цели">
            <select className={input} value={f.currency} onChange={set('currency')}><option>IDR</option><option>RUB</option></select>
          </Field>
        </>
      )}
      {f.kind === 'fixed' && <Field label={`Цель, ${curSign}`}><input className={input} inputMode="numeric" value={f.goal} onChange={set('goal')} /></Field>}
      {f.kind === 'quantity' && (
        <>
          <Field label={`Цена за единицу, ${curSign}`}><input className={input} inputMode="numeric" value={f.unit_price} onChange={set('unit_price')} /></Field>
          <Field label="Единица (сеанс, пачка…)"><input className={input} value={f.unit_label} onChange={set('unit_label')} /></Field>
          <Field label="Максимум штук" hint="Пусто — без ограничения"><input className={input} inputMode="numeric" value={f.target_quantity} onChange={set('target_quantity')} /></Field>
          <Field label="Минимум за раз"><input className={input} inputMode="numeric" value={f.min_order_quantity} onChange={set('min_order_quantity')} /></Field>
        </>
      )}
      <Field label="Порядок на сайте"><input className={input} inputMode="numeric" value={f.sort_order} onChange={set('sort_order')} /></Field>
      <Field label="Заметка для себя"><input className={input} value={f.admin_note} onChange={set('admin_note')} /></Field>
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <Check label="Показывать на сайте" checked={f.is_visible} onChange={v => setF({ ...f, is_visible: v })} />
        <Check label="Принимать переводы" checked={f.is_open} onChange={v => setF({ ...f, is_open: v })} />
      </div>
      <div className="sm:col-span-2"><button onClick={save} className={btnMain}>{g ? 'Сохранить' : 'Добавить подарок'}</button></div>
    </div>
  )
}

// ---------- Настройки ----------
const toBali = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 16)
const fromBali = (v: string) => `${v}:00+08:00`

function Settings({ data, run, reload, notify }: { data: Data; run: Run; reload: () => Promise<void>; notify: (t: string) => void }) {
  return (
    <div className="space-y-4">
      <RateBox rates={data.rates} run={run} />
      {data.payments.map(p => <PaymentBox key={p.currency} p={p} run={run} />)}
      <SiteBox site={data.site} run={run} reload={reload} notify={notify} />
      <NotifyBox s={data.settings} run={run} />
    </div>
  )
}

function RateBox({ rates, run }: { rates: Rate[]; run: Run }) {
  const [v, setV] = useState('')
  const cur = rates[0]
  return (
    <Card>
      <p className="font-semibold">Курс</p>
      <p className="mt-1 text-sm">Сейчас: <b>1 ₽ = {cur ? rateText(cur.idr_per_rub) : '—'} IDR</b></p>
      <p className="text-xs text-cocoa-mute">Новый курс применяется только к новым заявкам. Уже созданные сохраняют свой.</p>
      <div className="mt-3 flex gap-2">
        <input value={v} onChange={e => setV(e.target.value.replace(',', '.'))} placeholder="Например, 195.5" inputMode="decimal" className={`${input} max-w-40`} />
        <button disabled={!/^\d+(\.\d{1,6})?$/.test(v) || Number(v) <= 0}
          onClick={async () => { if (await run(() => sb!.rpc('admin_set_rate', { p_rate: v }), 'Курс обновлён')) setV('') }} className={btnMain}>Сохранить</button>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-cocoa-mute">История</summary>
        <ul className="mt-2 space-y-1 text-xs">
          {rates.map(r => <li key={r.id}>{when(r.created_at)} — {rateText(r.idr_per_rub)}{r.set_by ? ` · ${r.set_by}` : ''}</li>)}
        </ul>
      </details>
    </Card>
  )
}

function PaymentBox({ p, run }: { p: Payment; run: Run }) {
  const [f, setF] = useState({ is_enabled: p.is_enabled, recipient_name: p.recipient_name ?? '', details_text: p.details_text ?? '', instructions: p.instructions ?? '' })
  return (
    <Card>
      <p className="font-semibold">Реквизиты · {p.currency === 'RUB' ? 'рубли' : 'рупии'}</p>
      <p className="text-xs text-cocoa-mute">Показываются гостю только после оформления заявки.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Получатель"><input className={input} value={f.recipient_name} onChange={e => setF({ ...f, recipient_name: e.target.value })} /></Field>
        <div className="flex items-end"><Check label="Принимать переводы в этой валюте" checked={f.is_enabled} onChange={v => setF({ ...f, is_enabled: v })} /></div>
        <Field label="Реквизиты"><textarea rows={3} className={input} value={f.details_text} onChange={e => setF({ ...f, details_text: e.target.value })} /></Field>
        <Field label="Инструкция для гостя"><textarea rows={3} className={input} value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} /></Field>
      </div>
      <button onClick={() => {
        if (f.is_enabled && !f.details_text.trim()) return alert('Чтобы включить валюту, заполните реквизиты')
        run(() => sb!.from('payment_settings').update({ ...f, recipient_name: f.recipient_name.trim() || null, instructions: f.instructions.trim() || null }).eq('currency', p.currency), 'Реквизиты сохранены')
      }} className={`${btnMain} mt-4`}>Сохранить</button>
    </Card>
  )
}

function SiteBox({ site, run, reload, notify }: { site: Site; run: Run; reload: () => Promise<void>; notify: (t: string) => void }) {
  const [f, setF] = useState({ welcome_text: site.welcome_text ?? '', telegram_contact: site.telegram_contact ?? '', ends: toBali(site.countdown_ends_at), accepting: site.accepting_contributions })
  const [busy, setBusy] = useState(false)
  async function hero(file: File) {
    setBusy(true)
    try {
      const path = await uploadMedia(file, 'hero/dasha')
      const { error } = await sb!.from('site_settings').update({ hero_image_path: path }).eq('id', site.id)
      if (error) throw error
      if (site.hero_image_path) await sb!.storage.from('public-media').remove([site.hero_image_path])
      notify('Фото обновлено'); await reload()
    } catch (e) { alert(errText(e)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <p className="font-semibold">Сайт</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Приветствие" hint="Пусто — стандартный текст"><textarea rows={6} className={input} value={f.welcome_text} onChange={e => setF({ ...f, welcome_text: e.target.value })} /></Field>
        <div className="space-y-3">
          <Field label="Ваш Telegram для гостей" hint="Например, @dasha. Пусто — не показывать"><input className={input} value={f.telegram_contact} onChange={e => setF({ ...f, telegram_contact: e.target.value })} /></Field>
          <Field label="Сбор до (время Бали)"><input type="datetime-local" className={input} value={f.ends} onChange={e => setF({ ...f, ends: e.target.value })} /></Field>
          <Check label="Принимать новые заявки" checked={f.accepting} onChange={v => setF({ ...f, accepting: v })} />
          <label className={`${btnSoft} inline-block cursor-pointer`}>
            {busy ? 'Загрузка…' : 'Заменить главное фото'}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={e => e.target.files?.[0] && hero(e.target.files[0])} />
          </label>
        </div>
      </div>
      <button onClick={() => run(() => sb!.from('site_settings').update({
        welcome_text: f.welcome_text.trim() || null, telegram_contact: f.telegram_contact.trim() || null,
        countdown_ends_at: fromBali(f.ends), accepting_contributions: f.accepting,
      }).eq('id', site.id), 'Сохранено')} className={`${btnMain} mt-4`}>Сохранить</button>
    </Card>
  )
}

function NotifyBox({ s, run }: { s: AdminSettings; run: Run }) {
  const [f, setF] = useState(s)
  const flags: [keyof AdminSettings, string][] = [
    ['notify_new', 'Новая заявка'], ['notify_reported_paid', 'Гость нажал «Я перевёл(а)»'], ['notify_receipt', 'Загружен чек'],
    ['notify_expired', 'Бронь истекла'], ['notify_fully_funded', 'Подарок собран'], ['notify_conflict', 'Конфликт'],
  ]
  return (
    <Card>
      <p className="font-semibold">Уведомления и бронь</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Бронь, часов"><input className={input} inputMode="numeric" value={f.reservation_hours} onChange={e => setF({ ...f, reservation_hours: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
        <Field label="Telegram chat ID" hint="Заполнится при подключении бота"><input className={input} value={f.telegram_chat_id ?? ''} onChange={e => setF({ ...f, telegram_chat_id: e.target.value || null })} /></Field>
        <div className="space-y-2 sm:col-span-2">
          {flags.map(([k, t]) => <Check key={k} label={t} checked={f[k] as boolean} onChange={v => setF({ ...f, [k]: v })} />)}
        </div>
      </div>
      <button onClick={() => {
        if (f.reservation_hours < 1 || f.reservation_hours > 720) return alert('Бронь — от 1 до 720 часов')
        const { id, ...rest } = f
        run(() => sb!.from('admin_settings').update(rest).eq('id', id), 'Сохранено')
      }} className={`${btnMain} mt-4`}>Сохранить</button>
    </Card>
  )
}

// ---------- Журнал ----------
const ACTION: Record<string, string> = {
  'contribution.create': 'Новая заявка', 'contribution.report_paid': 'Гость сообщил о переводе', 'contribution.cancel': 'Гость отменил выбор',
  'contribution.confirm': 'Подтверждён перевод', 'contribution.rejected': 'Заявка отклонена', 'contribution.cancelled': 'Заявка отменена',
  'contribution.edit': 'Заявка изменена', 'contribution.manual': 'Добавлен перевод вручную', 'contribution.delete': 'Заявка удалена', 'conflict.resolve': 'Конфликт решён',
  'rate.set': 'Изменён курс', update: 'Изменено', insert: 'Добавлено', delete: 'Удалено',
}
const ENTITY: Record<string, string> = { gifts: 'подарок', payment_settings: 'реквизиты', site_settings: 'настройки сайта', admin_settings: 'уведомления' }

function Log({ audit }: { audit: Audit[] }) {
  return (
    <Card>
      <ul className="divide-y divide-cream-deep text-sm">
        {audit.map(a => (
          <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
            <span>{ACTION[a.action] ?? a.action}{ENTITY[a.entity] ? ` · ${ENTITY[a.entity]}` : ''}</span>
            <span className="text-xs text-cocoa-mute">{when(a.at)} · {a.actor === 'donor' ? 'гость' : a.actor}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
