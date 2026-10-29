import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLossReasonAnswer, lossReasonLabel } from '../src/loss-reasons.js'

test('número escolhe o motivo e guarda observação', () => {
  assert.deepEqual(parseLossReasonAnswer('1 achou caro'), { code: 'price', note: 'achou caro' })
  assert.deepEqual(parseLossReasonAnswer('2'), { code: 'competitor', note: '' })
})
test('texto livre vira Outro; vazio é recusado', () => {
  assert.deepEqual(parseLossReasonAnswer('não atendeu mais'), { code: 'other', note: 'não atendeu mais' })
  assert.equal(parseLossReasonAnswer('  '), null)
  assert.equal(parseLossReasonAnswer(null), null)
})
test('rótulo', () => { assert.equal(lossReasonLabel('price'), 'Preço'); assert.equal(lossReasonLabel('x'), '') })
