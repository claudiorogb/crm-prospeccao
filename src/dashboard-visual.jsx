import React, { useEffect, useMemo, useState } from 'react'
import { ChartNoAxesCombined, Filter } from 'lucide-react'
import { supabase } from './lib/supabase'
import './dashboard-visual.css'

const STAGES = [['Novo', ['new', 'queued']], ['Contatado', ['contacted']], ['Respondeu', ['replied']], ['Interessado', ['interested']], ['Proposta', ['proposal']], ['Negociação', ['negotiation']], ['Cliente', ['won']]]
const PALETTE = ['#087e91', '#00a88f', '#48a7de', '#8da5c1', '#775bc3', '#e6ae44', '#087e91']
const integer = value => Number(value || 0).toLocaleString('pt-BR')
const sourceName = source => ({ google: 'Google', google_places: 'Google', manual: 'Cadastro manual', import: 'Importação', referral: 'Indicação', indication: 'Indicação', website: 'Site' })[source] || (source ? String(source).replaceAll('_', ' ') : 'Não informada')

// Never display a partial total as a full result. Keep organization and RLS filtering.
async function allRows(makeQuery) {
  const rows = []
  for (let offset = 0; offset <= 5000; offset += 500) {
    const { data, error } = await makeQuery().range(offset, offset + 499)
    if (error) throw error
    if (offset === 5000 && data?.length) throw new Error('Mais de 5.000 leads. Não é possível exibir indicadores completos.')
    rows.push(...(data || []))
    if (!data || data.length < 500) return rows
  }
  return rows
}

function Panel({ title, subtitle, icon: Icon, children }) {
  return <article className="axh-card">
    <div className="axh-heading"><Icon size={27} aria-hidden="true"/><div><h2>{title}</h2><p>{subtitle}</p></div></div>
    {children}
  </article>
}

export default function DashboardVisual({ organization }) {
  const organizationId = organization?.id
  const [state, setState] = useState({ organizationId: null, loading: true, error: '', rows: [] })

  useEffect(() => {
    if (!organizationId) return undefined
    let active = true
    const load = async () => {
      setState(previous => ({ ...previous, organizationId, loading: true, error: '' }))
      try {
        const rows = await allRows(() => supabase.from('leads')
          .select('id,status,source,created_at')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }))
        if (active) setState({ organizationId, loading: false, error: '', rows })
      } catch (error) {
        if (active) setState({ organizationId, loading: false, error: `Não foi possível carregar os gráficos: ${error.message || 'erro na consulta'}`, rows: [] })
      }
    }
    load()
    const timer = setInterval(load, 60000)
    return () => { active = false; clearInterval(timer) }
  }, [organizationId])

  const leads = useMemo(() => state.rows.filter(lead => !(lead.source === 'import' && lead.status === 'won')), [state.rows])
  if (!organizationId || state.organizationId !== organizationId) return <div className="axh-status" role="status">Atualizando gráficos…</div>
  if (state.error) return <div className="axh-status axh-error" role="alert">{state.error}</div>
  if (state.loading) return <div className="axh-status" role="status">Atualizando gráficos…</div>

  const stages = STAGES.map(([name, statuses]) => ({ name, count: leads.filter(lead => statuses.includes(lead.status)).length }))
  const maxStage = Math.max(1, ...stages.map(stage => stage.count))
  const bySource = Object.entries(leads.reduce((acc, lead) => {
    const name = sourceName(lead.source)
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})).sort((a, b) => b[1] - a[1])
  const origins = bySource.slice(0, 5).map(([name, count]) => ({ name, count }))
  if (bySource.length > 5) origins.push({ name: 'Outras', count: bySource.slice(5).reduce((sum, item) => sum + item[1], 0) })
  let angle = 0
  const gradient = origins.length ? origins.map((source, index) => {
    const next = angle + 100 * source.count / leads.length
    const section = `${PALETTE[index]} ${angle}% ${next}%`
    angle = next
    return section
  }).join(', ') : '#e2e8f0 0% 100%'

  return <section className="axh-insights" aria-label="Funil de vendas e origem dos leads">
    <Panel title="Funil de vendas" subtitle="Etapa atual dos leads cadastrados" icon={Filter}>
      <div className="axh-funnel" role="img" aria-label={`Leads por etapa: ${stages.map(stage => `${stage.name} ${stage.count}`).join(', ')}`}>
        {stages.map((stage, index) => <div className="axh-stage" key={stage.name}>
          <strong>{integer(stage.count)}</strong>
          <div className="axh-track"><div style={{ height: `${Math.max(stage.count ? 10 : 2, stage.count / maxStage * 100)}%`, background: PALETTE[index] }}/></div>
          <span>{stage.name}</span>
        </div>)}
      </div>
    </Panel>
    <Panel title="Origem dos leads" subtitle="Como os leads chegaram" icon={ChartNoAxesCombined}>
      <div className="axh-origin">
        <div className="axh-donut" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label={`Total de ${integer(leads.length)} leads por origem`}><div><strong>{integer(leads.length)}</strong><span>leads</span></div></div>
        <div className="axh-legend">
          {origins.map((source, index) => <div key={source.name}><i style={{ background: PALETTE[index] }}/><span>{source.name}</span><strong>{Math.round(100 * source.count / leads.length)}% ({integer(source.count)})</strong></div>)}
          {!origins.length && <p className="axh-empty">Nenhum lead cadastrado.</p>}
        </div>
      </div>
    </Panel>
  </section>
}
