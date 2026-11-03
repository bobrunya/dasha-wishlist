import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const SB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** Один общий клиент. Работает с публичным ключом; права определяются RLS в базе. */
export const sb: SupabaseClient | null = SB_URL && SB_KEY
  ? createClient(SB_URL, SB_KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } })
  : null

export const mediaUrl = (path: string) => `${SB_URL}/storage/v1/object/public/public-media/${path}`
