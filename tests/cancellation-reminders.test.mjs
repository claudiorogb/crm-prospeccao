import test from 'node:test'
import assert from 'node:assert/strict'
import { daysBetween, formatBR, reminderKind, buildReminderMail } from '../supabase/functions/cancellation-access-reminders/rules.js'

test('conta os dias até o fim do acesso, inclusive na virada de mês e ano', () => {
  assert.equal(daysBetween('2026-11-07', '2026-11-07'), 0)
  assert.equal(daysBetween('2026-11-07', '2026-11-14'), 7)
  assert.equal(daysBetween('2026-10-29', '2026-11-01'), 3)
  assert.equal(daysBetween('2026-12-30', '2027-01-06'), 7)
})

test('envia lembrete só em 7 dias, 3 dias e no último dia', () => {
  assert.equal(reminderKind(7, false), 'd7')
  assert.equal(reminderKind(3, false), 'd3')
  assert.equal(reminderKind(0, false), 'd0')
  for (const d of [30, 8, 6, 5, 4, 2, 1, -1]) assert.equal(reminderKind(d, false), null, `dia ${d}`)
})

test('no dia do cancelamento não envia lembrete (a confirmação acabou de sair)', () => {
  for (const d of [7, 3, 0]) assert.equal(reminderKind(d, true), null)
})

test('e-mails trazem a data, dizem que os dados ficam e não prometem reativação', () => {
  assert.equal(formatBR('2026-11-07'), '07/11/2026')
  for (const kind of ['d7', 'd3', 'd0']) {
    const mail = buildReminderMail(kind, '2026-11-14')
    assert.match(mail.html, /14\/11\/2026/)
    assert.match(mail.text, /14\/11\/2026/)
    assert.match(mail.text, /dados não serão apagados/)
    assert.doesNotMatch(mail.text, /<|&nbsp;/)
  }
  assert.match(buildReminderMail('d7', '2026-11-14').subject, /7 dias/)
  assert.match(buildReminderMail('d3', '2026-11-14').subject, /3 dias/)
  assert.match(buildReminderMail('d0', '2026-11-14').subject, /último dia/)
  assert.throws(() => buildReminderMail('x', '2026-11-14'))
})

import { noticeText, hideKey } from '../src/cancellation-notice.js'
test('texto da faixa: último dia, amanhã e dias restantes', () => {
  assert.match(noticeText(0, '2026-11-07'), /hoje é o último dia.*07\/11\/2026/)
  assert.match(noticeText(1, '2026-11-08'), /termina amanhã.*08\/11\/2026/)
  assert.match(noticeText(7, '2026-11-14'), /até 14\/11\/2026 \(faltam 7 dias\)/)
  assert.notEqual(hideKey('u1', '2026-11-07'), hideKey('u1', '2026-11-08'))
})
