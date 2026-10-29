import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react'
import { supabase } from './lib/supabase'
import { ACTIVE_STATUSES, addDays, buildToday, daysBetween } from './today-rules'
import DuplicatesTab, { loadDuplicateGroups } from './duplicates-tab.jsx'
import './today-page.css'

const LEAD_FIELDS = 'id,business_name,contact_name,phone,whatsapp_phone,status,next_contact_date,last_contact_date,last_contacted_at,proposal_sent_at,status_changed_at,updated_at,created_at,assigned_to,city,state,target_segments(name),campaigns(name)'
const BATCH = 1000
const MAX_ROWS = 10000

export const STATUS_NAMES = {
  new: 'Novo', qualified: 'Qualificado', queued: 'Na fila', contacted: 'Contatado',
  replied: 'Respondeu', interested: 'Interessado', proposal: 'Proposta', negotiation: 'Negociação'
}

export function brazilToday() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = type => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Carrega os leads em andamento da empresa (somente leitura, sempre filtrando pela empresa).
export async function loadTodayLeads(organizationId) {
  const rows = []
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { data, error } = await supabase
      .from('leads')
      .select(LEAD_FIELDS)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .in('status', ACTIVE_STATUSES)
      .order('id', { ascending: true })
      .range(from, from + BATCH - 1)
    if (error) return { error, rows: [] }
    rows.push(...(data || []))
    if (!data || data.length < BATCH) break
  }
  return { error: null, rows }
}

function formatDate(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '—'
}

const TABS = [
  { id: 'attention', label: 'Alertas de risco', icon: AlertTriangle },
  { id: 'overdue', label: 'Atrasados', icon: CalendarDays },
  { id: 'today', label: 'Hoje', icon: CalendarDays },
  { id: 'upcoming', label: 'Próximos 7 dias', icon: CalendarDays },
  { id: 'duplicates', label: 'Duplicados', icon: CalendarDays }
]

