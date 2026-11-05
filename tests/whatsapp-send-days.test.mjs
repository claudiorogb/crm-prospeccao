import test from 'node:test'
import assert from 'node:assert/strict'
import { firstSendWeekday, validDelays, planFollowups } from '../src/whatsapp-send-days.js'

const DAYS = [1, 3, 5]
// 2026-11-05 (quinta) 10:00 em Brasília
const thursday = Date.parse('2026-11-05T10:00:00-03:00')

test('quinta: a 1ª mensagem sai na sexta', () => {
  assert.equal(firstSendWeekday({ days: DAYS, end: '18:00', now: thursday }), 5)
})
test('segunda dentro do horário: sai hoje; depois do fim: sai quarta', () => {
  assert.equal(firstSendWeekday({ days: DAYS, end: '18:00', now: Date.parse('2026-11-09T10:00:00-03:00') }), 1)
  assert.equal(firstSendWeekday({ days: DAYS, end: '18:00', now: Date.parse('2026-11-09T19:00:00-03:00') }), 3)
})
test('da sexta: 3 dias cai segunda (ok), 2 e 4 caem fim de semana/terça (bloqueados); da segunda: 5 dias cai sábado (bloqueado)', () => {
  const fromFriday = validDelays({ days: DAYS, fromWeekday: 5 })
  assert.ok(fromFriday.includes(3) && !fromFriday.includes(2) && !fromFriday.includes(4))
  const fromMonday = validDelays({ days: DAYS, fromWeekday: 1 })
  assert.ok(!fromMonday.includes(5) && fromMonday.includes(2) && fromMonday.includes(4))
})
test('planFollowups ajusta 3 e 5 quando a 1ª mensagem sai na sexta', () => {
  const plan = planFollowups({ days: DAYS, end: '18:00', now: thursday, step1: 3, step2: 5 })
  assert.equal(plan.d1, 3)
  assert.equal(plan.weekday1, 1)
  assert.ok(plan.options2.every(day => DAYS.includes((plan.weekday1 + day) % 7)))
  assert.equal(plan.d2, 7)
  assert.equal(plan.adjusted2, true)
  assert.ok(DAYS.includes(plan.weekday2))
})
