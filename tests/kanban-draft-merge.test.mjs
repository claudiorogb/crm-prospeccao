import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeLeadsWithLocalDrafts } from '../src/kanban-draft-merge.js'

test('preserva nome, data e valor editados durante atualização periódica', () => {
  const local = [{ id: 'lead-a', contact_name: 'Maria', next_contact_date: '2026-09-18', proposal_value: '1.200,00', status: 'proposal' }]
  const remote = [{ id: 'lead-a', contact_name: 'Mar', next_contact_date: null, proposal_value: null, status: 'negotiation' }]
  const dirty = { 'lead-a': { contact_name: true, next_contact_date: true, proposal_value: true } }
  assert.deepEqual(mergeLeadsWithLocalDrafts(remote, local, dirty), [{
    id: 'lead-a', contact_name: 'Maria', next_contact_date: '2026-09-18', proposal_value: '1.200,00', status: 'negotiation'
  }])
})

test('outras atualizações do servidor e outros leads não são substituídos', () => {
  const local = [{ id: 'a', contact_name: 'Em edição', phone: 'antigo' }, { id: 'b', contact_name: 'Anterior' }]
  const remote = [{ id: 'a', contact_name: 'Antigo', phone: 'novo' }, { id: 'b', contact_name: 'Atualizado' }]
  assert.deepEqual(mergeLeadsWithLocalDrafts(remote, local, { a: { contact_name: true } }), [
    { id: 'a', contact_name: 'Em edição', phone: 'novo' },
    { id: 'b', contact_name: 'Atualizado' }
  ])
})

test('campos vazios editados não reaparecem e rascunhos já salvos deixam de bloquear o servidor', () => {
  const local = [{ id: 'a', contact_name: '', next_contact_date: '' }]
  const remote = [{ id: 'a', contact_name: 'Original', next_contact_date: '2026-09-18' }]
  assert.equal(mergeLeadsWithLocalDrafts(remote, local, { a: { contact_name: true, next_contact_date: true } })[0].contact_name, '')
  assert.deepEqual(mergeLeadsWithLocalDrafts(remote, local, {}), remote)
})
