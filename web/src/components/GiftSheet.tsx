import { useEffect, useMemo, useRef, useState } from 'react'
import type { CreatedContribution, Currency, PublicGift, SiteSettings } from '../lib/types'
import { creditFor, dual, format, parseUserAmount, payLimit, progressOf } from '../lib/money'
import { api, ApiError, checkReceipt } from '../data/api'
import { GiftArt, PriceLine, ProgressInfo } from './GiftCard'
import { Heart } from './Decor'

type Step = 'details' | 'form' | 'pay' | 'done'
const STORE = 'wishlist:pending:'

type Pending = { c: CreatedContribution; reported: boolean; receipt?: boolean }
function loadPending(giftId: string): Pending | null {
  try {
    const raw = localStorage.getItem(STORE + giftId)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!v.reported && v.c.expiresAt && new Date(v.c.expiresAt).getTime() < Date.now()) { localStorage.removeItem(STORE + giftId); return null }
    return v
  } catch { return null }
}
function savePending(giftId: string, v: Pending | null) {
  try { v ? localStorage.setItem(STORE + giftId, JSON.stringify(v)) : localStorage.removeItem(STORE + giftId) } catch { /* приватный режим */ }
}

const field = 'w-full rounded-2xl border border-cream-deep bg-white px-4 py-3 text-base outline-none transition placeholder:text-cocoa-mute focus:border-blush-deep focus:ring-4 focus:ring-blush/50'

export function GiftSheet({ gift, settings, onClose, onChanged }: {
  gift: PublicGift; settings: SiteSettings; onClose: () => void; onChanged: () => void
}) {
  const pending = useMemo(() => loadPending(gift.id), [gift.id])
  const [step, setStep] = useState<Step>(pending ? (pending.reported ? 'done' : 'pay') : 'details')
  const [created, setCreated] = useState<CreatedContribution | null>(pending?.c ?? null)
  const [receiptSent, setReceiptSent] = useState(!!pending?.receipt)
  const dialog = useRef<HTMLDivElement>(null)

  // Сверяем сохранённую заявку с базой: Даша могла уже подтвердить или отклонить её.
  useEffect(() => {
    if (!pending) return
    let alive = true
    api.status(pending.c.id, pending.c.cancelToken).then(st => {
      if (!alive || !st) return
      if (st === 'pending_transfer' || st === 'awaiting_confirmation') return
      savePending(gift.id, null); setCreated(null); setStep('details')
    })
    return () => { alive = false }
  }, [pending, gift.id])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    dialog.current?.focus()
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal aria-label={gift.title}>
      <div className="absolute inset-0 animate-[fade-up_.25s_both] bg-cocoa/40 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialog} tabIndex={-1}
        className="relative max-h-[92dvh] w-full max-w-lg animate-fade-up overflow-y-auto overscroll-contain rounded-t-[2rem] bg-cream shadow-lift outline-none sm:rounded-[2rem]">
        <button onClick={onClose} aria-label="Закрыть"
          className="absolute top-4 right-4 z-10 grid size-10 place-items-center rounded-full bg-white/90 text-xl shadow-soft hover:bg-white">×</button>
        {step === 'details' && <Details gift={gift} settings={settings} onGive={() => setStep('form')} />}
        {step === 'form' && (
          <ContributionForm gift={gift} settings={settings} onBack={() => setStep('details')}
            onCreated={c => { setCreated(c); savePending(gift.id, { c, reported: false }); setStep('pay'); onChanged() }} />
        )}
        {step === 'pay' && created && (
          <PayStep c={created} gift={gift}
            onReported={sent => { savePending(gift.id, { c: created, reported: true, receipt: sent }); setReceiptSent(sent); setStep('done') }}
            onCancelled={() => { savePending(gift.id, null); setCreated(null); setStep('details'); onChanged() }} />
        )}
        {step === 'done' && created && (
          <Done c={created} receiptSent={receiptSent} onReceipt={() => { setReceiptSent(true); savePending(gift.id, { c: created, reported: true, receipt: true }) }} onClose={() => { onClose() }} onNew={() => { savePending(gift.id, null); setCreated(null); setStep('details') }} />
        )}
      </div>
    </div>
  )
}

