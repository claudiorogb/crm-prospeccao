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
  assert.match(app, /crm_sso=\$\{encodeURIComponent\(data\.session\.access_token\)\}/)
  assert.match(app, /onClick=\{openLeadsBrasil\}/)
})

test('a página tem as duas listas e envia pelo RPC com destino válido', () => {
  assert.match(lists, /Lista de leads/)
  assert.match(lists, /Lista de clientes/)
  assert.match(lists, /rpc\('move_import_leads'/)
  assert.match(lists, /moveTarget: 'customers'/)
  assert.match(lists, /moveTarget: 'prospects'/)
  assert.doesNotMatch(lists, /eq\('source'/) // leads do Google, manuais e importados aparecem juntos
})

test('importação envia o destino e a lista de prospecção ignora duplicados', () => {
  assert.match(imp, /file_sha256: hash, destination/)
  assert.match(imp, /destination === 'prospects' \? 'skip'/)
  assert.match(imp, /Lista de leads/)
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

test('as listas têm os 3 envios, mostram a última mensagem por canal e funcionam na conta de teste', () => {
  assert.match(lists, /crm_email_preselect/)
  assert.match(lists, /crm_marketing_preselect/)
  assert.match(lists, /crm_whatsapp_preselect/)
  assert.match(lists, /rpc\('lead_last_messages'/)
  assert.match(lists, /Últimas mensagens/)
  assert.match(lists, /not\('status', 'in', '\(won,lost,not_interested,discarded\)'\)/)
  // as telas de envio leem a seleção
  assert.match(app, /crm_whatsapp_preselect/)
  assert.match(read('src/email-marketing.jsx'), /crm_marketing_preselect/)
  // conta de teste: as duas áreas de teste recebem a aba e o administrador do sistema
  assert.equal((app.match(/isSystemAdmin\r?\n?\s*\/>/g) || []).length >= 2, true)
  assert.equal((app.match(/<Link2 size=\{18\}\/> Leads Brasil/g) || []).length, 0) // fora do menu lateral
  // Leads Brasil dentro da página de captação
  assert.match(app, /capture-leads-brasil/)
})

test('listas: mais recentes primeiro, 20 por página e e-mail mkt pela lista com consentimento', () => {
  assert.match(lists, /LIST_PAGE_SIZE = 20/)
  assert.match(lists, /order\('created_at', \{ ascending: false \}\)/)
  assert.match(lists, /Página \{safePage\} de \{pageCount\}/)
  // e-mail marketing aceita clientes e leads (só exige e-mail válido e sem pedido de saída)
  assert.doesNotMatch(lists, /status === 'won' && validEmail/)
  assert.match(read('src/email-marketing.jsx'), /setSelectedMarketing\(new Set\(listIds\)\)/)
})

test('selection from Lista de clientes stays on the send page until the send finishes', async () => {
  const { readFileSync } = await import('node:fs')
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const mkt = readFileSync(new URL('../src/email-marketing.jsx', import.meta.url), 'utf8')
  for (const key of ['crm_whatsapp_preselect']) assert.match(app, new RegExp(`removeItem\\('${key}'\\)`))
  for (const key of ['crm_email_preselect', 'crm_marketing_preselect']) assert.match(mkt, new RegExp(`removeItem\\('${key}'\\)`))
  assert.equal((mkt.match(/getItem\('crm_email_preselect'\)[^\n]*\n\s*sessionStorage\.removeItem/g) || []).length, 0)
})
