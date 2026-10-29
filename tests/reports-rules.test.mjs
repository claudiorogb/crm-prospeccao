import test from 'node:test'
import assert from 'node:assert/strict'
import { wonInMonth, bySeller, companyProgress, byCampaign, lossBreakdown } from '../src/reports-rules.js'

const leads = [
  { id: 1, status: 'won', assigned_to: 'a', contract_value: '1000', contract_signed_at: '2026-10-05', campaigns: { name: 'X' } },
  { id: 2, status: 'won', assigned_to: 'b', contract_value: 500, contract_signed_at: '2026-09-30', campaigns: { name: 'X' } },
  { id: 3, status: 'won', assigned_to: null, contract_value: 200, status_changed_at: '2026-10-20T10:00:00Z', campaigns: { name: 'Y' } },
  { id: 4, status: 'replied', campaigns: { name: 'X' } },
  { id: 5, status: 'lost', loss_reason: 'price' }
]
const members = [{ user_id: 'a', display_name: 'Ana' }, { user_id: 'b', display_name: 'Beto' }]
const goals = [{ user_id: 'a', period: '2026-10-01', target_won_count: 2, target_value: 2000 }, { user_id: null, period: '2026-10-01', target_won_count: 4, target_value: null }]

test('ganhos do mês respeitam a data do contrato', () => {
  assert.deepEqual(wonInMonth(leads, '2026-10-01').map(l => l.id), [1, 3])
})
test('meta por vendedor e sem vendedor', () => {
  const rows = bySeller(leads, '2026-10-01', members, goals)
  assert.equal(rows.find(r => r.name === 'Ana').pctCount, 50)
  assert.equal(rows.find(r => r.name === 'Ana').pctValue, 50)
  assert.equal(rows.find(r => r.name === 'Beto').won, 0)
  assert.equal(rows.find(r => r.name === 'Sem vendedor').won, 1)
})
test('meta da empresa soma todos', () => {
  const c = companyProgress(leads, '2026-10-01', goals)
  assert.equal(c.won, 2); assert.equal(c.pctCount, 50); assert.equal(c.pctValue, null)
})
test('campanhas e perdas', () => {
  assert.equal(byCampaign(leads).find(c => c.name === 'X').replied, 3)
  assert.deepEqual(lossBreakdown(leads, c => 'Preço'), [['Preço', 1]])
})
