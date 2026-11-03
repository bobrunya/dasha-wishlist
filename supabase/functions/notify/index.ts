import { admin, json } from '../_shared/http.ts'

// Отправляет уведомления из notification_outbox в Telegram.
// Вызывается базой (триггер + pg_cron) с секретным заголовком; снаружи недоступна.

const SITE = Deno.env.get('SITE_URL') ?? 'https://bobrunya.github.io/dasha-wishlist/'
const FLAG: Record<string, string> = {
  new: 'notify_new', cancelled: 'notify_new', reported: 'notify_reported_paid', receipt: 'notify_receipt',
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
        text = `🎉 На «${esc(g?.title ?? '')}» собрана вся сумма!`
      } else {
        const { data: c } = await db.from('contributions').select('*, gifts(title)').eq('id', it.payload.id).single()
        if (!c) { await done(null); continue }
        const tg = String(c.donor_telegram).replace(/^@/, '')
        const name = esc(c.donor_name)
        const who = `${name} (<a href="https://t.me/${tg}">@${esc(tg)}</a>)`
        const gift = `«${esc(c.gifts?.title ?? '')}»`
        const sum = money(c.pay_amount_minor, c.pay_currency)
        const over = it.payload.kind === 'overpayment'
          ? await db.from('conflicts').select('details').eq('contribution_id', c.id).eq('kind', 'overpayment').order('created_at', { ascending: false }).limit(1).maybeSingle()
          : null
        const overBy = over?.data?.details?.over ? money(over.data.details.over, c.gift_currency) : ''
        text = {
          new: `🎁 ${who} выбрал(а) подарок ${gift} — ${sum}`,
          reported: `💸 ${who} пишет, что перевёл(а) ${sum} за ${gift}\nПроверьте банк. Если деньги пришли, нажмите «Подтвердить» в админке.`,
          cancelled: `↩️ ${who} отменил(а) выбор ${gift} — ${sum}\nСумма снова свободна для других.`,
          receipt: `📎 ${who} прислал(а) чек за ${gift} — ${sum}\nПосмотреть можно в админке.`,
          expired: `⌛ ${who} выбрал(а) ${gift}, но за ${s.reservation_hours} ч не перевёл(а) ${sum}\nСумма снова свободна для других. Можете написать ${name} в Telegram.`,
          conflict: over
            ? `⚠️ ${who} перевёл(а) за ${gift} ${overBy ? `на ${overBy} ` : ''}больше, чем оставалось собрать\nНапишите: вернуть разницу или перенести на другой подарок.`
            : `⚠️ ${who} перевёл(а) ${sum} за ${gift} уже после того, как истекло время брони\nПроверьте, не собрал ли кто-то эту сумму раньше, и решите в админке.`,
        }[it.event as string] ?? `Событие ${it.event}`
      }
      await send(token, s.telegram_chat_id, text)
      await done(null); sent++
    } catch (e) { await done(String(e)) }
  }
  return json({ sent })
})
