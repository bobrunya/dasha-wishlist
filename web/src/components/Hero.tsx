import type { SiteSettings } from '../lib/types'
import { Countdown } from './Countdown'
import { Bow, Heart, Sparkle } from './Decor'

function TelegramText({ text, contact }: { text: string; contact: string | null }) {
  const word = 'Telegram'
  const i = text.lastIndexOf(word)
  if (!contact || i < 0) return <>{text}</>
  const handle = contact.replace(/^@/, '')
  return (
    <>
      {text.slice(0, i)}
      <a href={`https://t.me/${handle}`} target="_blank" rel="noopener noreferrer"
        className="font-semibold text-cocoa underline decoration-blush-deep decoration-2 underline-offset-4 hover:decoration-cocoa">
        {word}
      </a>
      {text.slice(i + word.length)}
    </>
  )
}

export function Hero({ settings }: { settings: SiteSettings }) {
  const paragraphs = settings.welcomeText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const [lead, ...rest] = paragraphs

  return (
    <header className="relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-24 size-80 rounded-full bg-blush/60 blur-3xl" />
      <div className="pointer-events-none absolute top-40 -right-24 size-80 rounded-full bg-baby/70 blur-3xl" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pt-10 pb-12 sm:px-8 md:grid-cols-[1.1fr_0.9fr] md:pt-16 md:pb-20">
        <div className="order-2 animate-fade-up md:order-1">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 text-xs font-semibold tracking-[0.18em] text-cocoa-soft uppercase">
            <Heart className="size-3.5 text-blush-deep" /> 25 ноября 2026
          </p>
          <h1 className="font-display text-[3.1rem] leading-[0.95] font-semibold tracking-tight sm:text-7xl">
            Dasha’s <span className="italic text-cocoa-soft">Birthday</span>
            <br />Wishlist
          </h1>
          {lead && <p className="mt-6 max-w-md text-lg leading-relaxed text-cocoa-soft">{lead}</p>}
          <div className="mt-8"><Countdown endsAt={settings.countdownEndsAt} /></div>
          <a href="#catalog"
            className="mt-9 inline-flex items-center gap-2 rounded-full bg-cocoa px-7 py-3.5 text-sm font-semibold text-cream shadow-lift transition hover:-translate-y-0.5 hover:bg-cocoa-soft">
            Выбрать подарок <span aria-hidden>↓</span>
          </a>
        </div>

        <div className="relative order-1 mx-auto w-full max-w-[17rem] animate-fade-up sm:max-w-sm md:order-2">
          <Bow className="absolute -top-7 left-1/2 z-10 w-16 -translate-x-1/2 text-blush-deep" />
          <div className="rounded-t-[999px] rounded-b-[2.5rem] bg-white p-2.5 shadow-lift">
            {settings.heroImageUrl ? (
              <img src={settings.heroImageUrl} alt="Даша" width={930} height={1240}
                className="aspect-[3/4] w-full rounded-t-[999px] rounded-b-[2rem] object-cover object-[50%_25%]" />
            ) : (
              <div className="grid aspect-[3/4] w-full place-items-center rounded-t-[999px] rounded-b-[2rem] bg-blush-soft font-display text-6xl">D</div>
            )}
          </div>
          <Heart className="absolute -left-4 top-1/3 size-9 animate-float text-blush-deep" />
          <Sparkle className="absolute -right-3 top-12 size-7 animate-float text-baby-deep [animation-delay:1.5s]" />
          <Heart className="absolute -right-5 bottom-14 size-6 animate-float text-baby-deep [animation-delay:3s]" />
        </div>
      </div>

      {rest.length > 0 && (
        <section className="relative mx-auto max-w-3xl px-5 pb-6 sm:px-8">
          <div className="rounded-[2rem] border border-white bg-white/70 p-7 shadow-soft backdrop-blur sm:p-10">
            {rest.map((p, i) => (
              <p key={i} className={`leading-relaxed text-cocoa-soft ${i ? 'mt-4' : ''} ${p.startsWith('P. S.') ? 'mt-6 text-sm italic' : ''}`}>
                {i === rest.length - 1 ? <TelegramText text={p} contact={settings.telegramContact} /> : p}
              </p>
            ))}
            <p className="mt-6 font-display text-2xl italic">— Даша <Heart className="inline size-5 text-blush-deep" /></p>
          </div>
        </section>
      )}
    </header>
  )
}
