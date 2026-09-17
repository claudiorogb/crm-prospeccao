import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20260917140000_v98_imported_customers_outside_pipeline.sql', import.meta.url), 'utf8')
const leadView = app.slice(app.indexOf('function Leads('), app.indexOf('function Clients('))
const clientView = app.slice(app.indexOf('function Clients('), app.indexOf('function Messages('))
const terminal = leadView.slice(leadView.indexOf('async function loadTerminalPreview('), leadView.indexOf('async function loadAllLeads('))

const pipelineWon = lead => lead.status === 'won' && lead.source !== 'import'

test('Kanban hides imported customers from Ganho without hiding actual won leads or other statuses', () => {
  assert.match(terminal, /if \(status === 'won'\) query = query\.neq\('source', 'import'\)/)
  assert.match(terminal, /\.eq\('organization_id', organization\.id\)/)
  assert.match(terminal, /\.is\('deleted_at', null\)/)
  assert.equal(pipelineWon({status:'won',source:'import'}), false)
  assert.equal(pipelineWon({status:'won',source:'google_places'}), true)
  assert.equal(pipelineWon({status:'won',source:'manual'}), true)
  assert.equal(pipelineWon({status:'new',source:'import'}), false)
})

test('Imported customers remain in Clientes without changing their status or import authorization', () => {
  assert.match(clientView, /\.eq\('organization_id', organization\.id\)\s*\.eq\('status', 'won'\)/)
  assert.match(clientView, /Clientes conquistados no funil ou adicionados por importação aparecem aqui\./)
  const importer = readFileSync(new URL('../src/customer-import.jsx', import.meta.url), 'utf8')
  assert.match(importer, /\.eq\('organization_id', organization\.id\)\.eq\('requested_by', userId\)/)
  assert.match(migration, /source\s*=\s*'import'/)
  assert.doesNotMatch(migration, /alter table|drop policy|disable row level security|update public\.leads\s+set/i)
})

test('Existing pipeline conversion metrics exclude imported customers, but real imported sales stay in reports', () => {
  for (const fn of ['get_dashboard_stats(uuid)', 'get_seller_performance(uuid)', 'get_origin_conversion(uuid)', 'get_platform_sales_overview()', 'get_team_performance(uuid)']) {
    assert.ok(migration.includes(fn), `Missing guarded metric fix: ${fn}`)
  }
  assert.match(migration, /not \(source\s*=\s*'import' and status\s*=\s*'won'\)/)
  assert.match(migration, /and l\.source <> 'import'/)
  assert.doesNotMatch(migration, /get_sales_page|public\.sales\s+set/i)
})
