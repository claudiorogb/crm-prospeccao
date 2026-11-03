import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const worker = fs.readFileSync('supabase/functions/process_whatsapp_queue/index.ts', 'utf8')
const hook = fs.readFileSync('supabase/functions/whatsapp-inbound-webhook/index.ts', 'utf8')
const ui = fs.readFileSync('src/whatsapp-center.jsx', 'utf8')
test('envio do CRM é espelhado na conversa sem poder derrubar o envio', () => {
  assert.match(worker, /await mirrorSentMessage\(admin, message, providerMessageId, finalText, sentAt\)/)
  assert.match(worker, /async function mirrorSentMessage[\s\S]*try \{[\s\S]*catch \(error\)/)
  assert.match(worker, /source: "crm"/)
})
test('contato compartilhado guarda nome e telefone', () => {
  assert.match(hook, /if \(type === "contact"\) return \{ contacts: extractSharedContacts\(data\) \}/)
  assert.match(hook, /waid=/)
})
test('tela mostra o contato e abre nova conversa', () => {
  assert.match(ui, /wa-contact-card/)
  assert.match(ui, /invoke\('start_conversation'/)
})
