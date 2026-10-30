import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { brazilToday } from './today-page.jsx'
import { lossReasonLabel } from './loss-reasons.js'
import { monthStart, periodMonths, PERIOD_TYPES, bySeller, companyProgress, byCampaign, funnelCounts, lossBreakdown, avgDaysToWin, forecast, normalizeProbabilities, FORECAST_STAGES } from './reports-rules.js'
import './goals-page.css'

const FIELDS = 'id,status,campaign_id,assigned_to,contract_value,contract_signed_at,status_changed_at,created_at,loss_reason,proposal_value,renegotiated_value,campaigns(name)'
const BATCH = 1000
const MAX_ROWS = 20000

async function loadLeads(organizationId) {
  const rows = []
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { data, error } = await supabase.from('leads').select(FIELDS)
      .eq('organization_id', organizationId).is('deleted_at', null)
      .order('id', { ascending: true }).range(from, from + BATCH - 1)
    if (error) return { error, rows: [] }
    rows.push(...(data || []))
    if (!data || data.length < BATCH) break
  }
  return { error: null, rows }
}

const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const monthLabel = m => new Date(`${m}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
function periodLabel(type, list) {
  if (type === 'month') return monthLabel(list[0])
  const year = list[0].slice(0, 4)
  const first = Number(list[0].slice(5, 7))
  if (type === 'quarter') return `${Math.ceil(first / 3)}º trimestre de ${year}`
  if (type === 'semester') return `${first <= 6 ? 1 : 2}º semestre de ${year}`
  return `Ano de ${year}`
}

function shiftMonth(month, delta) {
  const d = new Date(`${month}T12:00:00`)
  d.setMonth(d.getMonth() + delta, 1)
  return d.toISOString().slice(0, 10)
}

function Bar({ pct }) {
  if (pct === null) return <span className="muted">sem meta</span>
  return <span className="goal-bar"><span style={{ width: `${Math.min(100, pct)}%` }} /><em>{pct}%</em></span>
}

export default function GoalsPage({ organization, userEmail, userId, canEdit }) {
  const [anchor, setAnchor] = useState(() => monthStart(brazilToday()))
  const [periodType, setPeriodType] = useState('month')
  const [leads, setLeads] = useState([])
  const [members, setMembers] = useState([])
  const [goals, setGoals] = useState([])
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [probs, setProbs] = useState(null)
  const [probDraft, setProbDraft] = useState(null)

  const load = useCallback(async () => {
    const [leadRes, memberRes, goalRes, probRes] = await Promise.all([
      loadLeads(organization.id),
      supabase.from('organization_members').select('user_id,display_name').eq('organization_id', organization.id).eq('is_active', true).is('deleted_at', null),
      supabase.from('sales_goals').select('id,user_id,period,target_won_count,target_value').eq('organization_id', organization.id),
      supabase.from('forecast_settings').select('probabilities').eq('organization_id', organization.id).maybeSingle()
    ])
    const err = leadRes.error || memberRes.error || goalRes.error || probRes.error
    if (err) { setMessage(err.message || 'Não foi possível carregar.'); return }
    setMessage(''); setLeads(leadRes.rows); setMembers(memberRes.data || []); setGoals(goalRes.data || []); setProbs(normalizeProbabilities(probRes.data?.probabilities)); setLoaded(true)
  }, [organization.id])

  useEffect(() => { setLoaded(false); load() }, [load])

  const months = useMemo(() => periodMonths(periodType, anchor), [periodType, anchor])
  const month = months[0]
  const isMonthView = periodType === 'month'
  const inPeriod = useMemo(() => {
    const set = new Set(months)
    return leads.filter(l => set.has(monthStart(String(l.created_at || '').slice(0, 10))))
  }, [leads, months])
  const company = useMemo(() => companyProgress(leads, months, goals), [leads, months, goals])
  const sellers = useMemo(() => bySeller(leads, months, members, goals), [leads, months, members, goals])
  const mineOnly = !canEdit
  const visibleSellers = mineOnly ? sellers.filter(s => s.user_id === userId) : sellers
  const campaigns = useMemo(() => byCampaign(inPeriod), [inPeriod])
  const funnel = useMemo(() => funnelCounts(inPeriod), [inPeriod])
  const losses = useMemo(() => lossBreakdown(inPeriod, lossReasonLabel), [inPeriod])
  const fc = useMemo(() => forecast(leads, probs, members), [leads, probs, members])
  const avgDays = useMemo(() => avgDaysToWin(inPeriod), [inPeriod])

  async function saveGoal(key, uid) {
    const draft = drafts[key] || {}
    const count = draft.count === '' || draft.count === undefined ? null : Math.max(0, parseInt(draft.count, 10) || 0)
    const value = draft.value === '' || draft.value === undefined ? null : Math.max(0, Number(String(draft.value).replace(/\./g, '').replace(',', '.')) || 0)
    const existing = goals.find(g => (g.user_id || null) === (uid || null) && g.period === month)
    const payload = { target_won_count: count, target_value: value, updated_at: new Date().toISOString() }
    const q = existing
      ? supabase.from('sales_goals').update(payload).eq('id', existing.id).eq('organization_id', organization.id)
      : supabase.from('sales_goals').insert({ ...payload, organization_id: organization.id, user_id: uid || null, period: month })
    const { error } = await q
    if (error) { setMessage(`Não foi possível salvar a meta: ${error.message}`); return }
    setDrafts(old => { const n = { ...old }; delete n[key]; return n })
    setMessage('Meta salva.')
    load()
  }

  async function saveProbs() {
    const next = normalizeProbabilities(probDraft)
    const { error } = await supabase.from('forecast_settings').upsert({ organization_id: organization.id, probabilities: next, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    if (error) { setMessage(`Não foi possível salvar as probabilidades: ${error.message}`); return }
    setProbDraft(null); setMessage('Probabilidades salvas.'); load()
  }

  function goalEditor(k, uid, goal) {
    const d = drafts[k] || {}
    const set = patch => setDrafts(old => ({ ...old, [k]: { ...old[k], ...patch } }))
    return (
      <span className="goal-edit">
        <input type="number" min="0" placeholder="Qtd." value={d.count ?? goal?.target_won_count ?? ''} onChange={e => set({ count: e.target.value })} aria-label="Meta de negócios ganhos" />
        <input type="text" inputMode="decimal" placeholder="Valor R$" value={d.value ?? goal?.target_value ?? ''} onChange={e => set({ value: e.target.value })} aria-label="Meta de valor" />
        <button type="button" className="secondary mini" onClick={() => saveGoal(k, uid)} disabled={!drafts[k]}>Salvar</button>
      </span>
    )
  }

  return (
    <>
      <header className="topbar"><div><h1>Metas e relatórios</h1></div><div className="topbar-actions"><div className="user-badge">{userEmail}</div></div></header>
      {message && <div className="notice">{message}</div>}
      {!loaded ? <p className="muted">Carregando…</p> : (
        <div className="goals-v1">
          <div className="goals-month">
            <div className="goals-period-tabs" role="tablist" aria-label="Período">
              {PERIOD_TYPES.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={periodType === id} className={periodType === id ? 'primary mini' : 'secondary mini'} onClick={() => setPeriodType(id)}>{label}</button>
              ))}
            </div>
            <button type="button" className="secondary mini" aria-label="Período anterior" onClick={() => setAnchor(shiftMonth(month, -months.length))}>‹</button>
            <strong>{periodLabel(periodType, months)}</strong>
            <button type="button" className="secondary mini" aria-label="Próximo período" onClick={() => setAnchor(shiftMonth(month, months.length))}>›</button>
          </div>
          {!isMonthView && <p className="muted goals-note">Nesta visão as metas são a soma das metas mensais. Para definir ou alterar uma meta, use a visão "Mês".</p>}

          {canEdit && (
            <section className="panel goals-card">
              <h2>Meta da empresa</h2>
              <div className="goals-row">
                <span>{company.won} ganho(s) • {money(company.value)}</span>
                <Bar pct={company.pctCount} /><Bar pct={company.pctValue} />
                {isMonthView && goalEditor('company', null, company.goal)}
              </div>
            </section>
          )}

          <section className="panel goals-card">
            <h2>{mineOnly ? 'Minha meta' : 'Metas por vendedor'}</h2>
            {visibleSellers.length === 0 && <p className="muted">Nenhum vendedor com negócios ou metas neste mês.</p>}
            {visibleSellers.map(s => (
              <div className="goals-row" key={s.user_id || 'none'}>
                <strong>{s.name}</strong>
                <span>{s.won} ganho(s) • {money(s.value)}</span>
                <Bar pct={s.pctCount} /><Bar pct={s.pctValue} />
                {canEdit && isMonthView && s.user_id && goalEditor(s.user_id, s.user_id, s.goal)}
              </div>
            ))}
            <p className="muted goals-note">Barras: 1ª = quantidade de negócios ganhos, 2ª = valor dos contratos. Considera a data de assinatura do contrato.</p>
          </section>

          <section className="panel goals-card">
            <h2>Previsão de vendas <small className="muted">(estimativa, negócios abertos hoje)</small></h2>
            <p><strong>{money(fc.total)}</strong> previstos • {money(fc.openTotal)} em negócios abertos ({fc.count})</p>
            <table className="goals-table"><thead><tr><th>Etapa</th><th>Negócios</th><th>Valor em aberto</th><th>Chance</th><th>Previsto</th></tr></thead>
              <tbody>{fc.byStage.map(r => <tr key={r.stage}><td>{r.label}</td><td>{r.count}</td><td>{money(r.open)}</td>
                <td>{canEdit ? <input type="number" min="0" max="100" style={{ width: 64 }} aria-label={`Chance de fechar em ${r.label}`} value={probDraft ? probDraft[r.stage] : r.probability} onChange={e => setProbDraft({ ...(probDraft || probs), [r.stage]: e.target.value })} /> : null}{canEdit ? '%' : `${r.probability}%`}</td>
                <td>{money(r.weighted)}</td></tr>)}</tbody></table>
            {canEdit && <p><button type="button" className="secondary mini" disabled={!probDraft} onClick={saveProbs}>Salvar probabilidades</button></p>}
            {(canEdit ? fc.sellers : fc.sellers.filter(x => x.user_id === userId)).map(x => <div className="goals-row" key={x.user_id || 'none'}><strong>{x.name}</strong><span>{x.count} negócio(s) • {money(x.weighted)} previstos</span></div>)}
            <p className="muted goals-note">Estimativa: valor da proposta (ou renegociado) × chance da etapa. Negócios sem valor de proposta contam como R$ 0. As chances são definidas pela sua empresa.</p>
          </section>

          <section className="panel goals-card">
            <h2>Funil do período <small className="muted">(leads captados no período)</small></h2>
            <div className="goals-funnel">{funnel.map(([label, n]) => <div key={label}><strong>{n}</strong><span>{label}</span></div>)}</div>
            {avgDays !== null && <p className="muted">Tempo médio da captação até o ganho: {avgDays} dia(s).</p>}
          </section>

          <section className="panel goals-card">
            <h2>Resposta por campanha <small className="muted">(leads captados no período)</small></h2>
            <table className="goals-table"><thead><tr><th>Campanha</th><th>Leads</th><th>Contatados</th><th>Responderam</th><th>Taxa</th><th>Ganhos</th></tr></thead>
              <tbody>{campaigns.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.total}</td><td>{c.contacted}</td><td>{c.replied}</td><td>{c.replyRate === null ? '—' : `${c.replyRate}%`}</td><td>{c.won}</td></tr>)}</tbody></table>
          </section>

          <section className="panel goals-card">
            <h2>Motivos de perda e de não interesse <small className="muted">(leads captados no período)</small></h2>
            {losses.length === 0 ? <p className="muted">Nenhum registro ainda.</p> : <ul className="goals-losses">{losses.map(([label, n]) => <li key={label}><span>{label}</span><strong>{n}</strong></li>)}</ul>}
          </section>
        </div>
      )}
    </>
  )
}
