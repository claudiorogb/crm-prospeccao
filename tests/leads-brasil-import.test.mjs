import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isLeadsBrasilRow, normalizeLeadsBrasilRow } from '../src/leads-brasil-import.js'

const import_ = readFileSync('src/customer-import.jsx', 'utf8')

// Linha no formato do download do Leads Brasil (colunas e nomes reais do app)
const xlsx = {
  'Nota': 'A', 'Pontos': 9, 'Por quê': 'decisor, celular', 'Empresa': 'Padaria Boa Massa', 'Decisor': 'Maria Souza', 'Cargo': 'Sócio-Administrador',
  'WhatsApp': '(19) 98888-7777', 'Telefone 1': '(19) 98888-7777', 'Tipo tel. 1': 'Celular', 'Telefone 2': '', 'Tipo tel. 2': '',
  'E-mail': 'Contato@BoaMassa.com.br', 'Site': 'www.boamassa.com.br', 'Alertas': '', 'Ver no Google Maps': 'Abrir Maps',
  'LinkedIn da empresa': 'Buscar empresa', 'Buscar site no Google': 'Buscar site', 'Decisor no Google': 'Buscar',
  'Sócio 2': '', 'Sócio 3': '', 'Sócios / administradores': 'Maria Souza (Sócio-Administrador)', 'Razão social': 'BOA MASSA PADARIA LTDA',
  'Nome fantasia': 'Boa Massa', 'CNPJ': '12.345.678/0001-90', 'CNAE': '1091-1/02', 'Atividade principal': 'Padaria', 'Porte': 'Microempresa',
  'MEI': 'Não', 'Matriz/Filial': 'Matriz', 'Filiais no estado': 0, 'Abertura': '10/03/2015', 'Capital social (R$)': 10000,
  'Endereço': 'Rua das Flores, 100, sala 2', 'Bairro': 'Centro', 'CEP': '13010-000', 'Cidade': 'Campinas', 'UF': 'SP'
}

test('reconhece o arquivo do Leads Brasil e não confunde com planilha comum', () => {
  assert.equal(isLeadsBrasilRow(xlsx), true)
  assert.equal(isLeadsBrasilRow({ 'Empresa / Cliente': 'X', 'CNPJ / CPF': '1', Telefone: '2', Cidade: 'A', UF: 'SP' }), false)
  assert.equal(isLeadsBrasilRow({ Empresa: 'X', CNPJ: '1', Decisor: 'Y' }), false)
})

test('leva só o essencial: empresa, responsável, e-mail, telefone, endereço e CNPJ', () => {
  const n = normalizeLeadsBrasilRow(xlsx)
  assert.equal(n.business_name, 'Padaria Boa Massa')
  assert.equal(n.contact_name, 'Maria Souza')
  assert.equal(n.contact_role, 'Sócio-Administrador')
  assert.equal(n.email, 'contato@boamassa.com.br')
  assert.equal(n.phone, '19988887777')
  assert.equal(n.address, 'Rua das Flores, 100, sala 2, Centro, 13010-000')
  assert.equal(n.city, 'Campinas')
  assert.equal(n.state, 'SP')
  assert.equal(n.tax_id, '12345678000190')
  assert.equal(n.customer_key, 'tax:12345678000190')
  assert.equal(n.customer_origin, 'Leads Brasil')
})

test('ignora o resto (site, WhatsApp, segmento, observações)', () => {
  const n = normalizeLeadsBrasilRow(xlsx)
  for (const campo of ['website', 'whatsapp_phone', 'segment', 'commercial_notes', 'next_contact_date']) assert.equal(n[campo], '', campo)
})

test('CSV: colunas com link não viram nome nem telefone; nome vem dos sócios', () => {
  const csv = { ...xlsx, Decisor: 'https://www.linkedin.com/search/results/people/?keywords=%22Maria%22', Cargo: '', 'Telefone 1': '(19) 3333-4444' }
  const n = normalizeLeadsBrasilRow(csv)
  assert.equal(n.contact_name, 'Maria Souza')
  assert.equal(n.phone, '1933334444')
})

test('sem CNPJ usa o nome; e-mail inválido é descartado', () => {
  const n = normalizeLeadsBrasilRow({ ...xlsx, CNPJ: '', 'E-mail': 'sem-arroba' })
  assert.equal(n.customer_key, 'name:padaria boa massa')
  assert.equal(n.email, '')
})

test('importação normal continua igual e o modo novo só entra pela detecção', () => {
  assert.match(import_, /if \(isLeadsBrasilRow\(row\)\) return normalizeLeadsBrasilRow\(row\)\n  const out = \{\}/)
  assert.match(import_, /MAX_ROWS = 5000/)
  assert.match(import_, /MAX_FILE_BYTES = 5 \* 1024 \* 1024/)
  assert.match(import_, /commit_customer_import/)
  assert.match(import_, /Arquivo do Leads Brasil reconhecido/)
})
