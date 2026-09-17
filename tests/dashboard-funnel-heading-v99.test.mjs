import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const start = source.indexOf('<section className="panel dashboard-block-v61 dashboard-funnel-v61">')
assert.notEqual(start, -1, 'Dashboard ongoing-deals panel must remain')
const end = source.indexOf('</section>', start)
assert.notEqual(end, -1, 'Dashboard ongoing-deals panel must close')
const panel = source.slice(start, end)

test('only the redundant header above the ongoing-deals metric is removed', () => {
  assert.doesNotMatch(panel, /className="dashboard-block-head-v61"/)
  assert.doesNotMatch(panel, /FUNIL ATIVO/)
  assert.doesNotMatch(panel, /Somente oportunidades que já chegaram a Interessado e ainda não foram encerradas/)
  assert.match(panel, /className="dashboard-hero-v61"/)
  assert.match(panel, /<StatCard\s+label="Negócios em andamento"\s+value=\{stats\.ongoing\}\s+detail="Interessado \+ Proposta \+ Negociação"/)
})

test('dashboard calculations, other headings and tenant-scoped data access remain', () => {
  assert.match(source, /function Dashboard\(/)
  assert.match(source, /\.eq\('organization_id', organization\.id\)/)
  assert.match(source, /<StatCard\s+label="Negócios em andamento"/)
  assert.match(source, /<h2>[^<]+<\/h2>/)
})
