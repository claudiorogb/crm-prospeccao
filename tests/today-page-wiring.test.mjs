import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const page = fs.readFileSync(new URL('../src/today-page.jsx', import.meta.url), 'utf8')

test('tela Hoje só lê e grava leads da empresa atual', () => {
  assert.match(page, /\.eq\('organization_id', organizationId\)/)
  assert.match(page, /\.eq\('id', lead\.id\)\s*\.eq\('organization_id', organization\.id\)/)
  assert.doesNotMatch(page, /service_role|\.delete\(|\.rpc\(/)
})

test('a página antiga de retornos passou a abrir a tela Hoje, sem mudar rotas nem o aviso de login', () => {
  assert.match(app, /function OverdueReturnsPage\([^)]*\) \{[\s\S]*<TodayPage /)
  assert.equal((app.match(/<OverdueReturnsPage/g) || []).length, 2)
  assert.equal((app.match(/<OverdueReturnsAlert/g) || []).length, 2)
  assert.match(app, /setPage\('overdue-returns'\)/)
})
