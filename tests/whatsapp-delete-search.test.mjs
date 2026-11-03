import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const center = readFileSync('src/whatsapp-center.jsx', 'utf8')
const del = readFileSync('supabase/functions/whatsapp-message-delete/index.ts', 'utf8')
const ai = readFileSync('supabase/functions/whatsapp-ai-reply/index.ts', 'utf8')
const profile = readFileSync('src/ai-business-profile.jsx', 'utf8')

test('mensagens apagadas não aparecem nas conversas', () => {
  assert.equal((center.match(/\.is\('deleted_at', null\)\n\s+\.order\('occurred_at', \{ ascending: true \}\)/g) || []).length, 2)
  assert.match(ai, /\.is\("deleted_at", null\)/)
})

test('apagar mensagem é só no CRM e respeita permissões', () => {
  assert.match(del, /deleted_at: now/)
  assert.match(del, /text_body: null/)
  assert.match(del, /\["admin", "owner"\]/)
  assert.match(del, /sent_by_user_id === user\.id/)
  assert.doesNotMatch(del, /evolution|graph\.facebook/i)
  assert.match(center, /whatsapp-message-delete/)
  assert.match(center, /Apagar do CRM\?/)
})

test('busca de conversa filtra por nome, telefone e prévia sem acento', () => {
  assert.match(center, /placeholder="Buscar conversa"/)
  assert.match(center, /conversationSearch/)
  assert.match(center, /normalize\('NFD'\)/)
})

test('nome da empresa nas mensagens é configurável e tem prioridade', () => {
  assert.match(profile, /Nome da empresa nas mensagens/)
  assert.match(ai, /Nome da empresa nas mensagens/)
  assert.match(ai, /displayName \|\| cleanText\(orgResult/)
})

test('Enter envia e Shift+Enter quebra a linha nas duas caixas de mensagem', () => {
  assert.match(center, /event\.key !== 'Enter' \|\| event\.shiftKey/)
  assert.match(center, /requestSubmit\(\)/)
  assert.equal((center.match(/onKeyDown=\{sendOnEnter\}/g) || []).length, 2)
  assert.match(center, /onChange=\{e => setDraft\(e\.target\.value\)\}\n\s+onKeyDown=\{sendOnEnter\}\n\s+placeholder=\{attachment \? 'Legenda opcional\.\.\.' : 'Responder pelo AXIVA/)
  assert.match(center, /onChange=\{e => setDraft\(e\.target\.value\)\}\n\s+onKeyDown=\{sendOnEnter\}\n\s+placeholder=\{attachment \? 'Legenda opcional\.\.\.' : 'Escreva uma mensagem/)
})

test('em celular e tablet o Enter quebra a linha (como no WhatsApp)', () => {
  assert.match(center, /\(pointer: coarse\)/)
  assert.match(center, /if \(isTouchDevice\(\)\) return/)
})

test('mensagem de texto aparece na hora e o envio termina em segundo plano', () => {
  assert.match(center, /function makePendingMessage/)
  assert.equal((center.match(/async function sendTextNow/g) || []).length, 2)
  assert.equal((center.match(/withPendingMessages\(messages, pendingMessages/g) || []).length, 2)
  assert.match(center, /setDraft\(current => current \|\| text\)/)
})
