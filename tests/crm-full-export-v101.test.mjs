import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { EXPORT_DATASETS, buildCrmExportSheets, createCrmWorkbook, fetchCrmExport } from '../src/crm-full-export-core.js'

const org = '00000000-0000-4000-8000-000000000001'
const otherOrg = '00000000-0000-4000-8000-000000000002'
const leadId = '00000000-0000-4000-8000-000000000010'
const clientId = '00000000-0000-4000-8000-000000000011'
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const blank = () => Object.fromEntries(EXPORT_DATASETS.map(kind => [kind, []]))
const source = readFileSync(new URL('../src/crm-full-export.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sql = readFileSync(new URL('../supabase/migrations/20260918153000_v101_secure_full_crm_export.sql', import.meta.url), 'utf8')

function sampleRecords() {
  return {
    leads: [{ id: leadId, organization_id: org, business_name: '=INJETAR()', status: 'lost',
      status_changed_at: '2026-09-17T21:00:00Z', commercial_notes: '=1+1',
      proposal_value: 1234.56, created_at: '2026-09-15T10:00:00Z' }],
    clients: [{ id: clientId, organization_id: org, business_name: 'Cliente', status: 'won',
      source: 'import', deleted_at: '2026-09-18T11:00:00Z', created_at: '2026-09-15T10:00:00Z' }],
    activities: [{ id: uuid(21), organization_id: org, lead_id: clientId,
      activity_type: 'call', channel: 'phone', notes: '@danger', occurred_at: '2026-09-16T13:00:00Z' }],
    journey: [{ id: '44', organization_id: org, lead_id: leadId, stage: 'lost', note: 'Proposta recusada', created_at: '2026-09-17T21:00:00Z' }],
    tasks: [{ id: clientId, organization_id: org, business_name: 'Cliente', status: 'won', next_contact_date: '2026-09-19' }],
    sales: [{ id: uuid(31), organization_id: org, lead_id: clientId,
      amount: 199.9, origin: 'import', sale_date: '2026-09-16', product_service: 'Assinatura' }]
  }
}

test('creates exactly five Excel sheets, with stable IDs connecting client, activity, task and sale', () => {
  const sheets = buildCrmExportSheets(sampleRecords(), '2026-09-18')
  assert.deepEqual(sheets.map(sheet => sheet.name), ['Leads', 'Clientes', 'Contatos', 'Tarefas', 'Vendas'])
  const byName = Object.fromEntries(sheets.map(sheet => [sheet.name, sheet]))
  assert.equal(byName.Leads.rows[0][0], leadId)
  assert.equal(byName.Clientes.rows[0][0], clientId)
  assert.equal(byName.Contatos.rows[0][1], clientId)
  assert.equal(byName.Contatos.rows[1][1], leadId)
  assert.equal(byName.Tarefas.rows[0][1], clientId)
  assert.equal(byName.Vendas.rows[0][1], clientId)
  assert.equal(byName.Vendas.rows[0][4], 199.9)
  assert.equal(byName.Leads.rows[0][20], 1234.56)
  assert.equal(byName.Leads.rows[0][25], '2026-09-17')
  assert.equal(byName.Clientes.rows[0][30], '2026-09-18T11:00:00Z')
  assert.equal(byName.Tarefas.rows[0][6], 'Pendente')
})

test('builds valid XLSX; untrusted user content is always a string, never a spreadsheet formula', () => {
  const workbook = createCrmWorkbook(XLSX, sampleRecords(), '2026-09-18')
  assert.deepEqual(workbook.SheetNames, ['Leads', 'Clientes', 'Contatos', 'Tarefas', 'Vendas'])
  assert.equal(workbook.Sheets.Leads.B2.t, 's')
  assert.equal(workbook.Sheets.Leads.B2.f, undefined)
  assert.equal(workbook.Sheets.Leads.B2.v, "'=INJETAR()")
  assert.equal(workbook.Sheets.Leads.AA2.v, "'=1+1")
  assert.equal(workbook.Sheets.Contatos.H2.v, "'@danger")
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true })
  const restored = XLSX.read(bytes, { type: 'buffer' })
  assert.deepEqual(restored.SheetNames, workbook.SheetNames)
  assert.equal(restored.Sheets.Vendas.E2.v, 199.9)
})

