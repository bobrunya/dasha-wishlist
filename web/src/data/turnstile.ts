// Невидимая капча Cloudflare Turnstile. Включается, когда задан VITE_TURNSTILE_SITE_KEY.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

type Turnstile = {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  execute(id: string): void
  reset(id: string): void
  remove(id: string): void
}
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<Turnstile> | null = null
function load(): Promise<Turnstile> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
    s.onerror = () => { loading = null; reject(new Error('turnstile')) }
    document.head.appendChild(s)
  })
  return loading
}

export async function getTurnstileToken(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined
  const ts = await load()
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:100'
  document.body.appendChild(box)
  try {
    let timer = 0
    return await new Promise<string>((resolve, reject) => {
      const id = ts.render(box, {
        sitekey: SITE_KEY, appearance: 'interaction-only', language: 'ru',
        callback: (t: string) => { clearTimeout(timer); resolve(t) },
        'error-callback': () => reject(new Error('captcha')),
      })
      timer = window.setTimeout(() => { ts.remove(id); reject(new Error('captcha')) }, 60_000)
    })
  } finally { box.remove() }
}