function Details({ gift, settings, onGive }: { gift: PublicGift; settings: SiteSettings; onGive: () => void }) {
  const p = progressOf(gift)
  const refs = gift.images.filter(i => i.kind === 'reference')
  const hasPhoto = gift.images.some(i => i.kind === 'photo')
  const closed = p.funded || !gift.isOpen || !settings.acceptingContributions || (p.available !== null && p.available === 0)
  return (
    <div>
      {(hasPhoto || refs.length === 0) && <GiftArt gift={{ ...gift, images: gift.images.filter(i => i.kind === 'photo') }} className="aspect-[4/3] w-full" />}
      <div className="space-y-5 p-6 sm:p-8">
        <div>
          <h2 className="pr-10 font-display text-3xl leading-tight font-semibold">{gift.title}</h2>
          {gift.description && <p className="mt-2 leading-relaxed text-cocoa-soft">{gift.description}</p>}
          {gift.publicNote && <p className="mt-3 rounded-2xl bg-baby-soft px-4 py-3 text-sm text-cocoa-soft">{gift.publicNote}</p>}
        </div>
        {refs.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.15em] text-cocoa-mute uppercase">Референс</p>
            <div className="flex gap-3 overflow-x-auto">
              {refs.map((r, i) => <img key={i} src={r.url} alt={r.alt} className="max-h-96 rounded-2xl object-cover" />)}
            </div>
          </div>
        )}
        <PriceLine gift={gift} rate={settings.idrPerRub} />
        <ProgressInfo gift={gift} rate={settings.idrPerRub} />
        {gift.donorNames.length > 0 && <p className="text-sm text-cocoa-soft">Уже порадовали: {gift.donorNames.join(', ')} 💗</p>}
        {p.funded ? (
          <div className="rounded-2xl bg-blush px-5 py-4 text-center font-semibold">Подарено 💗 Спасибо всем!</div>
        ) : closed ? (
          <div className="rounded-2xl bg-cream-deep px-5 py-4 text-center text-sm text-cocoa-soft">
            {p.available === 0 ? 'Всю сумму уже выбрали другие гости, ждём их переводы. Если кто-то не переведёт за 48 часов, подарок снова станет доступен — загляните позже.' : 'Приём подарков сейчас приостановлен.'}
          </div>
        ) : (
          <button onClick={onGive} className="w-full rounded-full bg-cocoa py-3.5 font-semibold text-cream shadow-lift transition hover:bg-cocoa-soft">Подарить</button>
        )}
      </div>
    </div>
  )
}

