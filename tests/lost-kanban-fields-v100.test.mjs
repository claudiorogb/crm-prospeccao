import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const start = app.indexOf('function Leads(')
const end = app.indexOf('function Clients(', start)
assert.ok(start >= 0 && end > start, 'Leads component must exist')
const leads = app.slice(start, end)

test('Lost cards do not show their next-contact date or no-return prompt, other cards retain it', () => {
  assert.match(leads, /\{status !== 'lost' && \(\s*<div className=\{`kanban-due-v70/)
  assert.match(leads, /formatKanbanDate\(l\.next_contact_date\)/)
  assert.match(leads, /Sem retorno previsto/)
  assert.match(leads, /const tracksReturnDeadline = \['replied', 'interested', 'proposal', 'negotiation'\]\.includes\(status\)/)
})

test('Contract amount and signature inputs remain on Won and disappear on Lost', () => {
  const won = leads.indexOf("{status === 'won' && (\n                            <div className=\"kanban-two-fields\">")
  const declined = leads.indexOf("{status === 'lost' && (\n                            <label>", won)
  assert.ok(won >= 0 && declined > won)
  const wonOnly = leads.slice(won, declined)
  assert.match(wonOnly, /Valor do contrato/)
  assert.match(wonOnly, /Data da assinatura do contrato/)
  assert.match(wonOnly, /contract_value/)
  assert.match(wonOnly, /contract_signed_at/)
  assert.equal((leads.match(/<span>Valor do contrato<\/span>/g) || []).length, 1)
  assert.equal((leads.match(/<span>Data da assinatura do contrato<\/span>/g) || []).length, 1)
})

test('Lost date is the genuine transition timestamp, São Paulo local date, not signature date', () => {
  assert.match(leads, /function formatLostDeclineDate\(value\)/)
  assert.match(leads, /timeZone: 'America\/Sao_Paulo'/)
  assert.match(leads, /\{status === 'lost' && \(\s*<label>\s*<span>Data de declínio da proposta<\/span>/)
  assert.match(leads, /value=\{formatLostDeclineDate\(l\.status_changed_at\)\}\s*readOnly/)
  assert.match(leads, /\.select\('status_changed_at'\)/)
  assert.match(leads, /\.eq\('organization_id', organization\.id\)/)
  const formatter = leads.slice(leads.indexOf('function formatLostDeclineDate('), leads.indexOf('function toggleLeadExpanded('))
  assert.doesNotMatch(formatter, /contract_signed_at/)
})

test('Existing stages, data saving and tenant boundaries remain unchanged', () => {
  assert.match(leads, /const closedStage = \['won','lost'\]\.includes\(status\)/)
  assert.match(leads, /p_contract_signed_at: lead\.contract_signed_at \|\| null/)
  assert.match(leads, /p_contract_value: contractValue/)
  assert.match(leads, /status === 'lost' && \(\s*<button[^>]+recover-lead-v54/s)
  assert.match(leads, /\.eq\('organization_id', organization\.id\)/)
})
