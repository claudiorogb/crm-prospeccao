import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  initialTemplateIdForCampaign,
  resendSelectionProblem,
  templateLabel,
  templatesForCampaign
} from '../src/resend-templates.js'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sending = app.slice(app.indexOf('function MessageSending('), app.indexOf('function CampaignWorkspace('))
const fn = readFileSync(new URL('../supabase/functions/enqueue_whatsapp_messages/index.ts', import.meta.url), 'utf8')

const templates = [
  { id: 'a1', target_segment_id: 'contab', name: 'Abordagem 1', body: 'Olá {empresa}', is_active: true, is_default_for_target: false, created_at: '2026-10-01' },
  { id: 'a2', target_segment_id: 'contab', name: 'Abordagem 2', body: 'Oi', is_active: true, is_default_for_target: true, created_at: '2026-09-01' },
  { id: 'a3', target_segment_id: 'contab', name: '', body: 'Bom dia! Vi que a {empresa} atende empresas de Campinas e gostaria de apresentar uma parceria.', is_active: true, created_at: '2026-10-20' },
  { id: 'a4', target_segment_id: 'contab', name: 'Inativa', body: 'x', is_active: false, created_at: '2026-10-21' },
  { id: 'a5', target_segment_id: 'contab', name: 'Excluída', body: 'x', is_active: true, deleted_at: '2026-10-22', created_at: '2026-10-22' },
  { id: 'b1', target_segment_id: 'parcerias', name: 'Única', body: 'Oi', is_active: true, created_at: '2026-10-01' }
]

test('campanha com várias mensagens lista todas as ativas, padrão primeiro e depois as mais recentes', () => {
  assert.deepEqual(templatesForCampaign(templates, 'contab').map(t => t.id), ['a2', 'a3', 'a1'])
  assert.deepEqual(templatesForCampaign(templates, 'parcerias').map(t => t.id), ['b1'])
  assert.deepEqual(templatesForCampaign(templates, ''), [])
})

test('cada mensagem é identificada pelo nome cadastrado ou pelo começo do texto', () => {
  assert.equal(templateLabel(templates[0]), 'Abordagem 1')
  assert.equal(templateLabel(templates[1]), 'Abordagem 2 (padrão)')
  const label = templateLabel(templates[2])
  assert.ok(label.startsWith('Bom dia! Vi que a {empresa} atende'))
  assert.ok(label.endsWith('…'))
  assert.ok(label.length <= 61)
})

test('troca de campanha: uma mensagem já vem escolhida; várias começam em Selecione', () => {
  assert.equal(initialTemplateIdForCampaign(templates, 'parcerias'), 'b1')
  assert.equal(initialTemplateIdForCampaign(templates, 'contab'), '')
  assert.equal(initialTemplateIdForCampaign(templates, ''), '')
  assert.match(sending, /function chooseResendCampaign\(targetSegmentId\) \{\s*setResendTargetSegmentId\(targetSegmentId\)\s*setResendTemplateId\(initialTemplateIdForCampaign\(templates, targetSegmentId\)\)/)
  assert.match(sending, /onChange=\{event => chooseResendCampaign\(event\.target\.value\)\}/)
})

test('envio bloqueado com aviso claro enquanto faltar campanha ou mensagem', () => {
  assert.match(resendSelectionProblem(templates, '', ''), /Escolha a campanha e a mensagem/)
  assert.match(resendSelectionProblem(templates, 'contab', ''), /Escolha qual mensagem desta campanha/)
  assert.match(resendSelectionProblem(templates, 'contab', 'b1'), /não está mais disponível/)
  assert.match(resendSelectionProblem(templates, 'contab', 'a4'), /não está mais disponível/)
  assert.equal(resendSelectionProblem(templates, 'contab', 'a3'), '')
  assert.match(sending, /const resendMissingMessage = resendRecipients\.length > 0 && Boolean\(resendProblem\)/)
  assert.match(sending, /if \(selectedLeads\.some\(isResend\) && resendProblem\) \{\s*setMessage\(resendProblem\)\s*return/)
})

test('"já recebeu" compara pela mensagem exata escolhida (template_id), não pela campanha', () => {
  assert.match(sending, /const templateIds = resendTemplateId \? \[resendTemplateId\] : \[\]/)
  assert.match(sending, /\.in\('template_id', templateIds\)/)
  assert.match(sending, /\}, \[resendRecipientKey, resendTemplateId, organization\.id\]\)/)
})

test('proteção cancela o lote se o servidor não confirmar o template_id escolhido', () => {
  assert.match(sending, /if \(extraBody\.template_id && response\.data\?\.message_override\?\.template_id !== extraBody\.template_id\) \{/)
  assert.match(sending, /p_action: 'cancel'/)
})

test('função valida empresa, ativa e campanha antes de enfileirar', () => {
  const validation = fn.slice(fn.indexOf('if (overrideTemplateId) {'), fn.indexOf('const messageOverride'))
  assert.match(validation, /\.eq\("id", overrideTemplateId\)\s*\.eq\("organization_id", organizationId\)/)
  assert.match(validation, /!chosenTemplate\.is_active \|\| chosenTemplate\.deleted_at/)
  assert.match(validation, /chosenTemplate\.target_segment_id !== overrideTargetId/)
  assert.ok(fn.indexOf('if (overrideTemplateId) {') < fn.indexOf('.from("outbound_batches")'), 'validação acontece antes de criar o lote')
})
