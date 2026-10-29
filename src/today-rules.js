// Regras da tela "Hoje": alertas de risco e agenda de retornos.
// Funções puras (sem acesso ao banco), para poderem ser testadas e reaproveitadas.

export const ACTIVE_STATUSES = ['new', 'qualified', 'queued', 'contacted', 'replied', 'interested', 'proposal', 'negotiation']
const CLOSED_STATUSES = ['won', 'lost', 'not_interested', 'discarded']

// Dias parado a partir dos quais cada etapa gera um alerta.
export const RISK_RULES = {
  replied: { days: 3, label: 'Respondeu e está sem retorno' },
  interested: { days: 5, label: 'Interessado e parado' },
  proposal: { days: 7, label: 'Proposta sem retorno' },
  negotiation: { days: 5, label: 'Negociação sem contato recente' }
}

const DAY_MS = 86400000

function dateOnly(value) {
  if (!value) return null
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

export function daysBetween(fromDate, toDate) {
  const a = dateOnly(fromDate)
  const b = dateOnly(toDate)
  if (!a || !b) return null
  return Math.floor((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / DAY_MS)
}

export function addDays(dateValue, days) {
  const base = dateOnly(dateValue)
  if (!base) return null
  const d = new Date(`${base}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Datas em horário de Brasília (as colunas timestamp vêm em UTC).
export function brazilDateOf(timestamp) {
  if (!timestamp) return null
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = type => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Última vez que alguém mexeu no lead: o mais recente entre entrada na etapa,
// último contato registrado, último envio e envio da proposta.
export function lastTouchDate(lead) {
  const candidates = [
    brazilDateOf(lead?.status_changed_at),
    brazilDateOf(lead?.last_contacted_at),
    dateOnly(lead?.last_contact_date),
    dateOnly(lead?.proposal_sent_at)
  ].filter(Boolean)
  if (!candidates.length) return brazilDateOf(lead?.updated_at) || brazilDateOf(lead?.created_at)
  return candidates.sort().at(-1)
}

export function isOpenLead(lead) {
  return Boolean(lead) && !CLOSED_STATUSES.includes(lead.status)
}

// Mesma regra já usada em "Retornos atrasados": o retorno só conta como atrasado
// se o lead não foi contatado depois da data prevista.
export function isOverdue(lead, today) {
  if (!isOpenLead(lead) || !lead.next_contact_date) return false
  if (lead.next_contact_date >= today) return false
  if (lead.last_contact_date && lead.last_contact_date >= lead.next_contact_date) return false
  return true
}

export function isDueToday(lead, today) {
  return isOpenLead(lead) && lead.next_contact_date === today
}

export function isUpcoming(lead, today, windowDays = 7) {
  if (!isOpenLead(lead) || !lead.next_contact_date) return false
  return lead.next_contact_date > today && lead.next_contact_date <= addDays(today, windowDays)
}

// Alerta de risco: etapa com regra, parada há N dias ou mais e SEM retorno agendado
// para o futuro (se alguém já marcou o próximo contato, o lead está sendo acompanhado).
export function riskAlert(lead, today) {
  if (!isOpenLead(lead)) return null
  const rule = RISK_RULES[lead.status]
  if (!rule) return null
  if (lead.next_contact_date && lead.next_contact_date >= today) return null
  const touch = lastTouchDate(lead)
  const stalled = daysBetween(touch, today)
  if (stalled === null || stalled < rule.days) return null
  return {
    leadId: lead.id,
    status: lead.status,
    label: rule.label,
    days: stalled,
    severity: stalled >= rule.days * 2 ? 'high' : 'medium',
    detail: `${rule.label} há ${stalled} dia${stalled === 1 ? '' : 's'}`
  }
}

export function buildToday(leads, today) {
  const overdue = []
  const dueToday = []
  const upcoming = []
  const risks = []
  for (const lead of leads || []) {
    if (isOverdue(lead, today)) overdue.push(lead)
    else if (isDueToday(lead, today)) dueToday.push(lead)
    else if (isUpcoming(lead, today)) upcoming.push(lead)
    const alert = riskAlert(lead, today)
    if (alert) risks.push({ lead, alert })
  }
  const byNextContact = (a, b) => String(a.next_contact_date).localeCompare(String(b.next_contact_date))
  overdue.sort(byNextContact)
  dueToday.sort((a, b) => String(a.business_name).localeCompare(String(b.business_name), 'pt-BR'))
  upcoming.sort(byNextContact)
  // Mais graves e mais antigos primeiro.
  risks.sort((a, b) => (b.alert.severity === 'high') - (a.alert.severity === 'high') || b.alert.days - a.alert.days)
  const attentionIds = new Set([...overdue.map(l => l.id), ...risks.map(r => r.lead.id)])
  return { overdue, dueToday, upcoming, risks, attentionCount: attentionIds.size }
}
