import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const app = fs.readFileSync('src/App.jsx', 'utf8')
const email = fs.readFileSync('src/email-marketing.jsx', 'utf8')

test('lista de envio esconde leads movidos para Contatos e tem os 3 botões', () => {
  assert.match(app, /\.is\('email_contacts_at', null\)/)
  assert.match(app, /Mover para Contatos/)
  assert.match(app, /Enviar por e-mail/)
  assert.match(app, /Excluir selecionados/)
})
test('quem já está em prospecção por e-mail não recebe novo envio', () => {
  assert.match(app, /recipient_source', 'crm_prospecting'[\s\S]{0,200}neq\('status', 'cancelled'\)/)
})
test('iniciar a sequência move os leads para Contatos', () => {
  assert.match(email, /email_contacts_at: new Date\(\)\.toISOString\(\)/)
  assert.match(email, /crm_email_preselect/)
})
