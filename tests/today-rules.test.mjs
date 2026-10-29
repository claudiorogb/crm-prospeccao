import test from 'node:test'
import assert from 'node:assert/strict'
import { buildToday, riskAlert, isOverdue, isDueToday, isUpcoming, addDays, daysBetween } from '../src/today-rules.js'

const TODAY = '2026-10-29'
const base = { id: 'x', business_name: 'Empresa', next_contact_date: null, last_contact_date: null, last_contacted_at: null, proposal_sent_at: null }

test('respondeu parado há 3+ dias gera alerta; 2 dias não', () => {
  assert.equal(riskAlert({ ...base, status: 'replied', status_changed_at: '2026-10-26T15:00:00Z' }, TODAY)?.days, 3)
  assert.equal(riskAlert({ ...base, status: 'replied', status_changed_at: '2026-10-27T15:00:00Z' }, TODAY), null)
})

test('contato recente (envio pelo CRM) zera o alerta', () => {
  assert.equal(riskAlert({ ...base, status: 'replied', status_changed_at: '2026-10-20T15:00:00Z', last_contacted_at: '2026-10-28T12:00:00Z' }, TODAY), null)
})

test('retorno agendado para o futuro (ou hoje) suprime o alerta', () => {
  assert.equal(riskAlert({ ...base, status: 'proposal', proposal_sent_at: '2026-10-01', next_contact_date: '2026-10-31' }, TODAY), null)
  assert.equal(riskAlert({ ...base, status: 'proposal', proposal_sent_at: '2026-10-01', next_contact_date: TODAY }, TODAY), null)
})

test('proposta sem retorno há 7 dias e negociação há 5 dias geram alerta', () => {
  assert.equal(riskAlert({ ...base, status: 'proposal', proposal_sent_at: '2026-10-22' }, TODAY)?.days, 7)
  assert.equal(riskAlert({ ...base, status: 'proposal', proposal_sent_at: '2026-10-23' }, TODAY), null)
  assert.equal(riskAlert({ ...base, status: 'negotiation', status_changed_at: '2026-10-24T12:00:00Z' }, TODAY)?.days, 5)
})

test('gravidade alta quando passa do dobro do prazo', () => {
  assert.equal(riskAlert({ ...base, status: 'replied', status_changed_at: '2026-10-20T12:00:00Z' }, TODAY).severity, 'high')
  assert.equal(riskAlert({ ...base, status: 'replied', status_changed_at: '2026-10-25T12:00:00Z' }, TODAY).severity, 'medium')
})

test('etapas sem regra e leads encerrados não geram alerta', () => {
  assert.equal(riskAlert({ ...base, status: 'contacted', status_changed_at: '2026-01-01T00:00:00Z' }, TODAY), null)
  assert.equal(riskAlert({ ...base, status: 'won', status_changed_at: '2026-01-01T00:00:00Z' }, TODAY), null)
  assert.equal(riskAlert({ ...base, status: 'lost', status_changed_at: '2026-01-01T00:00:00Z' }, TODAY), null)
})

test('atrasado, hoje e próximos 7 dias seguem a regra dos retornos existentes', () => {
  assert.equal(isOverdue({ ...base, status: 'replied', next_contact_date: '2026-10-28' }, TODAY), true)
  // já contatado depois da data prevista: não é atraso
  assert.equal(isOverdue({ ...base, status: 'replied', next_contact_date: '2026-10-28', last_contact_date: '2026-10-28' }, TODAY), false)
  assert.equal(isOverdue({ ...base, status: 'won', next_contact_date: '2026-10-01' }, TODAY), false)
  assert.equal(isDueToday({ ...base, status: 'interested', next_contact_date: TODAY }, TODAY), true)
  assert.equal(isUpcoming({ ...base, status: 'interested', next_contact_date: '2026-11-05' }, TODAY), true)
  assert.equal(isUpcoming({ ...base, status: 'interested', next_contact_date: '2026-11-06' }, TODAY), false)
})

test('buildToday separa as listas e conta cada lead uma vez em "atenção"', () => {
  const leads = [
    { ...base, id: 'a', status: 'replied', next_contact_date: '2026-10-20', status_changed_at: '2026-10-10T12:00:00Z' }, // atrasado + risco
    { ...base, id: 'b', status: 'interested', next_contact_date: TODAY },
    { ...base, id: 'c', status: 'proposal', next_contact_date: '2026-11-02' },
    { ...base, id: 'd', status: 'negotiation', status_changed_at: '2026-10-01T12:00:00Z' }, // só risco
    { ...base, id: 'e', status: 'won', next_contact_date: '2026-10-01' }
  ]
  const r = buildToday(leads, TODAY)
  assert.deepEqual(r.overdue.map(l => l.id), ['a'])
  assert.deepEqual(r.dueToday.map(l => l.id), ['b'])
  assert.deepEqual(r.upcoming.map(l => l.id), ['c'])
  assert.deepEqual(r.risks.map(x => x.lead.id).sort(), ['a', 'd'])
  assert.equal(r.attentionCount, 2)
})

test('helpers de data', () => {
  assert.equal(addDays('2026-10-29', 3), '2026-11-01')
  assert.equal(daysBetween('2026-10-26', '2026-10-29'), 3)
})
