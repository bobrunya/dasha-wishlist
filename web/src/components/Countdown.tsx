import { useEffect, useState } from 'react'
import { Heart } from './Decor'

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}

const plural = (n: number, [one, few, many]: [string, string, string]) => {
  const a = n % 10, b = n % 100
  if (a === 1 && b !== 11) return one
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few
  return many
}

export function Countdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt).getTime()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (now >= end) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-5 py-3 text-sm shadow-soft">
        <Heart className="size-4 text-blush-deep" />
        Праздник случился — спасибо, что вы со мной! Вишлист продолжает работать.
      </div>
    )
  }

  const p = parts(end - now)
  const cells: [number, [string, string, string]][] = [
    [p.d, ['день', 'дня', 'дней']],
    [p.h, ['час', 'часа', 'часов']],
    [p.m, ['минута', 'минуты', 'минут']],
    [p.s, ['секунда', 'секунды', 'секунд']],
  ]
  return (
    <div aria-label="До окончания сбора">
      <p className="mb-2 text-xs uppercase tracking-[0.2em] text-cocoa-soft">До конца сбора · 30 ноября</p>
      <div className="flex gap-2 sm:gap-3">
        {cells.map(([v, words], i) => (
          <div key={i} className="min-w-16 rounded-2xl bg-white/85 px-3 py-2.5 text-center shadow-soft backdrop-blur">
            <div className="font-display text-3xl leading-none font-semibold tabular-nums">{String(v).padStart(2, '0')}</div>
            <div className="mt-1 text-[11px] text-cocoa-mute">{plural(v, words)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
