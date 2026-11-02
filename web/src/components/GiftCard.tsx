import type { PublicGift } from '../lib/types'
import { dual, progressOf } from '../lib/money'
import { Heart } from './Decor'

const TINTS: Record<string, string> = {
  experiences: 'from-baby-soft to-baby',
  beauty: 'from-blush-soft to-blush',
  things: 'from-cream to-cream-deep',
  'small-joys': 'from-blush-soft to-baby-soft',
  learning: 'from-baby-soft to-blush-soft',
  money: 'from-cream-deep to-blush-soft',
}

export function GiftArt({ gift, className = '' }: { gift: PublicGift; className?: string }) {
  const photo = gift.images.find(i => i.kind === 'photo') ?? gift.images[0]
  if (photo) {
    return <img src={photo.url} alt={photo.alt || gift.title} loading="lazy" decoding="async" className={`object-cover ${className}`} />
  }
  return (
    <div className={`relative grid place-items-center bg-gradient-to-br ${TINTS[gift.category ?? ''] ?? TINTS.things} ${className}`} role="img" aria-label={gift.title}>
      <div className="absolute inset-5 rounded-[1.4rem] border border-white/70" />
      <span className="grid size-24 place-items-center rounded-full bg-white/75 text-5xl shadow-soft">{gift.emoji}</span>
    </div>
  )
}

export function ProgressBar({ percent, funded }: { percent: number; funded: boolean }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-cream-deep" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-700 ${funded ? 'bg-blush-deep' : 'bg-gradient-to-r from-baby-deep to-blush-deep'}`}
        style={{ width: `${Math.max(percent, percent > 0 ? 4 : 0)}%` }} />
    </div>
  )
}

export function PriceLine({ gift, rate }: { gift: PublicGift; rate: string }) {
  if (gift.kind === 'open') return <p className="font-display text-2xl font-semibold">Любая сумма</p>
  const base = gift.kind === 'quantity' ? gift.unitPriceMinor! : gift.goalMinor!
  const d = dual(base, gift.currency, rate)
  return (
    <div>
      <p className="font-display text-2xl leading-tight font-semibold">
        {d.rub}{gift.kind === 'quantity' && <span className="font-sans text-sm font-medium text-cocoa-mute"> / {gift.unitLabel}</span>}
      </p>
      <p className="text-xs text-cocoa-mute">≈ {d.idr}</p>
    </div>
  )
}

export function ProgressInfo({ gift, rate }: { gift: PublicGift; rate: string }) {
  const p = progressOf(gift)
  if (p.goal === null) {
    return gift.confirmedMinor > 0
      ? <p className="text-xs text-cocoa-soft">Уже подарено {dual(gift.confirmedMinor, gift.currency, rate).rub}</p>
      : <p className="text-xs text-cocoa-mute">{gift.kind === 'quantity' ? `От ${gift.minOrderQuantity} шт. · без ограничения` : 'Без целевой суммы'}</p>
  }
  const units = gift.kind === 'quantity' && gift.unitPriceMinor ? Math.floor(p.confirmed / gift.unitPriceMinor) : null
  return (
    <div className="space-y-1.5">
      <ProgressBar percent={p.percent!} funded={p.funded} />
      <div className="flex justify-between gap-2 text-xs text-cocoa-soft">
        <span>
          {units !== null ? `${units} из ${gift.targetQuantity}` : `Собрано ${p.percent}%`}
        </span>
        {!p.funded && <span>Осталось {dual(p.remaining!, gift.currency, rate).rub}</span>}
      </div>
    </div>
  )
}

export function GiftCard({ gift, rate, categoryTitle, onOpen, index }: {
  gift: PublicGift; rate: string; categoryTitle?: string; onOpen: () => void; index: number
}) {
  const p = progressOf(gift)
  const disabled = p.funded || !gift.isOpen
  return (
    <article
      className="group flex animate-fade-up flex-col overflow-hidden rounded-card bg-white shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift"
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
    >
      <button onClick={onOpen} className="relative block overflow-hidden text-left" aria-label={`Подробнее: ${gift.title}`}>
        <GiftArt gift={gift} className="aspect-[4/3] w-full transition duration-500 group-hover:scale-[1.03]" />
        {categoryTitle && (
          <span className="absolute top-3 left-3 rounded-full bg-white/85 px-3 py-1 text-[11px] font-semibold text-cocoa-soft backdrop-blur">{categoryTitle}</span>
        )}
        {p.funded && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-cocoa px-3 py-1 text-[11px] font-semibold text-cream">
            Подарено <Heart className="size-3 text-blush" />
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h3 className="text-[1.05rem] leading-snug font-bold">{gift.title}</h3>
          {gift.description && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-cocoa-soft">{gift.description}</p>}
        </div>
        <div className="mt-auto space-y-4">
          <PriceLine gift={gift} rate={rate} />
          <ProgressInfo gift={gift} rate={rate} />
          {gift.donorNames.length > 0 && (
            <p className="truncate text-xs text-cocoa-mute">💗 {gift.donorNames.join(', ')}</p>
          )}
          <button onClick={onOpen} disabled={disabled}
            className="w-full rounded-full bg-cocoa py-3 text-sm font-semibold text-cream transition hover:bg-cocoa-soft disabled:cursor-default disabled:bg-blush disabled:text-cocoa">
            {p.funded ? 'Подарено 💗' : !gift.isOpen ? 'Сбор приостановлен' : 'Подарить'}
          </button>
        </div>
      </div>
    </article>
  )
}
