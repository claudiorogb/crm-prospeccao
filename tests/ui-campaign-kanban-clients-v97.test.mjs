import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function section(start, end) {
  const first = app.indexOf(start)
  assert.notEqual(first, -1, `Missing section ${start}`)
  const last = app.indexOf(end, first + start.length)
  assert.notEqual(last, -1, `Missing section end ${end}`)
  return app.slice(first, last)
}

const campaign = section('function CampaignWorkspace(', 'function ManualLeadRegistration(')
const leads = section('function Leads(', 'function Clients(')
const clients = section('function Clients(', 'function Messages(')
const listing = clients.slice(clients.indexOf('<section className="client-list">'))

test('campaign navigation is exactly the requested order, keeping route keys and permission flags', () => {
  assert.match(campaign, /\['targets','Público-alvo'\],\s*\['campaigns','Campanha'\],\s*\['capture','Captação'\],\s*\['messages','Mensagens'\],\s*\['sending','Enviar Mensagens'\],\s*\['email','E-mail marketing'\],\s*\['whatsapp','WhatsApp'\]/)
  for (const key of ['targets', 'campaigns', 'capture', 'messages', 'sending', 'email', 'whatsapp']) {
    assert.match(campaign, new RegExp(`section === '${key}'`))
  }
  assert.match(campaign, /settings\?\.feature_flags\?\.capture !== false/)
  assert.match(campaign, /settings\?\.feature_flags\?\.messages !== false/)
})

test('kanban hides only zero-value cards in first four columns; preserves nonzero and other stages', () => {
  assert.match(leads, /\(!\['new', 'contacted', 'replied', 'interested'\]\.includes\(status\) \|\| currentLeadValue\(l\) !== 0\)/)
  assert.match(leads, /<strong className="kanban-value-v70">\{formatCurrency\(currentLeadValue\(l\)\)\}<\/strong>/)
  const visible = (status, value) => !['new', 'contacted', 'replied', 'interested'].includes(status) || value !== 0
  for (const status of ['new', 'contacted', 'replied', 'interested']) {
    assert.equal(visible(status, 0), false)
    assert.equal(visible(status, 25), true)
  }
  for (const status of ['proposal', 'negotiation', 'won', 'lost']) assert.equal(visible(status, 0), true)
  assert.match(leads, /const currentLeadValue|function currentLeadValue\(lead\)/)
})

test('the search icon shares the 48px input line with the two 48px selects', () => {
  assert.match(leads, /className="panel leads-toolbar"/)
  assert.match(leads, /className="search-box"><Search size=\{17\}\/><input value=\{filter\.search\}/)
  assert.match(css, /\/\* V97: lead search icon and all filters share a single 48px row\. \*\//)
  assert.match(css, /\.leads-toolbar \.search-box \{[^}]*display: flex;[^}]*align-items: center;[^}]*height: 48px;/s)
  assert.match(css, /\.leads-toolbar \.search-box input \{[^}]*height: 100%;[^}]*border: 0;/s)
  assert.match(css, /\.leads-toolbar > select \{[^}]*height: 48px;/s)
  assert.match(css, /@media \(max-width: 900px\) \{\s*\.leads-toolbar \{\s*grid-template-columns: 1fr;/)
})

test('client list omits segment but client detail keeps editable segment and identity-scoped data', () => {
  assert.doesNotMatch(listing, /client\.segment|client\.target_segments/)
  assert.match(listing, /<strong>\{client\.business_name\}<\/strong>/)
  assert.match(clients, /<label>Segmento<input value=\{clientForm\.segment \|\| ''\}/)
  assert.match(clients, /\.eq\('organization_id', organization\.id\)/)
  assert.match(clients, /<CustomerImportPanel organization=\{organization\} userId=\{userId\}/)
})

test('only the two requested client helper texts are gone', () => {
  assert.doesNotMatch(clients, /Cadastro, relacionamento e histórico comercial em um único lugar\./)
  assert.doesNotMatch(clients, /Estas anotações acompanham o mesmo registro do lead e não são perdidas na conversão para cliente\./)
  assert.match(clients, /Anotações comerciais da prospecção/)
  assert.match(clients, /<h2>Interações<\/h2>/)
})