test('empty CRM still downloads the five appropriately headed tabs', () => {
  const workbook = createCrmWorkbook(XLSX, blank(), '2026-09-18')
  assert.equal(workbook.SheetNames.length, 5)
  for (const name of workbook.SheetNames) assert.ok(workbook.Sheets[name].A1?.v)
})

test('export RPC fetches all pages, not only the 50 terminal Kanban cards or current month', async () => {
  const first = Array.from({ length: 500 }, (_, index) => ({ id: uuid(index + 100), organization_id: org }))
  const extra = [{ id: uuid(600), organization_id: org }]
  const calls = []
  const supabase = { rpc: async (name, params) => {
    calls.push({ name, ...params })
    if (params.p_dataset !== 'leads') return { data: [], error: null }
    return { data: params.p_after_id ? extra : first, error: null }
  } }
  const result = await fetchCrmExport(supabase, org)
  assert.equal(result.leads.length, 501)
  assert.equal(calls.length, 7)
  assert.deepEqual(calls.map(call => call.p_dataset), ['leads', 'leads', 'clients', 'activities', 'journey', 'tasks', 'sales'])
  assert.equal(calls[1].p_after_id, first[499].id)
  assert.ok(calls.every(call => call.name === 'export_crm_data_page' && call.p_organization_id === org))
})

test('aborts on cross-company data or RPC authorization errors without creating a workbook', async () => {
  const wrongTenant = { rpc: async () => ({ data: [{ id: leadId, organization_id: otherOrg }], error: null }) }
  await assert.rejects(fetchCrmExport(wrongTenant, org), /empresa ou registro incompatível/)
  const forbidden = { rpc: async () => ({ data: null, error: { message: 'permission denied' } }) }
  await assert.rejects(fetchCrmExport(forbidden, org), /permission denied/)
})

test('server enforces auth, active owner/admin and exact organization; no other database objects are changed', () => {
  assert.match(sql, /SECURITY DEFINER/)
  assert.match(sql, /auth\.uid\(\) IS NULL OR NOT EXISTS/)
  assert.match(sql, /m\.user_id = auth\.uid\(\)/)
  assert.match(sql, /m\.role IN \('owner', 'admin'\)/)
  assert.match(sql, /m\.deleted_at IS NULL/)
  assert.match(sql, /p\.account_status = 'active'/)
  assert.match(sql, /o\.deleted_at IS NULL/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.export_crm_data_page\(uuid, text, text, integer\) FROM PUBLIC, anon/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.export_crm_data_page\(uuid, text, text, integer\) TO authenticated/)
  for (const table of ['leads', 'activities', 'lead_journey_entries', 'sales']) {
    assert.match(sql, new RegExp(`FROM public\\.${table} AS`))
  }
  assert.equal((sql.match(/WHERE [a-z]\.organization_id = p_organization_id/g) || []).length, 5)
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|ALTER TABLE|DROP TABLE|CREATE POLICY)\b/i)
})

test('full export is available only from Clientes and only to verified owner/admin; legacy export remains', () => {
  const clients = app.slice(app.indexOf('function Clients('), app.indexOf('function Messages('))
  assert.equal((clients.match(/<CrmFullExport organization=\{organization\} userId=\{userId\} \/>/g) || []).length, 1)
  assert.ok(clients.indexOf('<CrmFullExport') > clients.indexOf('<CustomerImportPanel'))
  assert.match(app, /function LeadExportPanel\(/)
  assert.match(source, /supabase\.auth\.getUser\(\)/)
  assert.match(source, /\.in\('role', \['owner', 'admin'\]\)/)
  assert.match(source, /if \(!authorized\) return null/)
  assert.match(source, /fetchCrmExport\(supabase, orgId/)
  assert.match(source, /XLSX\.writeFile\(workbook, `AXIVA_CRM_/)
  assert.doesNotMatch(source, /service_role|serviceRole|SUPABASE_SERVICE_ROLE/i)
})
