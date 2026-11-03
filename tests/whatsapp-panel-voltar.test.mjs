import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const center = readFileSync('src/whatsapp-center.jsx', 'utf8')
const css = readFileSync('src/whatsapp-center.css', 'utf8')

test('painel de conversa do lead: Voltar do celular fecha o painel em vez de sair do app', () => {
  assert.match(center, /import \{ useBackLayer \} from '\.\/back-layer'/)
  assert.match(center, /export function WhatsAppLeadPanel\(\{ organization, lead, onClose, onUpdated \}\) \{\n  useBackLayer\(true, onClose\)/)
})

test('botão Fechar do painel é visível e fácil de tocar no celular', () => {
  assert.match(center, /className="wa-icon-button wa-close-button" onClick=\{onClose\} aria-label="Fechar conversa"/)
  assert.match(center, /<span className="wa-close-label">Fechar<\/span>/)
  assert.match(css, /\.wa-side-header\{position:sticky;top:0/)
  assert.match(css, /\.wa-side-panel\{height:100vh;height:100dvh\}/)
  assert.match(css, /\.wa-side-header \.wa-close-button \.wa-close-label\{display:inline/)
})
