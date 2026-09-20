import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const charts = readFileSync(new URL('../src/dashboard-visual.jsx', import.meta.url), 'utf8')

test('remove only the four requested dashboard captions while preserving the panels', () => {
  for (const text of [
    'Etapa atual dos leads cadastrados',
    'Como os leads chegaram',
    'Conversão, propostas e vendas atribuídas a cada vendedor',
    'Conversão, propostas e vendas atribuídas a cada usuário da empresa',
    'Origem dos leads e avanço inicial da prospecção.'
  ]) {
    assert.ok(!app.includes(text) && !charts.includes(text), `Legenda ainda exibida: ${text}`)
  }
  for (const text of ['Funil de vendas', 'Origem dos leads']) assert.ok(charts.includes(text))
  for (const text of ['Desempenho por vendedor', 'Leads e contatos']) assert.ok(app.includes(text))
  assert.match(charts, /function Panel\(\{ title, icon: Icon, children \}\)/)
  assert.doesNotMatch(charts, /<p>\{subtitle\}<\/p>/)
})
