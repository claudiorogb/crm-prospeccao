import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const lists = read('src/import-lists.jsx')
const imp = read('src/customer-import.jsx')
const sql = read('supabase/migrations/20261104120000_import_destination_and_list_move.sql')

test('Campanhas tem a aba "Lista de clientes" no fim e o link do Leads Brasil', () => {
  assert.match(app, /\['lists','Lista de clientes'\]\s*\n\s*\]/)
  assert.match(app, /section === 'lists' && <ImportLists/)
  assert.match(app, /LEADS_BRASIL_URL = 'https:\/\/leads-sp\.vercel\.app'/)
  assert.match(app, /rel="noopener noreferrer"/)
})

test('a página tem as duas listas e envia pelo RPC com destino válido', () => {
  assert.match(lists, /Lista de prospecção/)
  assert.match(lists, /Lista de clientes/)
  assert.match(lists, /rpc\('move_import_leads'/)
  assert.match(lists, /moveTarget: 'customers'/)
  assert.match(lists, /moveTarget: 'prospects'/)
  assert.match(lists, /eq\('source', 'import'\)/)
})

test('importação envia o destino e a lista de prospecção ignora duplicados', () => {
  assert.match(imp, /file_sha256: hash, destination/)
  assert.match(imp, /destination === 'prospects' \? 'skip'/)
  assert.match(imp, /Lista de prospecção/)
  assert.match(imp, /Lista de clientes/)
})

test('migração: destino padrão é clientes e "ganho" segue terminal', () => {
  assert.match(sql, /destination text not null default 'customers'/)
  assert.match(sql, /check \(destination in \('customers','prospects'\)\)/)
  assert.match(sql, /Negócio ganho é etapa terminal/)
  assert.match(sql, /current_user in \('postgres','supabase_admin'\)/)
  assert.match(sql, /revoke all on function public\.move_import_leads\(uuid\[\], text\) from public, anon/)
  assert.match(sql, /has_org_role\(v_lead\.organization_id, array\['owner','admin'\]\)/)
})
