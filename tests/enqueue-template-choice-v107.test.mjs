// Roda a função enqueue_whatsapp_messages de verdade, com um Supabase falso em memória.
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const fnPath = new URL('../supabase/functions/enqueue_whatsapp_messages/index.ts', import.meta.url).pathname
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ORG = 'org-1', OTHER = 'org-2'
function freshDb() {
  return {
    organization_members: [{ organization_id: ORG, user_id: 'user-1', is_active: true, deleted_at: null }],
    organizations: [{ id: ORG, is_active: true, deleted_at: null, is_sandbox: false }],
    system_admins: [],
    organization_settings: [{ organization_id: ORG, whatsapp_send_interval_seconds: 120, whatsapp_daily_send_limit: 50, whatsapp_sending_paused: false, allowed_send_start: '00:00', allowed_send_end: '23:59', default_cadence_days: [0,1,2,3,4,5,6] }],
    whatsapp_numbers: [{ id: 'wa1', organization_id: ORG, alias: 'Principal', is_active: true, is_default: true }],
    leads: [
      { id: 'L1', organization_id: ORG, business_name: 'Cliente 1', phone: '11999990001', target_segment_id: 'contab', status: 'contacted_pending' },
      { id: 'L2', organization_id: ORG, business_name: 'Cliente 2', phone: '11999990002', target_segment_id: 'parcerias', status: 'contacted_pending' },
      { id: 'N1', organization_id: ORG, business_name: 'Lead novo', phone: '11999990003', target_segment_id: 'contab', status: 'new' }
    ],
    message_templates: [
      { id: U(1), organization_id: ORG, target_segment_id: 'contab', body: 'Mensagem PADRÃO contab {empresa}', is_active: true, is_default_for_target: true, created_at: '2026-09-01', deleted_at: null },
      { id: U(2), organization_id: ORG, target_segment_id: 'contab', body: 'Mensagem DOIS contab {empresa}', is_active: true, is_default_for_target: false, created_at: '2026-10-01', deleted_at: null },
      { id: U(3), organization_id: ORG, target_segment_id: 'contab', body: 'inativa', is_active: false, is_default_for_target: false, created_at: '2026-10-02', deleted_at: null },
      { id: U(4), organization_id: ORG, target_segment_id: 'contab', body: 'excluída', is_active: true, is_default_for_target: false, created_at: '2026-10-03', deleted_at: '2026-10-04' },
      { id: U(5), organization_id: ORG, target_segment_id: 'parcerias', body: 'Parcerias {empresa}', is_active: true, is_default_for_target: true, created_at: '2026-10-01', deleted_at: null },
      { id: U(9), organization_id: OTHER, target_segment_id: 'contab', body: 'DE OUTRA EMPRESA', is_active: true, is_default_for_target: true, created_at: '2026-10-01', deleted_at: null }
    ],
    outbound_messages: [], outbound_batches: [], audit_logs: []
  }
}
const fake = new URL('./fixtures/fake-supabase-admin.mjs', import.meta.url).pathname
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
async function call(body) {
  const db = freshDb(); for (const k of Object.keys(globalThis.__fakeDb)) delete globalThis.__fakeDb[k]; Object.assign(globalThis.__fakeDb, db)
  const res = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ organization_id: ORG, ...body }) }))
  return { status: res.status, json: await res.json(), db: globalThis.__fakeDb }
}

test('enqueue_whatsapp_messages: escolha de mensagem no reenvio (template_id)', async () => {

  // Compatibilidade: sem template_id
  let r = await call({ lead_ids: ['N1'] })
  assert.equal(r.status, 200); assert.equal(r.db.outbound_messages[0].template_id, U(1)); assert.equal(r.json.message_override, null)
  r = await call({ lead_ids: ['L1', 'L2'], template_target_segment_id: 'contab' })
  assert.equal(r.status, 200); assert.ok(r.db.outbound_messages.every(m => m.template_id === U(1)))

  // template_id escolhido
  r = await call({ lead_ids: ['L1', 'L2'], template_target_segment_id: 'contab', template_id: U(2) })
  assert.equal(r.status, 200); assert.equal(r.json.queued, 2)
  assert.ok(r.db.outbound_messages.every(m => m.template_id === U(2) && m.rendered_message.startsWith('Mensagem DOIS contab')))
  assert.equal(r.json.message_override.template_id, U(2))
  assert.equal(r.db.audit_logs[0].metadata.message_override.template_id, U(2))

  for (const [desc, body, re] of [
    ['mensagem de outra empresa', { template_target_segment_id: 'contab', template_id: U(9) }, /não foi encontrada nesta empresa/],
    ['mensagem inativa', { template_target_segment_id: 'contab', template_id: U(3) }, /inativa ou foi excluída/],
    ['mensagem excluída', { template_target_segment_id: 'contab', template_id: U(4) }, /inativa ou foi excluída/],
    ['mensagem de outra campanha', { template_target_segment_id: 'contab', template_id: U(5) }, /não pertence à campanha/],
    ['template_id inexistente', { template_id: U(77) }, /não foi encontrada/],
    ['template_id malformado', { template_id: "x' or 1=1" }, /inválida/]
  ]) {
    r = await call({ lead_ids: ['L1'], ...body })
    assert.equal(r.status, 400); assert.match(r.json.error, re)
    assert.equal(r.db.outbound_messages.length, 0); assert.equal(r.db.outbound_batches.length, 0)
    assert.equal(r.db.leads.find(l => l.id === 'L1').status, 'contacted_pending')
  }
  r = await call({ lead_ids: ['L1'], template_id: U(2) })
  assert.equal(r.status, 200); assert.equal(r.db.outbound_messages[0].template_id, U(2))
})
