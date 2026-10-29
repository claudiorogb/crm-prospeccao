import test from 'node:test'
import assert from 'node:assert/strict'
import { findDuplicateGroups } from '../src/duplicates-rules.js'

test('detecta mesmo telefone com formatos diferentes e 9º dígito', () => {
  const g = findDuplicateGroups([
    { id: 1, phone: '(19) 99999-1111', created_at: '2026-01-02' },
    { id: 2, phone: '+55 19 99999 1111', created_at: '2026-01-01' },
    { id: 3, phone: '(19) 3333-4444' }
  ])
  assert.equal(g.length, 1)
  assert.deepEqual(g[0].leads.map(l => l.id), [2, 1])
})
test('e-mail e site, sem falsos positivos em vazios', () => {
  const g = findDuplicateGroups([
    { id: 1, email: 'A@x.com', website: 'https://www.loja.com.br/' },
    { id: 2, email: 'a@x.com', website: 'loja.com.br/contato' },
    { id: 3, email: '', website: '', phone: '' },
    { id: 4, email: '', website: '', phone: '' }
  ])
  assert.deepEqual(g.map(x => x.kind).sort(), ['email', 'site'])
})
