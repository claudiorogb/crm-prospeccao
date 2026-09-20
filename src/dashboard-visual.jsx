import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChartNoAxesCombined, CheckCheck, ChevronRight, Clock3, ContactRound, Filter, Mail, Megaphone, Phone, RefreshCw, Send, Tag, TrendingUp, TriangleAlert, UsersRound, Wallet } from 'lucide-react'
import { supabase } from './lib/supabase'
import './dashboard-visual.css'

const ACTIVE = new Set(['new', 'queued', 'contacted', 'replied', 'interested', 'proposal', 'negotiation'])
const CONTACTED = new Set(['contacted', 'replied', 'interested', 'proposal', 'negotiation', 'won', 'lost', 'not_interested'])
const REPLIED = new Set(['replied', 'interested', 'proposal', 'negotiation', 'won'])
const STAGES = [['Novo', ['new', 'queued']], ['Contatado', ['contacted']], ['Respondeu', ['replied']], ['Interessado', ['interested']], ['Proposta', ['proposal']], ['Negociação', ['negotiation']], ['Cliente', ['won']]]
const PALETTE = ['#087e91', '#00a88f', '#48a7de', '#8da5c1', '#775bc3', '#e6ae44']
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const integer = value => Number(value || 0).toLocaleString('pt-BR')

