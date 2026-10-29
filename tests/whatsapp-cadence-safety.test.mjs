import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('supabase/migrations/20261029130000_whatsapp_cadence.sql', 'utf8')

test('cadência vem desligada por padrão e é opt-in', () => {
  assert.match(sql, /enabled boolean not null default false/)
  assert.match(sql, /where wc\.enabled/)
})
test('para quando o lead responde e usa a fila normal', () => {
  assert.match(sql, /direction = 'inbound'/)
  assert.match(sql, /insert into public\.outbound_messages/)
  assert.doesNotMatch(sql, /sendText/)
})
test('respeita pausa, janela, dias e limite diário; função não é exposta', () => {
  for (const piece of ['whatsapp_sending_paused', 'allowed_send_start', 'default_cadence_days', 'whatsapp_daily_send_limit', 'revoke all on function private.run_whatsapp_cadence'])
    assert.ok(sql.includes(piece), piece)
})
test('painel aparece na tela Mensagens', () => {
  assert.match(fs.readFileSync('src/App.jsx', 'utf8'), /<WhatsappCadencePanel organization=\{organization\} />)
})
