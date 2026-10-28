// Roda a função whatsapp-inbound-webhook de verdade, com um Supabase falso em memória,
// para conferir o desempate entre leads com o mesmo número.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

const fnPath = new URL('../supabase/functions/whatsapp-inbound-webhook/index.ts', import.meta.url).pathname
const fake = new URL('./fixtures/fake-supabase-admin.mjs', import.meta.url).pathname
const ORG = 'org-1', OTHER = 'org-2', TOKEN = 'token-de-teste'
const PHONE = '11999990001' // normalizePhone → 5511999990001

function freshDb() {
  return {
    system_runtime_secrets: [{ name: 'whatsapp_inbound_webhook', secret_hash: createHash('sha256').update(TOKEN).digest('hex') }],
    whatsapp_numbers: [
      { id: 'wa1', organization_id: ORG, evolution_instance_name: 'inst-org1', is_active: true, deleted_at: null },
      { id: 'wa2', organization_id: OTHER, evolution_instance_name: 'inst-org2', is_active: true, deleted_at: null }
    ],
    leads: [], outbound_messages: [], whatsapp_inbound_events: [], whatsapp_messages: [],
    whatsapp_conversations: [], activities: []
  }
}
const lead = (id, extra = {}) => ({ id, organization_id: ORG, status: 'contacted_pending', phone: null, whatsapp_phone: null, campaign_id: 'c1', deleted_at: null, last_contact_date: '2026-10-01', ...extra })
const sent = (leadId, sentAt, extra = {}) => ({ id: `m-${leadId}-${sentAt}`, organization_id: ORG, lead_id: leadId, status: 'sent', sent_at: sentAt, ...extra })

