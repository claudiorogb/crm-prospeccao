import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const ui = fs.readFileSync('src/whatsapp-center.jsx', 'utf8')
test('imagem da conversa abre em popup com zoom, sem gravar nada no banco', () => {
  assert.match(ui, /function ImageViewer/)
  assert.match(ui, /onClick=\{\(\) => setViewing\(true\)\}/)
  assert.match(ui, /aria-label="Aumentar"[\s\S]*aria-label="Fechar"|aria-label="Diminuir"/)
  const viewer = ui.slice(ui.indexOf('function ImageViewer'), ui.indexOf('function formatContactPhone'))
  assert.doesNotMatch(viewer, /supabase/)
})
