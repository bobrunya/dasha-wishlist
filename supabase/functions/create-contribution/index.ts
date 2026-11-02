import { admin, clientIp, cors, dbFail, fail, json, sha256 } from '../_shared/http.ts'

async function turnstileOk(token: string | undefined, ip: string) {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret) return true                      // капча ещё не настроена — пропускаем
  if (!token) return false
  const body = new FormData()
  body.append('secret', secret); body.append('response', token); if (ip) body.append('remoteip', ip)
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  return (await r.json()).success === true
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method', 'Method not allowed', 405)
  let body: { draft?: Record<string, unknown>; turnstileToken?: string }
  try { body = await req.json() } catch { return fail('bad_request', 'Некорректный запрос.') }
  if (!body.draft || typeof body.draft !== 'object') return fail('bad_request', 'Некорректный запрос.')

  const ip = clientIp(req)
  if (!(await turnstileOk(body.turnstileToken, ip)))
    return fail('captcha', 'Не получилось пройти проверку «я не робот». Обновите страницу и попробуйте ещё раз.')

  const key = await sha256(`${ip}|${Deno.env.get('SUPABASE_URL')}`)
  const { data, error } = await admin().rpc('create_contribution', { p: body.draft, p_client_key: key })
  if (error) return dbFail(error)
  return json(data)
})
