import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const app = fs.readFileSync('src/App.jsx', 'utf8')
test('card do Kanban mostra balão "Retornar hoje" quando o retorno é hoje', () => {
  assert.match(app, /l\.next_contact_date === currentBrazilDate\(\)[\s\S]{0,200}return-today-bubble-v112[\s\S]{0,80}Retornar hoje/)
})
