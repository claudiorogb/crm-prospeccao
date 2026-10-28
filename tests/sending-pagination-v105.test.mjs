import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sending = app.slice(app.indexOf('function MessageSending('), app.indexOf('function CampaignWorkspace('))
const helpers = readFileSync(new URL('../src/paginated-selection.jsx', import.meta.url), 'utf8')

test('lista de envio e clientes contactados são paginadas no servidor com 20 por página', () => {
  assert.match(helpers, /export const SENDING_PAGE_SIZE = 20/)
  assert.match(helpers, /\.range\(from, to\)/)
  assert.match(sending, /fetchPage\(options => buildSendingLeadsQuery\(excludedIds, options\), pagesRef\.current\.sending\)/)
  assert.match(sending, /fetchPage\(options => buildContactedLeadsQuery\(options\), pagesRef\.current\.contacted\)/)
  assert.equal((sending.match(/<PaginationControls/g) || []).length, 2)
})

test('consultas de leads continuam restritas à empresa atual', () => {
  const builders = sending.slice(sending.indexOf('function buildSendingLeadsQuery('), sending.indexOf('function unresolvedFailedSendingLeadIds('))
  assert.equal((builders.match(/\.eq\('organization_id', organization\.id\)/g) || []).length, 2)
  assert.equal((builders.match(/\.is\('deleted_at', null\)/g) || []).length, 2)
})

test('reenvio usa a mesma função de envio e a seleção é guardada entre páginas', () => {
  assert.equal((sending.match(/functions\.invoke\('enqueue_whatsapp_messages'/g) || []).length, 1)
  assert.match(sending, /const selectedLeads = \[\.\.\.selected\.values\(\)\]/)
  assert.match(sending, /function startResend\(\)/)
  assert.match(sending, /Reenviar mensagem \(\{contactedSelected\.size\}\)/)
  assert.match(sending, /Selecionar todos desta página/)
})

test('numeração de páginas mostra primeira, última e vizinhas', async () => {
  const src = helpers.slice(helpers.indexOf('export function visiblePageNumbers'), helpers.indexOf('// Busca uma página'))
  const visiblePageNumbers = new Function(`${src.replace('export ', '')}; return visiblePageNumbers`)()
  assert.deepEqual(visiblePageNumbers(1, 3), [1, 2, 3])
  assert.deepEqual(visiblePageNumbers(5, 10), [1, 'gap-4', 4, 5, 6, 'gap-10', 10])
})