const out = await build({
  entryPoints: [fnPath], bundle: true, format: 'esm', write: false, platform: 'neutral',
  plugins: [{ name: 'alias', setup(b) {
    b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: fake }))
    b.onResolve({ filter: /^jsr:/ }, () => ({ path: 'empty', namespace: 'empty' }))
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }))
  } }]
})
let handler
globalThis.Deno = { serve: h => { handler = h }, env: { get: k => ({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] } }
globalThis.__fakeDb = freshDb()
await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

async function reply({ leads = [], messages = [], text = 'Oi, tenho interesse sim', instance = 'inst-org1' }) {
  const db = freshDb()
  db.leads = leads; db.outbound_messages = messages
  for (const k of Object.keys(globalThis.__fakeDb)) delete globalThis.__fakeDb[k]
  Object.assign(globalThis.__fakeDb, db)
  const payload = {
    event: 'messages.upsert', instance,
    data: { key: { remoteJid: `55${PHONE}@s.whatsapp.net`, fromMe: false, id: `MSG-${Math.random()}` }, message: { conversation: text }, messageTimestamp: 1761650000 }
  }
  const res = await handler(new Request(`http://x/?token=${TOKEN}`, { method: 'POST', body: JSON.stringify(payload) }))
  const json = await res.json()
  const event = globalThis.__fakeDb.whatsapp_inbound_events[0]
  return { status: res.status, json, db: globalThis.__fakeDb, event, lead: id => globalThis.__fakeDb.leads.find(l => l.id === id) }
}

test('desempate: vence o lead que recebeu o envio mais recente do CRM', async () => {
  const r = await reply({
    leads: [lead('A', { phone: PHONE }), lead('B', { whatsapp_phone: `+55 (11) 99999-0001` }), lead('C', { phone: '11888880000' })],
    messages: [sent('A', '2026-10-20T10:00:00Z'), sent('B', '2026-10-25T10:00:00Z'), sent('A', '2026-10-27T09:00:00Z', { status: 'failed' }), sent('C', '2026-10-28T10:00:00Z')]
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.classification, 'human')
  assert.equal(r.json.lead_id, 'B')
  assert.equal(r.json.tie_break, 'latest_crm_message')
  assert.equal(r.event.lead_id, 'B')
  assert.equal(r.event.classification, 'human')
  assert.equal(r.db.activities.length, 1)
  assert.equal(r.db.activities[0].lead_id, 'B')
  assert.equal(r.db.activities[0].activity_type, 'reply_received')
  assert.equal(r.lead('B').status, 'replied')
  assert.equal(r.lead('B').last_contact_date, '2025-10-28')
  assert.equal(r.lead('A').status, 'contacted_pending', 'o outro candidato não é alterado')
  assert.equal(r.lead('A').last_contact_date, '2026-10-01')
})

test('desempate com resposta automática: registra no vencedor mas não altera o funil', async () => {
  const r = await reply({
    text: 'Esta é uma mensagem automática. Retornaremos em breve.',
    leads: [lead('A', { phone: PHONE }), lead('B', { phone: PHONE })],
    messages: [sent('A', '2026-10-26T10:00:00Z'), sent('B', '2026-10-20T10:00:00Z')]
  })
  assert.equal(r.json.classification, 'automatic')
  assert.equal(r.event.lead_id, 'A')
  assert.equal(r.db.activities[0].activity_type, 'auto_reply_received')
  assert.equal(r.lead('A').status, 'contacted_pending')
  assert.equal(r.lead('A').last_contact_date, '2026-10-01')
})

test('empate real (mesmo sent_at) continua ambíguo e não altera nenhum lead', async () => {
  const r = await reply({
    leads: [lead('A', { phone: PHONE }), lead('B', { phone: PHONE })],
    messages: [sent('A', '2026-10-25T10:00:00Z'), sent('B', '2026-10-25T10:00:00Z'), sent('A', '2026-10-01T10:00:00Z')]
  })
  assert.equal(r.json.classification, 'ambiguous')
  assert.equal(r.event.classification, 'ambiguous')
  assert.equal(r.event.lead_id, null)
  assert.equal(r.db.activities.length, 0)
  assert.deepEqual([r.lead('A').status, r.lead('B').status], ['contacted_pending', 'contacted_pending'])
})

test('nenhum candidato com envio do CRM continua ambíguo', async () => {
  const r = await reply({
    leads: [lead('A', { phone: PHONE }), lead('B', { phone: PHONE })],
    messages: [sent('A', '2026-10-25T10:00:00Z', { status: 'failed' }), sent('B', null, { status: 'queued' })]
  })
  assert.equal(r.json.classification, 'ambiguous')
  assert.equal(r.event.lead_id, null)
  assert.equal(r.db.activities.length, 0)
  assert.deepEqual([r.lead('A').status, r.lead('B').status], ['contacted_pending', 'contacted_pending'])
})

test('nunca cruza empresas: envio de outra empresa não desempata, e lead de outra empresa não é candidato', async () => {
  const r = await reply({
    leads: [lead('A', { phone: PHONE }), lead('B', { phone: PHONE }), lead('X', { phone: PHONE, organization_id: OTHER })],
    messages: [sent('A', '2026-10-25T10:00:00Z', { organization_id: OTHER }), sent('X', '2026-10-28T10:00:00Z', { organization_id: OTHER })]
  })
  assert.equal(r.json.classification, 'ambiguous')
  assert.equal(r.lead('X').status, 'contacted_pending')
})

test('lead excluído ou descartado não entra no desempate', async () => {
  const r = await reply({
    leads: [lead('A', { phone: PHONE }), lead('B', { phone: PHONE, status: 'discarded' }), lead('C', { phone: PHONE, deleted_at: '2026-10-01' })],
    messages: [sent('B', '2026-10-28T10:00:00Z'), sent('C', '2026-10-28T11:00:00Z')]
  })
  assert.equal(r.json.lead_id, 'A', 'sobra um candidato só: segue o caminho normal de lead único')
  assert.equal(r.json.tie_break, undefined)
})

test('lead único continua igual: sem consulta de desempate, vira replied', async () => {
  const r = await reply({ leads: [lead('A', { phone: PHONE })], messages: [] })
  assert.equal(r.json.classification, 'human')
  assert.equal(r.json.lead_id, 'A')
  assert.equal(r.json.tie_break, undefined)
  assert.equal(r.event.lead_id, 'A')
  assert.equal(r.db.activities[0].activity_type, 'reply_received')
  assert.equal(r.lead('A').status, 'replied')
})

test('número sem nenhum lead continua "ignored"', async () => {
  const r = await reply({ leads: [lead('A', { phone: '11888880000' })] })
  assert.equal(r.json.classification, 'ignored')
  assert.equal(r.db.activities.length, 0)
})