function ContributionForm({ gift, settings, onBack, onCreated }: {
  gift: PublicGift; settings: SiteSettings; onBack: () => void; onCreated: (c: CreatedContribution) => void
}) {
  const rate = settings.idrPerRub
  const p = progressOf(gift)
  const enabled = (['RUB', 'IDR'] as Currency[]).filter(c => settings.currencies[c])
  const [currency, setCurrency] = useState<Currency>(enabled[0] ?? 'RUB')
  const qtyOnly = gift.kind === 'quantity' && gift.minOrderQuantity > 1
  const [mode, setMode] = useState<'full' | 'part' | 'qty'>(gift.kind === 'quantity' ? 'qty' : gift.kind === 'open' ? 'part' : 'full')
  const maxQty = gift.kind === 'quantity' && p.available !== null && gift.unitPriceMinor ? Math.floor(p.available / gift.unitPriceMinor) : null
  const [qty, setQty] = useState(gift.minOrderQuantity)
  const [amountText, setAmountText] = useState('')
  const [name, setName] = useState('')
  const [tg, setTg] = useState('')
  const [publicName, setPublicName] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = useRef(crypto.randomUUID())

  const limit = p.available === null ? null : payLimit(p.available, gift.currency, currency, rate)
  const qtyPay = gift.unitPriceMinor ? payLimit(gift.unitPriceMinor * qty, gift.currency, currency, rate) : 0
  const payMinor = mode === 'full' ? limit : mode === 'qty' ? qtyPay : parseUserAmount(amountText, currency)
  const credited = payMinor ? creditFor(payMinor, currency, gift.currency, rate, p.available) : 0

  let amountError: string | null = null
  if (mode === 'part' && amountText && payMinor === null) amountError = 'Введите сумму целым числом'
  else if (mode === 'part' && payMinor !== null && limit !== null && payMinor > limit) amountError = `Максимум сейчас — ${format(limit, currency)}`
  else if (mode === 'qty' && qty < gift.minOrderQuantity) amountError = `Минимум ${gift.minOrderQuantity} шт.`
  else if (mode === 'qty' && maxQty !== null && qty > maxQty) amountError = `Сейчас доступно не больше ${maxQty} шт.`

  const tgClean = tg.trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '')
  const tgValid = /^[A-Za-z0-9_]{5,32}$/.test(tgClean)
  const canSubmit = enabled.length > 0 && !!payMinor && credited > 0 && !amountError && name.trim().length > 0 && tgValid && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !payMinor) return
    setBusy(true); setError(null)
    try {
      const c = await api.createContribution({
        giftId: gift.id, payCurrency: currency, payAmountMinor: payMinor, quantity: mode === 'qty' ? qty : null,
        donorName: name.trim(), donorTelegram: '@' + tgClean, showNamePublicly: publicName, idempotencyKey: key.current,
      })
      onCreated(c)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не получилось отправить заявку. Проверьте интернет и попробуйте ещё раз.')
      if (err instanceof ApiError && err.code !== 'duplicate') key.current = crypto.randomUUID()
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-6 p-6 sm:p-8" noValidate>
      <div>
        <button type="button" onClick={onBack} className="text-sm text-cocoa-mute hover:text-cocoa">← {gift.title}</button>
        <h2 className="mt-2 font-display text-3xl font-semibold">Подарить</h2>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Валюта перевода</legend>
        {enabled.length === 0 ? (
          <p className="rounded-2xl bg-cream-deep px-4 py-3 text-sm text-cocoa-soft">Реквизиты для перевода ещё не добавлены. Попробуйте чуть позже или напишите Даше.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(['RUB', 'IDR'] as Currency[]).map(c => (
              <button type="button" key={c} disabled={!settings.currencies[c]} onClick={() => setCurrency(c)} aria-pressed={currency === c}
                className={`rounded-2xl border px-4 py-3 text-left transition disabled:opacity-40 ${currency === c ? 'border-cocoa bg-white shadow-soft' : 'border-cream-deep bg-white/60'}`}>
                <span className="block font-semibold">{c === 'RUB' ? '₽ Рубли' : 'Rp Рупии'}</span>
                <span className="text-xs text-cocoa-mute">{settings.currencies[c] ? (c === 'RUB' ? 'перевод в RUB' : 'перевод в IDR') : 'временно недоступно'}</span>
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Сумма</legend>
        {gift.kind === 'fixed' && (
          <div className="grid grid-cols-2 gap-2">
            {(['full', 'part'] as const).map(m => (
              <button type="button" key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${mode === m ? 'border-cocoa bg-white shadow-soft' : 'border-cream-deep bg-white/60'}`}>
                <span className="block font-semibold">{m === 'full' ? 'Всю сумму' : 'Часть'}</span>
                <span className="text-xs text-cocoa-mute">{m === 'full' && limit !== null ? format(limit, currency) : 'скинуться вместе'}</span>
              </button>
            ))}
          </div>
        )}
        {gift.kind === 'quantity' && !qtyOnly && (
          <div className="grid grid-cols-2 gap-2">
            {(['qty', 'part'] as const).map(m => (
              <button type="button" key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${mode === m ? 'border-cocoa bg-white shadow-soft' : 'border-cream-deep bg-white/60'}`}>
                <span className="block font-semibold">{m === 'qty' ? `По ${gift.unitLabel === 'сеанс' ? 'сеансам' : 'штукам'}` : 'Часть суммы'}</span>
                <span className="text-xs text-cocoa-mute">{m === 'qty' ? `${dual(gift.unitPriceMinor!, gift.currency, rate).rub} за 1` : 'любая сумма'}</span>
              </button>
            ))}
          </div>
        )}
        {mode === 'qty' && (
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
            <span className="text-sm">Количество{qtyOnly && <span className="text-cocoa-mute"> (от {gift.minOrderQuantity})</span>}</span>
            <div className="flex items-center gap-3">
              <button type="button" aria-label="Меньше" onClick={() => setQty(q => Math.max(gift.minOrderQuantity, q - 1))}
                className="grid size-9 place-items-center rounded-full bg-blush-soft text-lg hover:bg-blush">−</button>
              <input inputMode="numeric" value={qty} aria-label="Количество"
                onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10); setQty(n) }}
                className="w-14 rounded-xl border border-cream-deep py-1 text-center font-semibold tabular-nums" />
              <button type="button" aria-label="Больше" onClick={() => setQty(q => maxQty !== null ? Math.min(maxQty, q + 1) : q + 1)}
                className="grid size-9 place-items-center rounded-full bg-blush-soft text-lg hover:bg-blush">+</button>
            </div>
          </div>
        )}
        {mode === 'part' && (
          <div className="relative">
            <input inputMode="numeric" autoComplete="off" value={amountText} onChange={e => setAmountText(e.target.value)}
              placeholder={currency === 'RUB' ? 'Например, 1 500' : 'Например, 300 000'} className={field} aria-invalid={!!amountError} />
            <span className="absolute top-1/2 right-4 -translate-y-1/2 text-cocoa-mute">{currency === 'RUB' ? '₽' : 'IDR'}</span>
          </div>
        )}
        {amountError ? <p className="text-sm text-red-700">{amountError}</p> : payMinor && credited > 0 ? (
          <p className="text-sm text-cocoa-soft">
            К переводу: <b>{format(payMinor, currency)}</b>
            {currency !== gift.currency && <> · ≈ {format(credited, gift.currency)} по курсу 1 ₽ = {rate} IDR</>}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">Кто дарит</legend>
        <input value={name} onChange={e => setName(e.target.value.slice(0, 80))} placeholder="Ваше имя" autoComplete="given-name" className={field} required />
        <div>
          <input value={tg} onChange={e => setTg(e.target.value.slice(0, 60))} placeholder="Telegram, например @username" autoComplete="off" autoCapitalize="none" className={field} required aria-invalid={tg.length > 0 && !tgValid} />
          {tg.length > 0 && !tgValid && <p className="mt-1 text-sm text-red-700">Ник в Telegram: 5–32 символа, латиница, цифры и _</p>}
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white px-4 py-3 text-sm">
          <input type="checkbox" checked={publicName} onChange={e => setPublicName(e.target.checked)} className="mt-0.5 size-5 accent-[#4A2C24]" />
          <span>Показать моё имя на сайте среди дарителей<span className="block text-xs text-cocoa-mute">Сумма и Telegram никогда не показываются публично</span></span>
        </label>
      </fieldset>

      <p className="text-xs leading-relaxed text-cocoa-mute">
        Имя и Telegram нужны, чтобы Даша могла сверить перевод и поблагодарить вас. Их видит только она.
        Чтобы удалить свои данные, напишите Даше в Telegram.
      </p>

      {error && <p role="alert" className="rounded-2xl bg-blush-soft px-4 py-3 text-sm">{error}</p>}

      <button type="submit" disabled={!canSubmit}
        className="w-full rounded-full bg-cocoa py-3.5 font-semibold text-cream shadow-lift transition hover:bg-cocoa-soft disabled:bg-cocoa-mute disabled:shadow-none">
        {busy ? 'Оформляем…' : 'Получить реквизиты'}
      </button>
    </form>
  )
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800) } catch { /* нет доступа к буферу */ }
    }} className="shrink-0 rounded-full bg-blush px-4 py-2 text-xs font-semibold hover:bg-blush-deep">{ok ? 'Скопировано ✓' : 'Копировать'}</button>
  )
}

