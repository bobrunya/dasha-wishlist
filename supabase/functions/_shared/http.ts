import { createClient } from 'npm:@supabase/supabase-js@2'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export const fail = (code: string, message: string, status = 400) => json({ error: { code, message } }, status)

/** Клиент с service role — только на сервере, никогда не уходит в браузер. */
export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

/** Ошибки из функций Postgres: message — код, hint — понятный текст по-русски. */
export function dbFail(e: { message?: string; hint?: string | null } | null) {
  const code = (e?.message ?? 'error').split(/\s/)[0]
  const hint = e?.hint || 'Что-то пошло не так. Попробуйте ещё раз чуть позже.'
  if (code === 'rate_limited') return fail(code, hint, 429)
  if (code === 'not_found') return fail(code, hint, 404)
  console.error(e)
  return fail(code, hint)
}

export async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export const clientIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || ''
