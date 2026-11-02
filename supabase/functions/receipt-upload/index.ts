import { admin, cors, dbFail, fail, json } from '../_shared/http.ts'

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
}

/** Выдаёт одноразовую ссылку для загрузки чека в приватное хранилище. */
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method', 'Method not allowed', 405)
  let b: { id?: string; token?: string; mime?: string; size?: number }
  try { b = await req.json() } catch { return fail('bad_request', 'Некорректный запрос.') }
  const ext = TYPES[b.mime ?? '']
  if (!ext) return fail('bad_file', 'Подойдёт фото (JPG, PNG, WEBP, HEIC) или PDF')
  if (!b.size || b.size > 10 * 1024 * 1024) return fail('bad_file', 'Файл больше 10 МБ — сделайте скриншот поменьше')

  const db = admin()
  const { data: c, error } = await db.rpc('donor_contribution', { p_id: b.id, p_token: b.token })
  if (error) return dbFail(error)
  const { count } = await db.from('receipts').select('id', { count: 'exact', head: true }).eq('contribution_id', c.id)
  if ((count ?? 0) >= 5) return fail('too_many', 'К этой заявке уже прикреплено 5 файлов.')

  const path = `${c.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const { data, error: e2 } = await db.storage.from('receipts').createSignedUploadUrl(path)
  if (e2) return fail('storage', 'Не удалось подготовить загрузку. Попробуйте ещё раз.', 500)
  return json({ path: data.path, token: data.token })
})
