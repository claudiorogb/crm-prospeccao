// Regras puras dos relatórios e metas.
export function monthStart(dateStr) { return `${String(dateStr).slice(0, 7)}-01` }

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const REPLIED = ['replied', 'interested', 'proposal', 'negotiation', 'won', 'lost']
const CONTACTED = ['contacted', ...REPLIED]

// Ganhos do mês: usa contract_signed_at; se vazio, a data da mudança de status.
export function wonDate(lead) {
  return String(lead.contract_signed_at || lead.status_changed_at || '').slice(0, 10)
}

export function wonInMonth(leads, month) {
  return leads.filter(l => l.status === 'won' && monthStart(wonDate(l)) === month)
}

export function progress(leads, goal) {
  const won = leads.length
  const value = leads.reduce((s, l) => s + num(l.contract_value), 0)
  const pct = (done, target) => (target > 0 ? Math.round((done / target) * 100) : null)
  return { won, value, pctCount: pct(won, num(goal?.target_won_count)), pctValue: pct(value, num(goal?.target_value)) }
}

export function bySeller(leads, month, members, goals) {
  const wonLeads = wonInMonth(leads, month)
  const rows = members.map(m => {
    const mine = wonLeads.filter(l => l.assigned_to === m.user_id)
    const goal = goals.find(g => g.user_id === m.user_id && g.period === month)
    return { user_id: m.user_id, name: m.display_name || 'Usuário', goal, ...progress(mine, goal) }
  })
  const unassigned = wonLeads.filter(l => !l.assigned_to || !members.some(m => m.user_id === l.assigned_to))
  if (unassigned.length) rows.push({ user_id: null, name: 'Sem vendedor', goal: null, ...progress(unassigned, null) })
  return rows
}

export function companyProgress(leads, month, goals) {
  const goal = goals.find(g => !g.user_id && g.period === month)
  return { goal, ...progress(wonInMonth(leads, month), goal) }
}

export function byCampaign(leads) {
  const map = new Map()
  for (const l of leads) {
    const name = l.campaigns?.name || 'Sem campanha'
    const row = map.get(name) || { name, total: 0, contacted: 0, replied: 0, won: 0 }
    row.total += 1
    if (CONTACTED.includes(l.status)) row.contacted += 1
    if (REPLIED.includes(l.status)) row.replied += 1
    if (l.status === 'won') row.won += 1
    map.set(name, row)
  }
  return [...map.values()].map(r => ({ ...r, replyRate: r.contacted > 0 ? Math.round((r.replied / r.contacted) * 100) : null })).sort((a, b) => b.total - a.total)
}

export function funnelCounts(leads) {
  const count = s => leads.filter(l => l.status === s).length
  return [['Contatados', leads.filter(l => CONTACTED.includes(l.status)).length], ['Responderam', leads.filter(l => REPLIED.includes(l.status)).length],
    ['Interessados', leads.filter(l => ['interested', 'proposal', 'negotiation', 'won'].includes(l.status)).length],
    ['Proposta', leads.filter(l => ['proposal', 'negotiation', 'won'].includes(l.status)).length], ['Ganhos', count('won')], ['Perdidos', count('lost')]]
}

export function lossBreakdown(leads, labelOf) {
  const map = new Map()
  for (const l of leads) {
    if (!['lost', 'not_interested'].includes(l.status)) continue
    const key = l.loss_reason ? labelOf(l.loss_reason) : 'Sem motivo registrado'
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

// Tempo médio (dias) entre a criação e o ganho.
export function avgDaysToWin(leads) {
  const days = leads.filter(l => l.status === 'won' && l.created_at).map(l => (new Date(wonDate(l)) - new Date(l.created_at)) / 86400000).filter(d => d >= 0)
  return days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null
}

// ---- Previsão de vendas (estimativa) ----
export const FORECAST_STAGES = [['interested', 'Interessado'], ['proposal', 'Proposta'], ['negotiation', 'Negociação']]
export const DEFAULT_PROBABILITIES = { interested: 10, proposal: 30, negotiation: 60 }

export function normalizeProbabilities(raw) {
  const out = {}
  for (const [stage] of FORECAST_STAGES) {
    const n = Number(raw?.[stage])
    out[stage] = Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_PROBABILITIES[stage]
  }
  return out
}

export function openValue(lead) {
  const reneg = num(lead.renegotiated_value)
  if (lead.status === 'negotiation' && reneg > 0) return reneg
  return num(lead.proposal_value)
}

export function forecast(leads, probabilities, members) {
  const probs = normalizeProbabilities(probabilities)
  const open = leads.filter(l => FORECAST_STAGES.some(([s]) => s === l.status))
  const weighted = l => openValue(l) * (probs[l.status] / 100)
  const sum = list => list.reduce((s, l) => s + weighted(l), 0)
  const byStage = FORECAST_STAGES.map(([stage, label]) => {
    const list = open.filter(l => l.status === stage)
    return { stage, label, count: list.length, open: list.reduce((s, l) => s + openValue(l), 0), weighted: sum(list), probability: probs[stage] }
  })
  const sellers = members.map(m => {
    const list = open.filter(l => l.assigned_to === m.user_id)
    return { user_id: m.user_id, name: m.display_name || 'Usuário', count: list.length, weighted: sum(list) }
  })
  const rest = open.filter(l => !members.some(m => m.user_id === l.assigned_to))
  if (rest.length) sellers.push({ user_id: null, name: 'Sem vendedor', count: rest.length, weighted: sum(rest) })
  return { total: sum(open), openTotal: open.reduce((s, l) => s + openValue(l), 0), count: open.length, byStage, sellers }
}
