#!/usr/bin/env python3
"""Restore the exact pre-redesign dashboard and retain only funnel/origin visuals.

Runs in an isolated GitHub Actions checkout. No database writes or schema changes.
"""
from pathlib import Path
import subprocess

app_path = Path('src/App.jsx')
visual_path = Path('src/dashboard-visual.jsx')
css_path = Path('src/dashboard-visual.css')
test_path = Path('tests/dashboard-funnel-heading-v99.test.mjs')
app = app_path.read_text(encoding='utf-8')
prior = subprocess.check_output(['git', 'show', 'ced1270735284167dca8217a1bfbf643e47e1add:src/App.jsx'], text=True)
start = 'function Dashboard({ organization, userEmail, onGoCampaigns }) {'
end = '\n\nfunction CatalogAdmin({ userEmail }) {'
assert app.count(start) == prior.count(start) == 1
assert app.count(end) == prior.count(end) == 1
current_fn = app[app.index(start):app.index(end, app.index(start))]
assert current_fn.strip() == "function Dashboard({ organization, userEmail, onGoCampaigns }) {\n  return <DashboardVisual organization={organization} userEmail={userEmail} onGoCampaigns={onGoCampaigns} />\n}"
old_fn = prior[prior.index(start):prior.index(end, prior.index(start))]
assert old_fn.count('      <TeamPerformance organization={organization} />') == 1
assert '.rpc(\'get_dashboard_stats\', { p_organization_id: organization.id })' in old_fn
restored = old_fn.replace('      <TeamPerformance organization={organization} />', '      <DashboardVisual organization={organization} />\n\n      <TeamPerformance organization={organization} />', 1)
app = app[:app.index(start)] + restored + app[app.index(end, app.index(start)):]
assert app.count("import DashboardVisual from './dashboard-visual'") == 1

