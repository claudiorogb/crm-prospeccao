import test from 'node:test'
import assert from 'node:assert/strict'
import { sortKanbanColumn } from '../src/kanban-order.js'

const lead = (id, status_changed_at, extra = {}) => ({ id, status_changed_at, ...extra })

test('a chegada mais recente fica sempre no fim da coluna', () => {
  const rows = [lead('c', '2026-09-16T15:00:00Z'), lead('a', '2026-09-16T12:00:00Z'), lead('b', '2026-09-16T14:00:00Z')]
  assert.deepEqual(sortKanbanColumn(rows).map(row => row.id), ['a', 'b', 'c'])
  assert.deepEqual(rows.map(row => row.id), ['c', 'a', 'b'], 'não modifica o array original')
})

test('uma nova mudança de fase leva o cartão para o fim, inclusive ao retornar à fase', () => {
  const rows = [lead('antigo', '2026-09-15T12:00:00Z'), lead('retornou', '2026-09-16T18:00:00Z')]
  assert.deepEqual(sortKanbanColumn(rows).map(row => row.id), ['antigo', 'retornou'])
})

test('edições em campos comerciais não alteram a posição na coluna', () => {
  const rows = [lead('novo', '2026-09-16T18:00:00Z', { updated_at: '2026-09-16T19:00:00Z' }), lead('antigo', '2026-09-16T17:00:00Z', { updated_at: '2026-09-16T20:00:00Z' })]
  assert.deepEqual(sortKanbanColumn(rows).map(row => row.id), ['antigo', 'novo'])
})

test('empates no horário possuem ordem determinística mesmo após recarga', () => {
  const rows = [lead('b', '2026-09-16T18:00:00Z'), lead('a', '2026-09-16T18:00:00Z')]
  assert.deepEqual(sortKanbanColumn(rows).map(row => row.id), ['a', 'b'])
  assert.deepEqual(sortKanbanColumn([...rows].reverse()).map(row => row.id), ['a', 'b'])
})

test('prévia terminal dos 50 recentes é exibida do mais antigo ao mais recente', () => {
  const rows = Array.from({ length: 50 }, (_, i) => lead(String(i).padStart(2, '0'), new Date(Date.UTC(2026, 8, 16, 0, i)).toISOString())).reverse()
  assert.deepEqual(sortKanbanColumn(rows).map(row => row.id), Array.from({ length: 50 }, (_, i) => String(i).padStart(2, '0')))
})
