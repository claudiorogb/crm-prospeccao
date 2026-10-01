import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync(new URL('../supabase/functions/crm-ai-chat/index.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../supabase/migrations/20261001200000_ai_readonly_foundation.sql', import.meta.url), 'utf8')
const client = fs.readFileSync(new URL('../src/ai-client.js', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')

test('tenant não é recebido do navegador', () => {
  assert.doesNotMatch(edge, /body\?\.organization_id|body\[['"]organization_id['"]\]/)
  assert.doesNotMatch(client, /organization_id/)
  assert.match(edge, /from\("organization_members"\)/)
  assert.match(edge, /\.eq\("user_id", user\.id\)/)
})

test('consultas comerciais da IA são somente leitura', () => {
  const commercialTables = [
    'leads',
    'sales',
    'campaigns',
    'activities',
    'outbound_messages',
    'outbound_batches',
    'whatsapp_conversations',
    'whatsapp_messages',
    'email_campaigns',
  ]

  for (const table of commercialTables) {
    for (const quote of ['"', "'"]) {
      const needle = `.from(${quote}${table}${quote})`
      let start = 0

      while (true) {
        const index = edge.indexOf(needle, start)
        if (index === -1) break

        const chain = edge.slice(index, index + 700)
        assert.doesNotMatch(
          chain,
          /\.(insert|update|upsert|delete)\s*\(/,
          `a IA não pode modificar ${table}`,
        )
        start = index + needle.length
      }
    }
  }
})

test('chave do provedor nunca é variável de frontend', () => {
  assert.match(edge, /Deno\.env\.get\("OPENAI_API_KEY"\)/)
  assert.doesNotMatch(edge, /VITE_OPENAI/)
  assert.doesNotMatch(client, /OPENAI_API_KEY|VITE_OPENAI/)
})

test('tabelas internas da IA ficam fechadas para anon e authenticated', () => {
  for (const table of ['ai_organization_settings', 'ai_conversations', 'ai_messages', 'ai_request_audit']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`))
  }
})

test('fundação permanece dormente no frontend atual', () => {
  assert.doesNotMatch(app, /ai-client|crm-ai-chat|askAxivaAi/)
  assert.doesNotMatch(main, /ai-client|crm-ai-chat|askAxivaAi/)
})

test('função falha fechada sem habilitação explícita', () => {
  assert.match(edge, /Deno\.env\.get\("AI_ENABLED"\) !== "true"/)
  assert.match(edge, /ai_organization_settings/)
  assert.match(edge, /!aiSetting\?\.enabled/)
})

test('contexto padrão exclui conteúdo de mensagem, email e dados pessoais sensíveis', () => {
  assert.doesNotMatch(edge, /select\(["'][^"']*(phone|email|cnpj|commercial_notes|text_body|rendered_message)[^"']*["']\)/)
})