function ReceiptPicker({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-blush-deep bg-white/70 px-4 py-3 text-sm transition hover:bg-white">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blush-soft">📎</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{file ? file.name : 'Приложить чек'}</span>
          <span className="text-xs text-cocoa-mute">{file ? 'Нажмите, чтобы выбрать другой' : 'Необязательно · фото или PDF до 10 МБ'}</span>
        </span>
        {file && <button type="button" onClick={e => { e.preventDefault(); setFile(null) }} className="text-xs text-cocoa-mute underline">убрать</button>}
        <input type="file" accept="image/*,application/pdf,.heic" className="sr-only" onChange={e => {
          const f = e.target.files?.[0] ?? null
          e.target.value = ''
          if (!f) return
          const err = checkReceipt(f)
          setError(err); setFile(err ? null : f)
        }} />
      </label>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  )
}

function PayStep({ c, gift, onReported, onCancelled }: { c: CreatedContribution; gift: PublicGift; onReported: (receiptSent: boolean) => void; onCancelled: () => void }) {
  const [confirming, setConfirming] = useState<'paid' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const amountPlain = c.payCurrency === 'RUB' ? String(c.payAmountMinor / 100) : String(c.payAmountMinor)
  const expires = c.expiresAt ? new Date(c.expiresAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null

  async function act(kind: 'paid' | 'cancel') {
    setBusy(true); setError(null)
    try {
      if (kind === 'paid') {
        await api.reportPaid(c.id, c.cancelToken)
        let receiptFailed = false
        if (receipt) { try { await api.uploadReceipt(c.id, c.cancelToken, receipt) } catch { receiptFailed = true } }
        onReported(!!receipt && !receiptFailed)
      }
      else { await api.cancel(c.id, c.cancelToken); onCancelled() }
    } catch { setError('Не получилось. Проверьте интернет и попробуйте ещё раз.') }
    finally { setBusy(false); setConfirming(null) }
  }

  return (
    <div className="space-y-5 p-6 sm:p-8">
      <div>
        <p className="pr-12 text-sm text-cocoa-mute">{gift.title} · заявка {c.publicRef}</p>
        <h2 className="mt-1 font-display text-3xl font-semibold">Реквизиты для перевода</h2>
      </div>
      <div className="space-y-3 rounded-[1.5rem] bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs text-cocoa-mute">Сумма</p><p className="font-display text-3xl font-semibold">{format(c.payAmountMinor, c.payCurrency)}</p></div>
          <CopyButton text={amountPlain} />
        </div>
        <hr className="border-cream-deep" />
        {c.payment.recipientName && <div><p className="text-xs text-cocoa-mute">Получатель</p><p className="font-semibold">{c.payment.recipientName}</p></div>}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-xs text-cocoa-mute">Реквизиты</p><p className="font-semibold break-words whitespace-pre-line">{c.payment.detailsText}</p></div>
          <CopyButton text={c.payment.detailsText} />
        </div>
      </div>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-cocoa-soft">
        <li>{c.payment.instructions ?? 'Переведите точную сумму через ваш банк.'}</li>
        <li>Вернитесь сюда и нажмите «Я перевёл(а)».</li>
        <li>Даша проверит поступление и подтвердит подарок.</li>
      </ol>
      {expires && <p className="rounded-2xl bg-baby-soft px-4 py-3 text-sm">Сумма забронирована за вами до {expires}. Если не успеете — бронь снимется сама.</p>}
      {error && <p role="alert" className="rounded-2xl bg-blush-soft px-4 py-3 text-sm">{error}</p>}

      <ReceiptPicker file={receipt} setFile={setReceipt} />
      {confirming ? (
        <div className="space-y-3 rounded-[1.5rem] border border-cocoa/15 bg-white p-5">
          <p className="font-semibold">{confirming === 'paid' ? 'Вы уже отправили перевод?' : 'Отменить заявку?'}</p>
          <p className="text-sm text-cocoa-soft">{confirming === 'paid' ? (receipt ? 'Чек отправится вместе с отметкой.' : 'Нажимайте, только если перевод действительно отправлен. Чек можно приложить и потом.') : 'Бронь суммы снимется, и её смогут подарить другие.'}</p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => act(confirming)} className="flex-1 rounded-full bg-cocoa py-3 text-sm font-semibold text-cream disabled:opacity-60">{busy ? '…' : 'Да'}</button>
            <button disabled={busy} onClick={() => setConfirming(null)} className="flex-1 rounded-full bg-cream-deep py-3 text-sm font-semibold">Назад</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button onClick={() => setConfirming('paid')} className="w-full rounded-full bg-cocoa py-3.5 font-semibold text-cream shadow-lift hover:bg-cocoa-soft">Я перевёл(а)</button>
          <button onClick={() => setConfirming('cancel')} className="w-full py-2 text-sm text-cocoa-mute underline underline-offset-4 hover:text-cocoa">Отменить заявку</button>
        </div>
      )}
    </div>
  )
}

