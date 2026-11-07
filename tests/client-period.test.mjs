import test from 'node:test'
import assert from 'node:assert/strict'
import { addMonthsIso, clientPeriodRange, salesInRange, salesMetrics } from '../src/client-period.js'

const sales = [
  { id: 1, sale_date: '2026-11-01', amount: '1000' },
  { id: 2, sale_date: '2026-09-20', amount: 500 },
  { id: 3, sale_date: '2026-06-15', amount: 250 },
  { id: 4, sale_date: '2025-12-01', amount: 4000 },
  { id: 5, sale_date: null, amount: 10 }
]
const ids = list => list.map(s => s.id)

test('meses curtos usam o último dia do mês', () => {
  assert.equal(addMonthsIso('2026-03-31', -1), '2026-02-28')
  assert.equal(addMonthsIso('2026-11-07', -12), '2025-11-07')
})

test('janelas dos últimos meses terminam hoje e não repetem o dia de partida', () => {
  assert.deepEqual(clientPeriodRange('month', '2026-11-07'), { start: '2026-10-08', end: '2026-11-07', error: '' })
  assert.equal(clientPeriodRange('quarter', '2026-11-07').start, '2026-08-08')
  assert.equal(clientPeriodRange('semester', '2026-11-07').start, '2026-05-08')
  assert.equal(clientPeriodRange('year', '2026-11-07').start, '2025-11-08')
})

test('filtra as compras de cada período', () => {
  const today = '2026-11-07'
  assert.deepEqual(ids(salesInRange(sales, clientPeriodRange('all', today))), [1, 2, 3, 4, 5])
  assert.deepEqual(ids(salesInRange(sales, clientPeriodRange('month', today))), [1])
  assert.deepEqual(ids(salesInRange(sales, clientPeriodRange('quarter', today))), [1, 2])
  assert.deepEqual(ids(salesInRange(sales, clientPeriodRange('semester', today))), [1, 2, 3])
  assert.deepEqual(ids(salesInRange(sales, clientPeriodRange('year', today))), [1, 2, 3, 4])
})

test('período personalizado inclui as duas datas e valida o intervalo', () => {
  assert.deepEqual(ids(salesInRange(sales, clientPeriodRange('custom', '2026-11-07', '2026-06-15', '2026-09-20'))), [2, 3])
  const incomplete = clientPeriodRange('custom', '2026-11-07', '2026-06-15', '')
  assert.ok(incomplete.error)
  assert.deepEqual(salesInRange(sales, incomplete), [])
  assert.ok(clientPeriodRange('custom', '2026-11-07', '2026-09-20', '2026-06-15').error)
})

test('métricas somam só o período', () => {
  const m = salesMetrics(salesInRange(sales, clientPeriodRange('quarter', '2026-11-07')))
  assert.equal(m.count, 2)
  assert.equal(m.total, 1500)
  assert.equal(m.average, 750)
  assert.equal(m.lastSale.id, 1)
  assert.deepEqual(salesMetrics([]), { count: 0, total: 0, average: 0, lastSale: null })
})
