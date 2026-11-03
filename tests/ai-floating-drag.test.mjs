import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const src = fs.readFileSync('src/ai-assistant.jsx', 'utf8')
test('balão da IA é arrastável sem fechar a conversa, com posição salva só no navegador', () => {
  assert.match(src, /onPointerDown: startDrag/)
  assert.match(src, /suppressClickRef/)
  assert.match(src, /localStorage\.setItem\(AI_POSITION_KEY/)
  assert.match(src, /onDoubleClick=\{resetPosition\}/)
})