# The added panels show the entire existing commercial base, just like the historical
# counters. Imported customers are excluded as in the newer visual dashboard.
visual = r'''import React, { useEffect, useMemo, useState } from 'react'
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
'''
css = r'''.axh-insights{display:grid;grid-template-columns:1.15fr 1fr;gap:14px;margin:0 0 16px;min-width:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#0b192c}
.axh-insights *{box-sizing:border-box}
.axh-card{background:#fff;border:1px solid #dbe4ef;border-radius:16px;padding:20px 21px;min-width:0;box-shadow:0 2px 12px rgba(11,25,44,.025)}
.axh-heading{display:flex;align-items:flex-start;gap:13px;margin-bottom:21px}
.axh-heading>svg{color:#009f90;flex:0 0 auto;margin-top:2px}
.axh-heading h2{font-size:20px;line-height:1.3;font-weight:800;margin:0;color:#0b192c}
.axh-heading p{font-size:13px;color:#70819c;margin:4px 0 0}
.axh-funnel{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:9px;min-height:230px;align-items:end}
.axh-stage{height:230px;min-width:0;display:flex;flex-direction:column;gap:8px;text-align:center;align-items:stretch}
.axh-stage strong{font-size:14px;font-weight:800;line-height:1.2}
.axh-track{flex:1;min-height:0;display:flex;align-items:flex-end;border-bottom:1px solid #cedbe6}
.axh-track>div{width:100%;min-height:2px;border-radius:4px 4px 0 0}
.axh-stage span{min-height:27px;font-size:12px;line-height:1.2;color:#445671;overflow-wrap:anywhere}
.axh-origin{display:grid;grid-template-columns:minmax(110px,43%) minmax(0,1fr);gap:16px;align-items:center;min-height:230px}
.axh-donut{width:min(100%,230px);aspect-ratio:1;display:grid;place-items:center;border-radius:50%;margin:auto}
.axh-donut>div{width:59%;height:59%;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:50%;background:#fff}
.axh-donut strong{font-size:31px;line-height:1.2;font-weight:800}
.axh-donut span{font-size:13px;color:#62748f}
.axh-legend{display:grid;gap:13px;min-width:0}
.axh-legend>div{display:grid;grid-template-columns:11px minmax(0,1fr) auto;gap:9px;align-items:center;font-size:13px}
.axh-legend i{width:11px;height:11px;border-radius:50%}
.axh-legend span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#394d69}
.axh-legend strong{font-size:12px;color:#51637d;white-space:nowrap}
.axh-empty{font-size:12px;color:#697b90}
.axh-status{margin:0 0 16px;background:#edf9f6;border:1px solid #bee9df;border-radius:10px;padding:12px;color:#087e91}
.axh-error{background:#fff7f7;border-color:#f0d3d3;color:#8c2731}
@media(max-width:1050px){.axh-insights{grid-template-columns:1fr}.axh-origin{grid-template-columns:minmax(130px,38%) minmax(0,1fr)}}
@media(max-width:540px){.axh-card{padding:13px}.axh-heading{gap:9px}.axh-heading h2{font-size:17px}.axh-heading p{font-size:12px}.axh-funnel{gap:4px;min-height:160px}.axh-stage{height:160px;gap:6px}.axh-stage strong{font-size:11px}.axh-stage span{font-size:9px}.axh-origin{grid-template-columns:minmax(105px,42%) minmax(0,1fr);gap:9px;min-height:140px}.axh-donut strong{font-size:22px}.axh-legend{gap:8px}.axh-legend>div{grid-template-columns:8px minmax(0,1fr);gap:5px;font-size:11px}.axh-legend i{height:8px;width:8px}.axh-legend strong{grid-column:2;font-size:10px}}
'''
tests = r'''import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const visual = readFileSync(new URL('../src/dashboard-visual.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/dashboard-visual.css', import.meta.url), 'utf8')
const dashboard = app.slice(app.indexOf('function Dashboard({'), app.indexOf('function CatalogAdmin('))

test('restores the historical full commercial dashboard for sandbox and company users', () => {
  assert.match(app, /<Dashboard\s+organization=\{sandboxOrganization\}/)
  assert.match(app, /<Dashboard\s+organization=\{organization\}/)
  assert.match(dashboard, /\.rpc\('get_dashboard_stats', \{ p_organization_id: organization\.id \}\)/)
  for (const label of ['Negócios em andamento', 'Total em Negociação', 'Total de propostas enviadas', 'Total Interessados', 'Ganhos', 'Perdidos', 'Total de leads captados', 'Total de leads cadastrados', 'Total Leads contatados', 'Total que respondeu']) {
    assert.ok(dashboard.includes(label), `Indicador restaurado ausente: ${label}`)
  }
  assert.match(dashboard, /<TeamPerformance organization=\{organization\} \/>/)
  assert.match(dashboard, /<DashboardVisual organization=\{organization\} \/>/)
  assert.doesNotMatch(dashboard, /FUNIL ATIVO|Somente oportunidades que já chegaram a Interessado/)
})

test('only funnel and origin panels survive from the newer dashboard', () => {
  assert.match(visual, /title="Funil de vendas"/)
  assert.match(visual, /title="Origem dos leads"/)
  for (const removed of ['Campanhas / envios', 'Próximos contatos', 'Últimos leads', 'Evolução de leads', 'Ticket médio', 'Dashboard CRM', 'Todo o período']) {
    assert.ok(!visual.includes(removed), `Painel do redesign indevidamente mantido: ${removed}`)
  }
  assert.match(visual, /\['Novo', \['new', 'queued'\]\]/)
  assert.match(visual, /\['Cliente', \['won'\]\]/)
  assert.ok(css.includes('.axh-insights'))
  assert.doesNotMatch(css, /\.app-shell:has\(/)
})

test('charts only read active records of the selected company and never leak previously selected company data', () => {
  assert.match(visual, /\.eq\('organization_id', organizationId\)/)
  assert.match(visual, /\.is\('deleted_at', null\)/)
  assert.match(visual, /state\.organizationId !== organizationId/)
  assert.match(visual, /source === 'import' && lead\.status === 'won'/)
  assert.match(visual, /allRows\(/)
  assert.doesNotMatch(visual, /service_role|\.insert\(|\.update\(|\.delete\(/)
})
'''
assert "title=\"Funil de vendas\"" in visual and "title=\"Origem dos leads\"" in visual
assert '.eq(\'organization_id\', organizationId)' in visual
assert 'state.organizationId !== organizationId' in visual
assert '<DashboardVisual organization={organization} />' in app
app_path.write_text(app, encoding='utf-8')
visual_path.write_text(visual, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
test_path.write_text(tests, encoding='utf-8')
print('Restored pre-redesign dashboard exactly; retained only organization-scoped funnel and origin charts.')
