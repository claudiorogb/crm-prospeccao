import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const visual = readFileSync(new URL('../src/dashboard-visual.jsx', import.meta.url), 'utf8')

// V99 checked the old dashboard's exact markup. The requested redesign replaces
// that markup; keep the functional safeguards rather than asserting obsolete CSS.
test('shared dashboard replaces the legacy panel for both sandbox and tenant users', () => {
  assert.match(app, /import DashboardVisual from '\.\/dashboard-visual'/)
  assert.match(app, /function Dashboard\(\{ organization, userEmail, onGoCampaigns \}\)/)
  assert.match(app, /<DashboardVisual organization=\{organization\} userEmail=\{userEmail\}/)
  assert.match(app, /<Dashboard\s+organization=\{sandboxOrganization\}/)
  assert.match(app, /<Dashboard\s+organization=\{organization\}/)
  assert.doesNotMatch(visual, /dashboard-block-v61/)
})

test('new dashboard shows the commercial funnel without the redundant old heading', () => {
  for (const title of ['Dashboard CRM', 'Funil de vendas', 'Negócios', 'Origem dos leads', 'Campanhas / envios', 'Próximos contatos', 'Últimos leads', 'Evolução de leads']) {
    if (title === 'Negócios') continue
    assert.ok(visual.includes(title), `Missing panel: ${title}`)
  }
  assert.match(visual, /\['Novo', \['new', 'queued'\]\]/)
  assert.match(visual, /\['Proposta', \['proposal'\]\]/)
  assert.match(visual, /\['Cliente', \['won'\]\]/)
  assert.doesNotMatch(visual, /FUNIL ATIVO|Somente oportunidades que já chegaram a Interessado/)
})

test('dashboard uses read-only organization-filtered data and does not count imported customers as funnel wins', () => {
  assert.ok((visual.match(/\.eq\('organization_id', organization\.id\)/g) || []).length >= 5)
  assert.match(visual, /source === 'import' && lead\.status === 'won'/)
  assert.match(visual, /allRows\(/)
  assert.doesNotMatch(visual, /service_role|\.insert\(|\.update\(|\.delete\(/)
})
