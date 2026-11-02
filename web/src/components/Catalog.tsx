import { useMemo } from 'react'
import type { Category, PublicGift } from '../lib/types'
import { budgetPriceRub, progressOf } from '../lib/money'
import { GiftCard } from './GiftCard'

export type Status = 'all' | 'open' | 'funded'
export interface Filters { q: string; category: string; budget: string; status: Status }
export const EMPTY_FILTERS: Filters = { q: '', category: 'all', budget: 'all', status: 'all' }

// Диапазоны считаются по фактической цене подарка в рублях по текущему курсу.
const BUDGETS = [
  { id: 'all', title: 'Любой бюджет', min: 0, max: Infinity },
  { id: 'b1', title: 'до 3 000 ₽', min: 0, max: 3000 },
  { id: 'b2', title: '3 000 – 7 500 ₽', min: 3000.01, max: 7500 },
  { id: 'b3', title: '7 500 – 15 000 ₽', min: 7500.01, max: 15000 },
  { id: 'b4', title: 'от 15 000 ₽', min: 15000.01, max: Infinity },
]

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition ${active ? 'bg-cocoa text-cream shadow-soft' : 'bg-white text-cocoa-soft hover:bg-blush-soft'}`}>
      {children}
    </button>
  )
}

export function Catalog({ gifts, categories, rate, filters, setFilters, onOpen }: {
  gifts: PublicGift[]; categories: Category[]; rate: string
  filters: Filters; setFilters: (f: Filters) => void; onOpen: (g: PublicGift) => void
}) {
  const catTitle = useMemo(() => Object.fromEntries(categories.map(c => [c.slug, c.title])), [categories])

  const list = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    const b = BUDGETS.find(x => x.id === filters.budget) ?? BUDGETS[0]
    return gifts
      .filter(g => filters.category === 'all' || g.category === filters.category)
      .filter(g => !q || `${g.title} ${g.description}`.toLowerCase().includes(q))
      .filter(g => {
        if (b.id === 'all') return true
        const price = budgetPriceRub(g, rate)
        return price === null || (price >= b.min && price <= b.max)
      })
      .filter(g => {
        if (filters.status === 'all') return true
        const funded = progressOf(g).funded
        return filters.status === 'funded' ? funded : !funded
      })
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [gifts, filters, rate])

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch })
  const touched = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  return (
    <section id="catalog" className="mx-auto max-w-6xl scroll-mt-4 px-5 pt-12 pb-20 sm:px-8">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-4xl font-semibold sm:text-5xl">Мои желания</h2>
          <p className="mt-1 text-sm text-cocoa-mute">{gifts.length} подарков · можно подарить целиком или скинуться вместе</p>
        </div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Поиск</span>
          <input value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Найти подарок…" type="search"
            className="w-full rounded-full border border-cream-deep bg-white px-5 py-3 text-sm outline-none transition placeholder:text-cocoa-mute focus:border-blush-deep focus:ring-4 focus:ring-blush/50" />
        </label>
      </div>

      <div className="space-y-3">
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip active={filters.category === 'all'} onClick={() => set({ category: 'all' })}>Все подарки</Chip>
          {categories.map(c => (
            <Chip key={c.slug} active={filters.category === c.slug} onClick={() => set({ category: c.slug })}>{c.title}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={filters.budget} onChange={e => set({ budget: e.target.value })} aria-label="По бюджету"
            className="rounded-full border border-cream-deep bg-white px-4 py-2 text-sm text-cocoa-soft outline-none focus:ring-4 focus:ring-blush/50">
            {BUDGETS.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
          <div className="inline-flex rounded-full bg-white p-1 text-sm">
            {([['all', 'Все'], ['open', 'Ещё не подарены'], ['funded', 'Уже подарены']] as const).map(([id, t]) => (
              <button key={id} onClick={() => set({ status: id })} aria-pressed={filters.status === id}
                className={`rounded-full px-3.5 py-1.5 transition ${filters.status === id ? 'bg-blush text-cocoa font-semibold' : 'text-cocoa-mute hover:text-cocoa'}`}>{t}</button>
            ))}
          </div>
          {touched && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="px-2 text-sm text-cocoa-mute underline underline-offset-4 hover:text-cocoa">Сбросить</button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="mt-12 rounded-card bg-white/70 p-10 text-center">
          <p className="text-4xl">🎀</p>
          <p className="mt-3 font-display text-2xl">Ничего не нашлось</p>
          <p className="mt-1 text-sm text-cocoa-mute">Попробуйте другой фильтр или сбросьте поиск.</p>
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="mt-5 rounded-full bg-cocoa px-6 py-2.5 text-sm font-semibold text-cream">Показать все</button>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((g, i) => (
            <GiftCard key={g.id} gift={g} rate={rate} index={i} categoryTitle={g.category ? catTitle[g.category] : undefined} onOpen={() => onOpen(g)} />
          ))}
        </div>
      )}
    </section>
  )
}

export function CatalogSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-5 pt-12 sm:grid-cols-2 sm:px-8 lg:grid-cols-3" aria-label="Загрузка">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-card bg-white shadow-soft">
          <div className="skeleton aspect-[4/3]" />
          <div className="space-y-3 p-5">
            <div className="skeleton h-4 w-3/4 rounded-full" />
            <div className="skeleton h-3 w-full rounded-full" />
            <div className="skeleton h-8 w-1/3 rounded-full" />
            <div className="skeleton h-10 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