export default function TodayPage({ organization, userEmail, onOpenLead, userId }) {
  const [leads, setLeads] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState(null)
  const [onlyMine, setOnlyMine] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dupGroups, setDupGroups] = useState([])
  const today = brazilToday()

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const { error, rows } = await loadTodayLeads(organization.id)
    if (error) setMessage(error.message || 'Não foi possível carregar os dados.')
    else { setMessage(''); setLeads(rows); setLoaded(true) }
    setRefreshing(false)
  }, [organization.id])

  const refreshDuplicates = useCallback(async () => {
    const { error, groups } = await loadDuplicateGroups(organization.id)
    if (!error) setDupGroups(groups)
  }, [organization.id])

  useEffect(() => { refreshDuplicates() }, [refreshDuplicates])

  useEffect(() => {
    setLoaded(false)
    refresh()
    const timer = setInterval(refresh, 30000)
    return () => clearInterval(timer)
  }, [refresh])

  const hasMine = Boolean(userId) && leads.some(lead => lead.assigned_to === userId)
  const scoped = useMemo(() => (onlyMine && userId ? leads.filter(lead => lead.assigned_to === userId) : leads), [leads, onlyMine, userId])
  const data = useMemo(() => buildToday(scoped, today), [scoped, today])

  const counts = { attention: data.risks.length, overdue: data.overdue.length, today: data.dueToday.length, upcoming: data.upcoming.length, duplicates: dupGroups.length }
  // Abre na primeira aba que tem algo; o usuário pode trocar depois.
  const activeTab = tab || (TABS.find(item => counts[item.id] > 0)?.id ?? 'overdue')

  async function updateLead(lead, patch, okMessage) {
    setBusyId(lead.id)
    const { error } = await supabase
      .from('leads')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('organization_id', organization.id)
    setBusyId(null)
    if (error) { setMessage(error.message || 'Não foi possível salvar.'); return }
    setMessage(okMessage)
    await refresh()
  }

  const markDone = lead => updateLead(lead, { last_contact_date: today }, `Contato com ${lead.business_name} registrado hoje.`)
  const reschedule = (lead, days) => {
    if (!days) return
    updateLead(lead, { next_contact_date: addDays(today, Number(days)) }, `Retorno de ${lead.business_name} reagendado.`)
  }

  const renderActions = (lead, showDone = true) => {
    return (
      <div className="today-actions-v111">
        {showDone && (
          <button type="button" className="secondary inline-btn" disabled={busyId === lead.id} onClick={() => markDone(lead)}>
            <CheckCircle2 size={15} /> Contatei hoje
          </button>
        )}
        <select
          aria-label={`Reagendar retorno de ${lead.business_name}`}
          disabled={busyId === lead.id}
          value=""
          onChange={event => reschedule(lead, event.target.value)}
        >
          <option value="">Reagendar…</option>
          <option value="1">Amanhã</option>
          <option value="3">Em 3 dias</option>
          <option value="7">Em 7 dias</option>
          <option value="15">Em 15 dias</option>
        </select>
        <button type="button" className="primary inline-btn" onClick={() => onOpenLead(lead)}>Abrir lead <ChevronRight size={15} /></button>
      </div>
    )
  }

  const renderIdentity = lead => {
    return (
      <div className="today-identity-v111">
        <strong>{lead.business_name}</strong>
        <span>{[lead.campaigns?.name || lead.target_segments?.name, lead.contact_name, lead.whatsapp_phone || lead.phone].filter(Boolean).join(' • ') || 'Sem detalhes'}</span>
      </div>
    )
  }

  let body
  if (!loaded) {
    body = <p className="muted today-empty-v111">Carregando…</p>
  } else if (activeTab === 'duplicates') {
    body = <DuplicatesTab groups={dupGroups} onOpenLead={onOpenLead} />
  } else if (activeTab === 'attention') {
    body = data.risks.length === 0
      ? <Empty title="Nenhum alerta de risco" text="Leads em andamento sem retorno aparecem aqui quando passam do prazo da etapa." />
      : data.risks.map(({ lead, alert }) => (
        <article className={`today-row-v111 severity-${alert.severity}`} key={lead.id}>
          {renderIdentity(lead)}
          <div className="today-why-v111">
            <span className="today-stage-v111">{STATUS_NAMES[lead.status] || lead.status}</span>
            <strong>{alert.detail}</strong>
          </div>
          {renderActions(lead, true)}
        </article>
      ))
  } else {
    const list = { overdue: data.overdue, today: data.dueToday, upcoming: data.upcoming }[activeTab] || []
    body = list.length === 0
      ? <Empty
          title={{ overdue: 'Nenhum retorno atrasado', today: 'Nada previsto para hoje', upcoming: 'Nada previsto para os próximos 7 dias' }[activeTab]}
          text="O próximo contato é definido em cada lead. Quando houver data, ele aparece aqui."
        />
      : list.map(lead => (
        <article className={`today-row-v111${activeTab === 'overdue' ? ' severity-high' : ''}`} key={lead.id}>
          {renderIdentity(lead)}
          <div className="today-why-v111">
            <span className="today-stage-v111">{STATUS_NAMES[lead.status] || lead.status}</span>
            <strong>
              {activeTab === 'overdue'
                ? `Retorno previsto ${formatDate(lead.next_contact_date)} (${daysBetween(lead.next_contact_date, today)} dia(s) de atraso)`
                : `Retorno previsto ${formatDate(lead.next_contact_date)}`}
            </strong>
          </div>
          {renderActions(lead, activeTab !== 'upcoming')}
        </article>
      ))
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">ACOMPANHAMENTO</span>
          <h1>Hoje</h1>
          <p className="muted">O que precisa da sua atenção agora. Esta tela não retira nenhum lead do funil.</p>
        </div>
        <div className="topbar-actions">
          {hasMine && (
            <label className="today-mine-v111">
              <input type="checkbox" checked={onlyMine} onChange={event => setOnlyMine(event.target.checked)} /> Só meus leads
            </label>
          )}
          <button type="button" className="secondary inline-btn" onClick={() => { refresh(); refreshDuplicates() }} disabled={refreshing}>
            <RefreshCw size={16} /> {refreshing ? 'Atualizando...' : 'Atualizar'}
          </button>
          <div className="user-badge">{userEmail}</div>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      <div className="today-tabs-v111" role="tablist" aria-label="Acompanhamento">
        {TABS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeTab === item.id}
            className={`today-tab-v111${activeTab === item.id ? ' active' : ''}${item.id === 'attention' && counts.attention > 0 ? ' warn' : ''}${item.id === 'overdue' && counts.overdue > 0 ? ' warn' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <strong>{counts[item.id]}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <section className="panel today-list-v111" role="tabpanel">
        {body}
      </section>
    </>
  )
}

function Empty({ title, text }) {
  return (
    <div className="today-empty-v111">
      <CheckCircle2 size={30} />
      <h2>{title}</h2>
      <p className="muted">{text}</p>
    </div>
  )
}
