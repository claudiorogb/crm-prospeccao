import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fn = readFileSync('supabase/functions/whatsapp-ai-reply/index.ts', 'utf8')
const center = readFileSync('src/whatsapp-center.jsx', 'utf8')
const btn = readFileSync('src/ai-reply-button.jsx', 'utf8')
const app = readFileSync('src/App.jsx', 'utf8')

test('função respeita limites por empresa e usuário e não aceita tenant do corpo', () => {
  assert.match(fn, /company_daily_limit_reached/)
  assert.match(fn, /user_daily_limit_reached/)
  assert.match(fn, /ai_organization_settings/)
  assert.match(fn, /ai_user_settings/)
  assert.match(fn, /ai_request_audit/)
  assert.doesNotMatch(fn, /body\?\.organization_id/)
})

test('função usa só mensagens recentes, perfil da empresa e etapa do lead', () => {
  assert.match(fn, /CONTEXT_MESSAGES = 6/)
  assert.match(fn, /ai_business_profile/)
  assert.match(fn, /STAGE_LABELS/)
  assert.match(fn, /OPENAI_REPLY_MODEL/)
  assert.match(fn, /2 a 4 frases/)
})

test('botão apenas coloca a sugestão na caixa e nunca envia', () => {
  assert.match(center, /onSuggestion=\{text => setDraft\(text\)\}/)
  assert.equal((center.match(/<AiReplyButton/g) || []).length, 2)
  assert.doesNotMatch(btn, /send_message/)
  assert.match(btn, /Responder com IA/)
})

test('campo de perfil da empresa fica disponível na tela do WhatsApp', () => {
  assert.match(app, /IA do WhatsApp/)
  assert.match(app, /<AiBusinessProfile/)
})

test('botão Configurar IA abre formulário com os seis campos e cabe no limite do banco', async () => {
  const src = readFileSync('src/ai-business-profile.jsx', 'utf8')
  assert.match(src, /Configurar IA/)
  for (const label of ['O que oferecemos', 'Como funciona', 'Diferenciais', 'Tom de voz', 'Não prometer', 'Próximo passo']) {
    assert.ok(src.includes(label), label)
  }
  const max = [...src.matchAll(/max: (\d+)/g)].map(m => Number(m[1])).reduce((a, b) => a + b, 0)
  assert.ok(max + 100 <= 2000, `soma dos limites ${max}`)
})

test('somente admin ou dono vê o botão Configurar IA', () => {
  const src = readFileSync('src/ai-business-profile.jsx', 'utf8')
  assert.match(src, /\['admin', 'owner'\]\.includes/)
  assert.match(src, /canEdit \?/)
  assert.match(src, /Somente administradores da empresa/)
})
