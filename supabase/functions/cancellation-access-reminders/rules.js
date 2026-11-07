// Regras e textos dos lembretes de fim de acesso (plano cancelado). Sem dependências, para poder ser testado.
// Lembretes: 7 dias antes, 3 dias antes e no último dia de acesso (a própria data access_until).
export const REMINDER_DAYS = { 7: 'd7', 3: 'd3', 0: 'd0' }

const parts = iso => String(iso).slice(0, 10).split('-').map(Number)

// Quantos dias faltam de fromIso até toIso (datas AAAA-MM-DD).
export function daysBetween(fromIso, toIso) {
  const [fy, fm, fd] = parts(fromIso)
  const [ty, tm, td] = parts(toIso)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

export function formatBR(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Qual lembrete enviar hoje. No dia do próprio cancelamento não envia: o e-mail de confirmação acabou de sair.
export function reminderKind(daysLeft, cancelledToday) {
  if (cancelledToday) return null
  return REMINDER_DAYS[daysLeft] || null
}

const TEXTS = {
  d7: {
    subject: 'Seu acesso ao AXIVA CRM termina em 7 dias',
    lead: date => `Seu plano do AXIVA CRM foi cancelado e você pode continuar usando o CRM normalmente até <strong>${date}</strong> (faltam 7 dias).`
  },
  d3: {
    subject: 'Seu acesso ao AXIVA CRM termina em 3 dias',
    lead: date => `Seu plano do AXIVA CRM foi cancelado e você pode continuar usando o CRM normalmente até <strong>${date}</strong> (faltam 3 dias).`
  },
  d0: {
    subject: 'Hoje é o último dia de acesso ao AXIVA CRM',
    lead: date => `Hoje, <strong>${date}</strong>, é o último dia de uso do AXIVA CRM com o plano que você cancelou.`
  }
}

const KEEP = 'Seus dados não serão apagados. Depois dessa data, o CRM fica restrito à visualização do Kanban e ao download dos seus dados comerciais.'
const BACK = 'Se quiser voltar a utilizar o AXIVA CRM, é só acessar <a href="https://axiva.com.br/crm" style="color:#00A88F">axiva.com.br/crm</a> ou escrever para <a href="mailto:contato@axiva.com.br" style="color:#00A88F">contato@axiva.com.br</a>.'

const stripTags = html => html.replace(/<a [^>]*>([^<]*)<\/a>/g, '$1').replace(/<[^>]+>/g, '')

export function buildReminderMail(kind, accessUntil) {
  const t = TEXTS[kind]
  if (!t) throw new Error(`lembrete desconhecido: ${kind}`)
  const date = formatBR(accessUntil)
  const paragraphs = ['Olá,', t.lead(date), KEEP, BACK, 'Até breve,<br>Equipe AXIVA']
  const html = `<div style="font-family:Arial,sans-serif;color:#0B192C;max-width:560px;margin:40px auto;line-height:1.5">${paragraphs.map(p => `<p>${p}</p>`).join('')}</div>`
  const text = paragraphs.map(p => stripTags(p.replace('<br>', '\n'))).join('\n\n')
  return { subject: t.subject, html, text }
}
