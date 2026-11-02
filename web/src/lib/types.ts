export type Currency = 'RUB' | 'IDR'
export type GiftKind = 'fixed' | 'quantity' | 'open'

export interface Category {
  slug: string
  title: string
}

export interface GiftImage {
  url: string
  alt: string
  kind: 'photo' | 'reference'
  credit?: string | null
}

/** Подарок в том виде, в каком его видит публичный сайт. Суммы — в минимальных единицах валюты подарка. */
export interface PublicGift {
  id: string
  slug: string
  sortOrder: number
  category: string | null
  title: string
  description: string
  publicNote: string | null
  kind: GiftKind
  currency: Currency
  goalMinor: number | null        // null — без цели
  unitPriceMinor: number | null
  unitLabel: string | null
  targetQuantity: number | null
  minOrderQuantity: number
  isOpen: boolean
  confirmedMinor: number          // подтверждено
  reservedMinor: number           // временно зарезервировано активными заявками
  donorNames: string[]            // только с согласия
  images: GiftImage[]
  emoji: string                   // для временной заглушки
}

export interface SiteSettings {
  heroImageUrl: string | null
  welcomeText: string
  telegramContact: string | null
  countdownEndsAt: string          // ISO
  acceptingContributions: boolean
  idrPerRub: string                // точное десятичное значение, например "200"
  currencies: Record<Currency, boolean>  // заполнены ли реквизиты
}

export interface ContributionDraft {
  giftId: string
  payCurrency: Currency
  payAmountMinor: number
  quantity: number | null
  donorName: string
  donorTelegram: string
  showNamePublicly: boolean
  idempotencyKey: string
}

export interface PaymentDetails {
  currency: Currency
  recipientName: string | null
  detailsText: string
  instructions: string | null
}

export type ContributionStatus =
  | 'pending_transfer' | 'awaiting_confirmation' | 'confirmed'
  | 'rejected' | 'cancelled' | 'expired'

export interface CreatedContribution {
  id: string
  publicRef: string
  cancelToken: string
  status: ContributionStatus
  expiresAt: string | null
  payCurrency: Currency
  payAmountMinor: number
  giftAmountMinor: number
  payment: PaymentDetails
}
