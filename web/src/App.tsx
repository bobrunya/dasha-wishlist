import { useCallback, useEffect, useState } from 'react'
import type { PublicGift, SiteSettings } from './lib/types'
import { api } from './data/api'
import { CATEGORIES } from './data/catalog'
import { Hero } from './components/Hero'
import { Catalog, CatalogSkeleton, EMPTY_FILTERS, type Filters } from './components/Catalog'
import { GiftSheet } from './components/GiftSheet'
import { Heart } from './components/Decor'

function readFilters(): Filters {
  try { return { ...EMPTY_FILTERS, ...JSON.parse(sessionStorage.getItem('wishlist:filters') ?? '{}') } } catch { return EMPTY_FILTERS }
}

export default function App() {
  const [data, setData] = useState<{ gifts: PublicGift[]; settings: SiteSettings } | null>(null)
  const [error, setError] = useState(false)
  const [filters, setFiltersState] = useState<Filters>(readFilters)
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(location.search).get('gift'))

  const load = useCallback(async () => {
    setError(false)
    try { setData(await api.loadCatalog()) } catch { setError(true) }
  }, [])
  useEffect(() => { load() }, [load])

  const setFilters = (f: Filters) => {
    setFiltersState(f)
    try { sessionStorage.setItem('wishlist:filters', JSON.stringify(f)) } catch { /* ignore */ }
  }
  const open = (id: string | null) => {
    setOpenId(id)
    try {
      const url = new URL(location.href)
      id ? url.searchParams.set('gift', id) : url.searchParams.delete('gift')
      history.replaceState(null, '', url)
    } catch { /* в песочнице адрес не меняем */ }
  }

  const gift = data && openId ? data.gifts.find(g => g.id === openId || g.slug === openId) : null

  return (
    <div className="min-h-dvh">
      {api.mode === 'preview' && (
        <div className="bg-cocoa px-4 py-2 text-center text-xs text-cream">
          Режим предпросмотра · заявки пока не сохраняются
        </div>
      )}

      {data ? <Hero settings={data.settings} /> : <HeroSkeleton />}

      {error ? (
        <div className="mx-auto max-w-md px-5 py-16 text-center">
          <p className="text-4xl">🎀</p>
          <p className="mt-3 font-display text-2xl">Не получилось загрузить подарки</p>
          <p className="mt-1 text-sm text-cocoa-mute">Проверьте интернет и попробуйте ещё раз.</p>
          <button onClick={load} className="mt-5 rounded-full bg-cocoa px-6 py-2.5 text-sm font-semibold text-cream">Обновить</button>
        </div>
      ) : data ? (
        <Catalog gifts={data.gifts} categories={CATEGORIES} rate={data.settings.idrPerRub}
          filters={filters} setFilters={setFilters} onOpen={g => open(g.slug)} />
      ) : <CatalogSkeleton />}

      <footer className="border-t border-cream-deep px-5 py-10 text-center text-sm text-cocoa-mute">
        <Heart className="mx-auto mb-2 size-5 text-blush-deep" />
        Сделано с любовью и немного с AI · Бали, 2026
      </footer>

      {gift && data && (
        <GiftSheet key={gift.id} gift={gift} settings={data.settings} onClose={() => open(null)} onChanged={load} />
      )}
    </div>
  )
}

function HeroSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 pt-12 pb-12 sm:px-8 md:grid-cols-2">
      <div className="space-y-4">
        <div className="skeleton h-6 w-40 rounded-full" />
        <div className="skeleton h-28 w-full rounded-3xl" />
        <div className="skeleton h-16 w-80 rounded-2xl" />
      </div>
      <div className="skeleton mx-auto aspect-[3/4] w-72 rounded-t-full rounded-b-[2.5rem]" />
    </div>
  )
}