function todayInBrazil() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = name => parts.find(item => item.type === name)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
function shiftDay(date, change) {
  const [y, m, d] = date.split('-').map(Number)
  const result = new Date(Date.UTC(y, m - 1, d + change))
  return result.toISOString().slice(0, 10)
}
function periodDates(period, from, to) {
  const now = todayInBrazil()
  if (period === 'all') return [null, null]
  if (period === 'today') return [now, now]
  if (period === 'week') {
    const weekday = new Date(`${now}T12:00:00Z`).getUTCDay()
    return [shiftDay(now, -(weekday === 0 ? 6 : weekday - 1)), now]
  }
  if (period === 'month') return [`${now.slice(0, 7)}-01`, now]
  if (period === 'year') return [`${now.slice(0, 4)}-01-01`, now]
  return [from, to]
}
const displayDate = date => date ? new Date(`${String(date).slice(0, 10)}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'
const sourceName = source => ({ google: 'Google', google_places: 'Google', manual: 'Cadastro manual', import: 'Importação', referral: 'Indicação', indication: 'Indicação', website: 'Site' })[source] || (source ? String(source).replaceAll('_', ' ') : 'Não informada')

// Always scope every read to the organization passed by App. A capped result is an error,
// never a plausible-looking partial total. No write, admin API or service-role key is used.
async function allRows(makeQuery) {
  const rows = []
  for (let offset = 0; offset <= 5000; offset += 500) {
    const { data, error } = await makeQuery().range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 500) return rows
  }
  throw new Error('A consulta ultrapassou o limite de 5.000 registros. Reduza o período para obter indicadores completos.')
}

function Metric({ title, value, detail, icon: Icon, tone = 'green' }) {
  return <article className="axd-metric">
    <div className={`axd-metric-icon axd-${tone}`}><Icon size={22} strokeWidth={2.2}/></div>
    <div className="axd-metric-body"><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>
  </article>
}
function Panel({ title, subtitle, icon: Icon, children, action, className = '' }) {
  return <section className={`axd-panel ${className}`}>
    <div className="axd-panel-heading"><div className="axd-panel-name"><Icon size={22}/><div><h2>{title}</h2><p>{subtitle}</p></div></div>{action}</div>
    {children}
  </section>
}
function WeeklyChart({ leads }) {
  const today = todayInBrazil()
  const weekStart = shiftDay(today, -55)
  const weeks = Array.from({ length: 8 }, (_, i) => ({ start: shiftDay(weekStart, i * 7), end: shiftDay(weekStart, i * 7 + 6) }))
  const counts = weeks.map(week => leads.filter(lead => lead.created_at?.slice(0, 10) >= week.start && lead.created_at?.slice(0, 10) <= week.end).length)
  const max = Math.max(1, ...counts)
  const points = counts.map((count, index) => `${26 + index * 74},${157 - count / max * 112}`).join(' ')
  const area = `26,157 ${points} 544,157`
  return <div className="axd-chart"><svg viewBox="0 0 570 185" role="img" aria-label={`Leads por semana: ${counts.map(integer).join(', ')}`} preserveAspectRatio="xMidYMid meet">
    {[45, 82, 119, 157].map(y => <line key={y} x1="25" x2="547" y1={y} y2={y} stroke="#e5edf5" />)}
    <polygon points={area} fill="rgba(0,168,143,.09)"/>
    <polyline points={points} fill="none" stroke="#00a88f" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round"/>
    {counts.map((count, i) => <g key={i}><circle cx={26 + i * 74} cy={157 - count / max * 112} r="4.5" fill="#00a88f" stroke="#fff" strokeWidth="2"/><text x={26 + i * 74} y={148 - count / max * 112} textAnchor="middle" fontSize="12" fill="#0b192c">{count}</text></g>)}
  </svg><div className="axd-chart-labels">{weeks.map(week => <span key={week.start}>{displayDate(week.start).slice(0, 5)}</span>)}</div></div>
}

export default function DashboardVisual({ organization, userEmail, onGoCampaigns }) {
  const today = todayInBrazil()
  const [period, setPeriod] = useState('month')
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [state, setState] = useState({ loading: true, error: '', leads: [], sales: [], messages: [], upcoming: [], weekly: [], clients: 0 })
  const [refresh, setRefresh] = useState(0)
  const [showAllContacts, setShowAllContacts] = useState(false)
  const [showAllLeads, setShowAllLeads] = useState(false)
  const [weeklyRange, setWeeklyRange] = useState('8')
  const [start, end] = periodDates(period, from, to)

  useEffect(() => {
    if (!organization?.id) return undefined
    if (period !== 'all' && (!start || !end || start > end)) {
      setState(old => ({ ...old, loading: false, error: 'Informe um período válido, com data inicial anterior ou igual à final.' }))
      return undefined
    }
    let active = true
    const load = async () => {
      setState(old => ({ ...old, loading: true, error: '' }))
      try {
        const startTime = start ? `${start}T00:00:00-03:00` : null
        const endTime = end ? `${shiftDay(end, 1)}T00:00:00-03:00` : null
        const createdAtRange = query => startTime && endTime ? query.gte('created_at', startTime).lt('created_at', endTime) : query
        const saleDateRange = query => start && end ? query.gte('sale_date', start).lte('sale_date', end) : query
        const [leads, sales, messages, weekly, clientsResult, contactsResult] = await Promise.all([
          allRows(() => createdAtRange(supabase.from('leads').select('id,business_name,contact_name,city,state,status,source,created_at,next_contact_date,last_contact_date,target_segments(name)').eq('organization_id', organization.id).is('deleted_at', null)).order('created_at', { ascending: false })),
          allRows(() => saleDateRange(supabase.from('sales').select('id,amount,sale_date').eq('organization_id', organization.id).is('deleted_at', null)).order('sale_date', { ascending: false })),
          allRows(() => createdAtRange(supabase.from('outbound_messages').select('id,status,created_at').eq('organization_id', organization.id)).order('created_at', { ascending: false })),
          allRows(() => supabase.from('leads').select('id,created_at,source,status').eq('organization_id', organization.id).is('deleted_at', null).gte('created_at', `${shiftDay(todayInBrazil(), -(Number(weeklyRange) * 7 - 1))}T00:00:00-03:00`).order('created_at', { ascending: false })),
          supabase.from('leads').select('id', { head: true, count: 'exact' }).eq('organization_id', organization.id).eq('status', 'won').is('deleted_at', null),
          allRows(() => supabase.from('leads').select('id,business_name,contact_name,next_contact_date,status,last_contact_date').eq('organization_id', organization.id).is('deleted_at', null).not('next_contact_date', 'is', null).in('status', [...ACTIVE]).order('next_contact_date', { ascending: true }))
        ])
        if (clientsResult.error) throw clientsResult.error
        if (!active) return
        setState({ loading: false, error: '', leads, sales, messages, upcoming: contactsResult, weekly, clients: clientsResult.count || 0 })
      } catch (error) {
        if (active) setState(old => ({ ...old, loading: false, error: `Não foi possível carregar os indicadores: ${error.message || 'erro na consulta'}` }))
      }
    }
    load()
    const timer = setInterval(load, 60000)
    return () => { active = false; clearInterval(timer) }
  }, [organization?.id, period, start, end, refresh, weeklyRange])

  const leads = useMemo(() => state.leads.filter(lead => !(lead.source === 'import' && lead.status === 'won')), [state.leads])
  const contacted = leads.filter(lead => lead.last_contact_date || CONTACTED.has(lead.status)).length
  const responded = leads.filter(lead => REPLIED.has(lead.status)).length
  const salesTotal = state.sales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)
  const sent = state.messages.filter(message => message.status === 'sent').length
  const pending = state.messages.filter(message => ['queued', 'ready', 'pending', 'processing'].includes(message.status)).length
  const failed = state.messages.filter(message => message.status === 'failed').length
  const stages = STAGES.map(([name, statuses]) => ({ name, value: leads.filter(lead => statuses.includes(lead.status)).length }))
  const maxStage = Math.max(1, ...stages.map(stage => stage.value))
  const groupedSources = Object.entries(leads.reduce((acc, lead) => { const name = sourceName(lead.source); acc[name] = (acc[name] || 0) + 1; return acc }, {})).sort((a, b) => b[1] - a[1])
  const origins = groupedSources.slice(0, 5).map(([name, value]) => ({ name, value }))
  if (groupedSources.length > 5) origins.push({ name: 'Outras', value: groupedSources.slice(5).reduce((sum, item) => sum + item[1], 0) })
  let angle = 0
  const gradient = origins.length ? origins.map((source, index) => { const next = angle + 100 * source.value / Math.max(1, leads.length); const item = `${PALETTE[index]} ${angle}% ${next}%`; angle = next; return item }).join(',') : '#e2e8f0 0% 100%'
  const upcoming = showAllContacts ? state.upcoming.slice(0, 50) : state.upcoming.slice(0, 5)
  const recent = showAllLeads ? leads.slice(0, 25) : leads.slice(0, 5)
  const metricSet = [
    ['Leads captados', integer(leads.length), 'No período selecionado', UsersRound],
    ['Leads contatados', integer(contacted), 'No grupo de leads do período', Phone],
    ['Retornos pendentes', integer(state.upcoming.filter(item => item.next_contact_date <= today).length), 'Vencidos ou previstos para hoje', Clock3],
    ['Clientes ativos', integer(state.clients), 'Base atual da empresa', ContactRound],
    ['Vendas do período', money(salesTotal), `${state.sales.length} venda(s) registrada(s)`, Wallet],
    ['Ticket médio', money(state.sales.length ? salesTotal / state.sales.length : 0), 'Por venda registrada', Tag]
  ]

  return <div className="axd-root">
    <header className="axd-heading"><div><h1>Dashboard CRM</h1><p>Visão geral do funil de vendas e desempenho comercial.</p></div><div className="axd-heading-actions">
      <label className="axd-select"><CalendarDays size={16}/><span className="axd-sr">Período</span><select aria-label="Período do dashboard" value={period} onChange={event => setPeriod(event.target.value)}><option value="today">Hoje</option><option value="week">Esta semana</option><option value="month">Este mês</option><option value="year">Este ano</option><option value="all">Todo o período</option><option value="custom">Personalizado</option></select></label>
      <button className="axd-refresh" type="button" onClick={() => setRefresh(value => value + 1)} aria-label="Atualizar dashboard"><RefreshCw size={17}/></button>
    </div></header>
    {period === 'custom' && <div className="axd-period"><label>De<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label>Até<input type="date" value={to} onChange={event => setTo(event.target.value)}/></label></div>}
    <p className="axd-context">{organization?.name} · {period === 'all' ? 'Todo o período' : `${displayDate(start)} a ${displayDate(end)}`} · {userEmail}</p>
    {state.error && <p className="axd-error" role="alert">{state.error}</p>}
    {state.loading && <p className="axd-loading" role="status">Atualizando indicadores…</p>}
    {!state.error && <><div className="axd-metrics">{metricSet.map(([title, value, detail, icon], index) => <Metric key={title} title={title} value={value} detail={detail} icon={icon} tone={index === 2 ? 'amber' : 'green'} />)}</div>
    <div className="axd-grid axd-grid-main"><Panel title="Funil de vendas" subtitle="Etapa atual dos leads criados no período" icon={Filter}><div className="axd-funnel">{stages.map((stage, index) => <div className="axd-funnel-item" key={stage.name}><strong>{integer(stage.value)}</strong><div className="axd-funnel-track"><div style={{ height: `${Math.max(stage.value ? 10 : 2, stage.value / maxStage * 100)}%`, background: PALETTE[index % PALETTE.length] }}/></div><span>{stage.name}</span></div>)}</div></Panel>
    <Panel title="Origem dos leads" subtitle="Como os leads do período chegaram" icon={ChartNoAxesCombined}><div className="axd-origin"><div className="axd-donut" style={{ background: `conic-gradient(${gradient})` }}><div><strong>{integer(leads.length)}</strong><span>leads</span></div></div><div className="axd-origin-legend">{origins.map((source, index) => <div key={source.name}><i style={{ background: PALETTE[index] }}/><span>{source.name}</span><strong>{Math.round(100 * source.value / Math.max(1, leads.length))}% ({integer(source.value)})</strong></div>)}{!origins.length && <p className="axd-empty">Nenhum lead no período.</p>}</div></div></Panel>
    <Panel title="Campanhas / envios" subtitle="Mensagens criadas no período selecionado" icon={Send}><div className="axd-campaigns"><div><Mail size={18}/><span>Enviadas</span><strong>{integer(sent)}</strong></div><div><Clock3 size={18}/><span>Pendentes</span><strong>{integer(pending)}</strong></div><div><TriangleAlert size={18}/><span>Falhas</span><strong>{integer(failed)}</strong></div><div><TrendingUp size={18}/><span>Leads que responderam</span><strong>{contacted ? `${Math.round(100 * responded / contacted)}%` : '—'}</strong></div></div><p className="axd-footnote">A taxa de resposta considera os leads contatados; não é uma métrica de entrega por campanha.</p></Panel></div>
    <div className="axd-grid axd-grid-bottom"><Panel title="Próximos contatos" subtitle="Agenda da empresa, inclusive atrasados" icon={CalendarDays} action={<button className="axd-link" type="button" onClick={() => setShowAllContacts(value => !value)}>{showAllContacts ? 'Ver menos' : 'Ver até 50'} <ChevronRight size={15}/></button>}><div className="axd-table-wrap"><table className="axd-table"><thead><tr><th>Empresa</th><th>Contato</th><th>Data</th><th>Situação</th></tr></thead><tbody>{upcoming.map(item => <tr key={item.id}><td>{item.business_name}</td><td>{item.contact_name || '—'}</td><td>{displayDate(item.next_contact_date)}</td><td><span className={`axd-pill ${item.next_contact_date < today ? 'axd-late' : item.next_contact_date === today ? 'axd-today' : 'axd-planned'}`}>{item.next_contact_date < today ? 'Atrasado' : item.next_contact_date === today ? 'Hoje' : 'Agendado'}</span></td></tr>)}</tbody></table>{!upcoming.length && <p className="axd-empty">Não há contatos agendados.</p>}</div></Panel>
    <Panel title="Últimos leads" subtitle="Leads criados no período" icon={UsersRound} action={<button className="axd-link" type="button" onClick={() => setShowAllLeads(value => !value)}>{showAllLeads ? 'Ver menos' : 'Ver todos'} <ChevronRight size={15}/></button>}><div className="axd-table-wrap"><table className="axd-table"><thead><tr><th>Empresa</th><th>Cidade/UF</th><th>Segmento</th><th>Etapa</th></tr></thead><tbody>{recent.map(item => <tr key={item.id}><td>{item.business_name}</td><td>{[item.city, item.state].filter(Boolean).join('/') || '—'}</td><td>{item.target_segments?.name || '—'}</td><td><span className="axd-pill axd-stage">{STAGES.find(([, statuses]) => statuses.includes(item.status))?.[0] || item.status}</span></td></tr>)}</tbody></table>{!recent.length && <p className="axd-empty">Nenhum lead cadastrado no período.</p>}</div></Panel>
    <Panel title="Evolução de leads" subtitle="Captações nas últimas 8 semanas" icon={ChartNoAxesCombined}><WeeklyChart leads={state.weekly.filter(lead => !(lead.source === 'import' && lead.status === 'won'))}/></Panel></div>
    </>}
  </div>
}