function Done({ c, receiptSent, onReceipt, onClose, onNew }: {
  c: CreatedContribution; receiptSent: boolean; onReceipt: () => void; onClose: () => void; onNew: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function upload() {
    if (!file) return
    setBusy(true); setError(null)
    try { await api.uploadReceipt(c.id, c.cancelToken, file); onReceipt() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Не получилось загрузить чек. Попробуйте ещё раз.') }
    finally { setBusy(false) }
  }
  return (
    <div className="space-y-5 p-8 text-center">
      <Heart className="mx-auto size-14 animate-float text-blush-deep" />
      <h2 className="font-display text-3xl font-semibold">Спасибо!</h2>
      <p className="text-cocoa-soft">Перевод {format(c.payAmountMinor, c.payCurrency)} ожидает подтверждения. Как только Даша увидит деньги, прогресс подарка обновится.</p>
      <p className="text-xs text-cocoa-mute">Номер заявки: {c.publicRef}</p>
      {receiptSent ? (
        <p className="rounded-2xl bg-baby-soft px-4 py-3 text-sm">Чек получен ✓</p>
      ) : (
        <div className="space-y-2 text-left">
          <ReceiptPicker file={file} setFile={setFile} />
          {file && <button onClick={upload} disabled={busy} className="w-full rounded-full bg-blush py-3 text-sm font-semibold disabled:opacity-60">{busy ? 'Загружаем…' : 'Отправить чек'}</button>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
      )}
      <div className="space-y-2">
        <button onClick={onClose} className="w-full rounded-full bg-cocoa py-3.5 font-semibold text-cream">Вернуться к вишлисту</button>
        <button onClick={onNew} className="w-full py-2 text-sm text-cocoa-mute underline underline-offset-4">Подарить ещё</button>
      </div>
    </div>
  )
}
