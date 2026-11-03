import { admin, json } from '../_shared/http.ts'

// Отправляет уведомления из notification_outbox в Telegram.
// Вызывается базой (триггер + pg_cron) с секретным заголовком; снаружи недоступна.

const SITE = Deno.env.get('SITE_URL') ?? 'https://bobrunya.github.io/dasha-wishlist/'
const FLAG: Record<string, string> = {
  new: 'notify_new', reported: 'notify_reported_paid', receipt: 'notify_receipt',
  expired: 'notify_expired', funded: 'notify_fully_funded', conflict: 'notify_conflict',
}

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
const nf = new Intl.NumberFormat('ru-RU')
const money = (m: number, cur: string) => cur === 'RUB' ? `${nf.format(m / 100)} ₽` : `${nf.format(m)} IDR`

async function send(token: string, chat: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть админку', url: `${SITE}?admin` }]] } }),
  })
  if (!r.ok) throw new Error(`telegram ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

Deno.serve(async req => {
  const secret = Deno.env.get('NOTIFY_SECRET')
  if (!secret || req.headers.get('x-notify-secret') !== secret) return json({ error: 'forbidden' }, 403)
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const db = admin()
  const { data: s } = await db.from('admin_settings').select('*').limit(1).single()
  const { data: items } = await db.from('notification_outbox').select('*').is('sent_at', null).lt('attempts', 5).order('id').limit(25)
  let sent = 0
  for (const it of items ?? []) {
    const done = (err: string | null) => db.from('notification_outbox')
      .update(err ? { attempts: it.attempts + 1, last_error: err } : { sent_at: new Date().toISOString(), last_error: null }).eq('id', it.id)
    if (!token || !s?.telegram_chat_id || !s[FLAG[it.event]]) { await done(null); continue }   // выключено — просто отмечаем
    try {
      let text = ''
      if (it.event === 'funded') {
        const { data: g } = await db.from('gifts').select('title').eq('id', it.payload.gift).single()
        text = `🎉 <b>Подарок собран!</b>\n${esc(g?.title ?? '')}`
      } else {
        const { data: c } = await db.from('contributions').select('*, gifts(title)').eq('id', it.payload.id).single()
        if (!c) { await done(null); continue }
        const who = `${esc(c.donor_name)} (${esc(c.donor_telegram)})`
        const what = `${esc(c.gifts?.title ?? '')}\n${money(c.pay_amount_minor, c.pay_currency)}`
        text = {
          new: `🆕 <b>Новая заявка</b> № ${c.public_ref}\n${what}\nОт: ${who}\nЖдём перевод.`,
          reported: `💸 <b>Гость сообщил о переводе</b> № ${c.public_ref}\n${what}\nОт: ${who}\nПроверьте поступление и подтвердите.`,
          receipt: `📎 <b>Загружен чек</b> № ${c.public_ref}\n${what}\nОт: ${who}`,
          expired: `⌛ <b>Бронь истекла</b> № ${c.public_ref}\n${what}\nОт: ${who}`,
          conflict: `⚠️ <b>${it.payload.kind === 'overpayment' ? 'Переплата' : 'Перевод после окончания брони'}</b> № ${c.public_ref}\n${what}\nОт: ${who}\nНужно решить вручную.`,
        }[it.event as string] ?? `Событие ${it.event}`
      }
      await send(token, s.telegram_chat_id, text)
      await done(null); sent++
    } catch (e) { await done(String(e)) }
  }
  return json({ sent })
})
