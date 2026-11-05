import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LEADS_CHANGED, notifyLeadsChanged, onLeadsChanged } from '../src/leads-sync.js'

test('notify/on sem window não quebra', () => {
  assert.equal(typeof onLeadsChanged(() => {}), 'function')
  notifyLeadsChanged()
  assert.equal(LEADS_CHANGED, 'crm:leads-changed')
})

test('Kanban, Hoje e contador lateral escutam e avisam alterações de lead', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const today = readFileSync(new URL('../src/today-page.jsx', import.meta.url), 'utf8')
  assert.ok((app.match(/notifyLeadsChanged\(\)/g) || []).length >= 5)
  assert.ok((app.match(/onLeadsChanged\(/g) || []).length >= 2)
  assert.match(today, /onLeadsChanged\(refresh\)/)
  assert.match(today, /notifyLeadsChanged\(\)/)
})
