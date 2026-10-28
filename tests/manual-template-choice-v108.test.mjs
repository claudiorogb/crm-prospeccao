import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  initialTemplateIdForCampaign,
  manualRecipientProblem,
  planChosenTemplateSend,
  resendSelectionProblem,
  templatesForCampaign
} from '../src/resend-templates.js'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sending = app.slice(app.indexOf('function MessageSending('), app.indexOf('function CampaignWorkspace('))
const migration = readFileSync(new URL('../supabase/migrations/20261028120000_leads_send_template_id.sql', import.meta.url), 'utf8')

const templates = [
  { id: 'b1', target_segment_id: 'buffets', name: 'Buffet 1', body: 'a', is_active: true, is_default_for_target: true, created_at: '2026-09-01' },
  { id: 'b2', target_segment_id: 'buffets', name: 'Buffet 2', body: 'b', is_active: true, created_at: '2026-10-01' },
  { id: 'b3', target_segment_id: 'buffets', name: 'Buffet 3', body: 'c', is_active: true, created_at: '2026-10-02' },
  { id: 'off', target_segment_id: 'buffets', name: 'Desativada', body: 'd', is_active: false, created_at: '2026-10-03' },
  { id: 'e1', target_segment_id: 'eventos', name: 'Eventos', body: 'e', is_active: true, created_at: '2026-10-01' }
]
const form = extra => ({ contact_name: 'Ana', phone: '19 99999-0000', business_name: 'Buffet Alegria', target_segment_id: 'buffets', template_id: 'b2', ...extra })

test('formulário: campanha com várias mensagens lista todas as ativas e usa o mesmo código do REENVIO', () => {
  assert.deepEqual(templatesForCampaign(templates, 'buffets').map(t => t.id), ['b1', 'b3', 'b2'])
  assert.match(sending, /const manualTemplateOptions = templatesForCampaign\(templates, manualRecipient\.target_segment_id\)/)
  assert.match(sending, /\{manualTemplateOptions\.map\(template => \(\s*<option key=\{template\.id\} value=\{template\.id\}>\{templateLabel\(template\)\}<\/option>/)
  assert.match(sending, /<label>Campanha\s*<select\s*value=\{manualRecipient\.target_segment_id\}/)
})

test('formulário: troca de campanha escolhe sozinha quando há uma mensagem e volta para Selecione quando há várias', () => {
  assert.equal(initialTemplateIdForCampaign(templates, 'eventos'), 'e1')
  assert.equal(initialTemplateIdForCampaign(templates, 'buffets'), '')
  assert.match(sending, /function chooseManualCampaign\(targetSegmentId\) \{\s*setManualRecipient\(current => \(\{\s*\.\.\.current,\s*target_segment_id: targetSegmentId,\s*template_id: initialTemplateIdForCampaign\(templates, targetSegmentId\)/)
  assert.match(sending, /onChange=\{event => chooseManualCampaign\(event\.target\.value\)\}/)
})

test('formulário bloqueado sem escolher a mensagem, com aviso do que falta', () => {
  assert.equal(manualRecipientProblem(form({ template_id: '' }), templates), 'Para adicionar o destinatário, preencha: mensagem.')
  assert.equal(manualRecipientProblem(form({ target_segment_id: '', template_id: '' }), templates), 'Para adicionar o destinatário, preencha: campanha e mensagem.')
  assert.equal(manualRecipientProblem(form({ contact_name: ' ', phone: '' }), templates), 'Para adicionar o destinatário, preencha: nome e telefone.')
  assert.match(manualRecipientProblem(form({ template_id: 'off' }), templates), /não está mais disponível/)
  assert.match(manualRecipientProblem(form({ template_id: 'e1' }), templates), /não está mais disponível/)
  assert.equal(manualRecipientProblem(form(), templates), '')
  assert.match(sending, /const formProblem = manualRecipientProblem\(manualRecipient, templates\)\s*if \(formProblem\) \{\s*setMessage\(formProblem\)\s*return/)
  assert.doesNotMatch(sending, /Preencha nome, telefone, empresa e mensagem/)
  assert.match(sending, /send_template_id: templateId,/)
})

test('envio: lead manual com mensagem específica vai agrupado por template_id; os demais como hoje', () => {
  const plan = planChosenTemplateSend([
    { id: 'L1', target_segment_id: 'buffets' },
    { id: 'M1', target_segment_id: 'buffets', send_template_id: 'b2' },
    { id: 'M2', target_segment_id: 'buffets', send_template_id: 'b2' },
    { id: 'M3', target_segment_id: 'buffets', send_template_id: 'b3' },
    { id: 'L2', target_segment_id: 'eventos' }
  ], templates)
  assert.deepEqual(plan.campaignLeadIds, ['L1', 'L2'])
  assert.deepEqual(plan.templateGroups, [
    { templateId: 'b2', targetSegmentId: 'buffets', ids: ['M1', 'M2'] },
    { templateId: 'b3', targetSegmentId: 'buffets', ids: ['M3'] }
  ])
  assert.deepEqual(plan.unavailable, [])
  assert.match(sending, /\{ ids: normalPlan\.campaignLeadIds, body: \{\} \}/)
  assert.match(sending, /body: \{ template_target_segment_id: group\.targetSegmentId, template_id: group\.templateId \}/)
})

test('mensagem escolhida excluída ou desativada bloqueia o envio inteiro, sem trocar por outra', () => {
  const plan = planChosenTemplateSend([
    { id: 'L1', target_segment_id: 'buffets' },
    { id: 'M1', business_name: 'Buffet X', target_segment_id: 'buffets', send_template_id: 'off' },
    { id: 'M2', business_name: 'Buffet Y', target_segment_id: 'buffets', send_template_id: 'sumiu' }
  ], templates)
  assert.deepEqual(plan.unavailable.map(lead => lead.id), ['M1', 'M2'])
  assert.deepEqual(plan.templateGroups, [])
  const guard = sending.slice(sending.indexOf('if (normalPlan.unavailable.length) {'), sending.indexOf('const normalIds = normalLeads.map'))
  assert.match(guard, /Nada foi enviado/)
  assert.match(guard, /return/)
  assert.ok(sending.indexOf('if (normalPlan.unavailable.length) {') < sending.indexOf("functions.invoke('enqueue_whatsapp_messages'") ||
    sending.indexOf('if (normalPlan.unavailable.length) {') < sending.indexOf('const result = await enqueueInChunks(job.ids'), 'conferência antes de qualquer envio')
})

test('REENVIO e proteção do template_id continuam iguais', () => {
  assert.match(resendSelectionProblem(templates, '', ''), /Escolha a campanha e a mensagem do reenvio/)
  assert.match(sending, /\{ ids: resendIds, body: \{ template_target_segment_id: resendTargetSegmentId, template_id: resendTemplateId \} \}/)
  assert.match(sending, /if \(extraBody\.template_id && response\.data\?\.message_override\?\.template_id !== extraBody\.template_id\) \{/)
})

test('migração: coluna opcional, idempotente e com trava por empresa', () => {
  assert.match(migration, /add column if not exists send_template_id uuid null/)
  assert.match(migration, /references public\.message_templates\(id\) on delete no action/)
  assert.match(migration, /create index if not exists idx_leads_send_template_id/)
  assert.match(migration, /drop trigger if exists trg_lead_send_template_org on public\.leads;\s*create trigger trg_lead_send_template_org/)
  assert.match(migration, /private\.assert_same_org\('public\.message_templates'::regclass, new\.send_template_id, new\.organization_id\)/)
})
