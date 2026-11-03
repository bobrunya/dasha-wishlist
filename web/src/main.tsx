import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/cormorant-garamond/latin-500.css'
import '@fontsource/cormorant-garamond/latin-600.css'
import '@fontsource/cormorant-garamond/latin-600-italic.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/cormorant-garamond/cyrillic-500.css'
import '@fontsource/cormorant-garamond/cyrillic-600.css'
import '@fontsource/cormorant-garamond/cyrillic-600-italic.css'
import '@fontsource/manrope/cyrillic-400.css'
import '@fontsource/manrope/cyrillic-500.css'
import '@fontsource/manrope/cyrillic-600.css'
import '@fontsource/manrope/cyrillic-700.css'
import './index.css'
import App from './App.tsx'

// При обновлении страницы всегда начинаем сверху, а не там, где были раньше.
try { history.scrollRestoration = 'manual' } catch { /* старые браузеры */ }
window.scrollTo(0, 0)

const Admin = lazy(() => import('./admin/Admin'))
const isAdmin = new URLSearchParams(location.search).has('admin')
if (isAdmin) document.title = 'Админка · Dasha’s Wishlist'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <Suspense fallback={null}><Admin /></Suspense> : <App />}
  </StrictMode>,
)
