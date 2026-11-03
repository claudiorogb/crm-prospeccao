import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const ui = fs.readFileSync('src/whatsapp-center.jsx', 'utf8')
test('botão de mídia sempre diz Abrir áudio/vídeo/arquivo/imagem, sem nome do arquivo', () => {
  assert.match(ui, /document: 'arquivo'/)
  assert.match(ui, /audio: 'áudio'/)
  assert.doesNotMatch(ui, /<span>\{meta\.file_name \|\|/)
})
