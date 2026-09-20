import test from 'node:test'
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
