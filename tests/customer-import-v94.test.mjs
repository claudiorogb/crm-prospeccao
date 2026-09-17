import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import * as XLSX from 'xlsx'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/customer-import.jsx'), 'utf8')
const marker = '\nexport default function CustomerImportPanel'
assert.ok(source.includes(marker), 'the original import UI must be preserved')
const pure = source.slice(0, source.indexOf(marker))
  .replace(/^import React.*\n/m, '')
  .replace(/^import \{ FileSpreadsheet.*\n/m, '')
  .replace(/^import \{ supabase \}.*\n/m, '')
  + '\nexport { parseWorkbook, TEMPLATE_SHEETS }\n'
const temp = join(root, 'src/customer-import-v94-testing.mjs')
writeFileSync(temp, pure)
const { parseWorkbook, TEMPLATE_SHEETS } = await import(pathToFileURL(temp))
unlinkSync(temp)

function workbookFile(sheets) {
  const book = XLSX.utils.book_new()
  for (const [name, lines] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(lines), name)
  return new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })])
}

const customerHeaders = TEMPLATE_SHEETS[0][1]
const historyHeaders = TEMPLATE_SHEETS[1][1]
const saleHeaders = TEMPLATE_SHEETS[2][1]

test('template exposes three clean headers and all six requested client fields', () => {
  assert.deepEqual(TEMPLATE_SHEETS.map(entry => entry[0]), ['Clientes', 'Histórico', 'Vendas'])
  for (const field of ['Telefone','Cidade','UF','Site','E-mail','Razão Social']) assert.ok(customerHeaders.includes(field))
  assert.equal(customerHeaders[0], 'Empresa / Cliente')
})

test('client details, dated contact and monetary sale map correctly using client name', async () => {
  const customer = customerHeaders.map(header => ({
    'Empresa / Cliente':'Empresa Teste', 'Razão Social':'Empresa Teste Ltda', 'CNPJ / CPF':'12345678000190',
    'Telefone':'19999999999', Cidade:'Campinas', UF:'SP', Site:'https://example.com', 'E-mail':'contato@example.com'
  })[header] || '')
  const book = workbookFile({
    Clientes:[customerHeaders, customer],
    'Histórico':[historyHeaders, ['Empresa Teste','','15/09/2026','Ligação','Contato comercial']],
    Vendas:[saleHeaders, ['Empresa Teste','','15/09/2026',123.45,'Serviço','Venda teste']]
  })
  const { rows, errors } = await parseWorkbook(book)
  assert.deepEqual(errors, [])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].normalized_data.legal_name, 'Empresa Teste Ltda')
  assert.equal(rows[0].normalized_data.city, 'Campinas')
  assert.equal(rows[0].normalized_data.email, 'contato@example.com')
  assert.equal(rows[1].normalized_data.customer_key, rows[0].normalized_data.customer_key)
  assert.equal(rows[2].normalized_data.customer_key, rows[0].normalized_data.customer_key)
  assert.equal(rows[2].normalized_data.amount, '123.45')
})

test('instructions above header are flagged at the real sheet and line', async () => {
  const { errors } = await parseWorkbook(workbookFile({Clientes:[['Instruções da planilha'],customerHeaders,['Cliente exemplo']]}))
  assert.ok(errors.some(error => error.sheet_name==='Clientes' && error.row_number===1 && error.column==='Cabeçalhos'))
})

test('invalid dates and sale amounts identify their actual columns and lines', async () => {
  const { errors } = await parseWorkbook(workbookFile({
    Clientes:[customerHeaders,['Empresa Teste']],
    Vendas:[saleHeaders,['Empresa Teste','','31/02/2026','0']]
  }))
  assert.ok(errors.some(error => error.sheet_name==='Vendas' && error.row_number===2 && error.column==='Data'))
  assert.ok(errors.some(error => error.sheet_name==='Vendas' && error.row_number===2 && error.column==='Valor'))
})

test('ambiguous client names cannot silently attach sales to another customer', async () => {
  const { errors } = await parseWorkbook(workbookFile({
    Clientes:[customerHeaders,['Empresa Igual','','12345678000190'],['Empresa Igual','','12345678000191']],
    Vendas:[saleHeaders,['Empresa Igual','','15/09/2026',20]]
  }))
  assert.ok(errors.some(error => error.column==='Empresa / Cliente ou CNPJ / CPF' && error.row_number===2))
})
