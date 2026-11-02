export function Heart({ className = '', filled = true }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        d="M12 20.5s-7.5-4.6-7.5-10C4.5 7.7 6.6 6 8.8 6c1.5 0 2.6.8 3.2 1.9C12.6 6.8 13.7 6 15.2 6c2.2 0 4.3 1.7 4.3 4.5 0 5.4-7.5 10-7.5 10z"
        fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.4} strokeLinejoin="round"
      />
    </svg>
  )
}

export function Bow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 14c-4-6-14-11-17-7s1 13 17 7z" fill="currentColor" fillOpacity=".18" />
      <path d="M24 14c4-6 14-11 17-7s-1 13-17 7z" fill="currentColor" fillOpacity=".18" />
      <circle cx="24" cy="14" r="2.6" fill="currentColor" />
      <path d="M22.5 16 17 29M25.5 16 31 29" />
    </svg>
  )
}

export function Sparkle({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M12 2c.6 4.6 2.4 7.4 7 8-4.6.6-6.4 3.4-7 8-.6-4.6-2.4-7.4-7-8 4.6-.6 6.4-3.4 7-8z" fill="currentColor" />
    </svg>
  )
}
