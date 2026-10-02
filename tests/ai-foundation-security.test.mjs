import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync(new URL('../supabase/functions/crm-ai-chat/index.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../supabase/migrations/20261001210642_ai_readonly_foundation.sql', import.meta.url), 'utf8')
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


test('interface da IA é habilitada somente por feature flag da organização', () => {
  assert.doesNotMatch(app, /VITE_AI_UI_ENABLED/)
  assert.match(app, /settings\?\.feature_flags\?\.ai_assistant === true/)
  assert.match(app, /adminSandboxSettings\?\.feature_flags\?\.ai_assistant === true/)
})

test('modelo inicial incorreto é normalizado para o identificador atual', () => {
  assert.match(edge, /configuredModel === "gpt-5\.6-luna"/)
  assert.match(edge, /"gpt-6-luna"/)
})


test('erro 429 do provedor preserva categoria segura e não expõe segredo', () => {
  assert.match(edge, /provider_http_\$\{providerResponse\.status\}_\$\{providerCode\}/)
  assert.match(edge, /code\.startsWith\("provider_http_429_"\)/)
  assert.doesNotMatch(edge, /OPENAI_API_KEY.*json\(/)
})

test('cliente tenta mostrar a mensagem segura retornada pela Edge Function', () => {
  assert.match(client, /error\.context/)
  assert.match(client, /payload\?\.error/)
})


test('tentativa explícita a outra empresa é bloqueada antes de leitura comercial', () => {
  const guardIndex = edge.indexOf('cross_tenant_request_blocked')
  const contextIndex = edge.indexOf('authorizedContext(userClient, organizationId, scopes)')
  assert.ok(guardIndex > -1)
  assert.ok(contextIndex > -1)
  assert.ok(guardIndex < contextIndex)
  assert.match(edge, /records_considered: 0/)
  assert.match(edge, /Não acesso, confirmo ou listo dados de outras empresas/)
})


test('base operacional define BRL para valores monetários de vendas', () => {
  const knowledge = fs.readFileSync(new URL('../supabase/functions/crm-ai-chat/knowledge.ts', import.meta.url), 'utf8')
  assert.match(knowledge, /Valores monetários de vendas no AXIVA CRM são tratados em reais \(BRL\)/)
  assert.match(knowledge, /apresente em R\$/)
})


test('base operacional define suporte online do CRM com passo a passo seguro', () => {
  const knowledge = fs.readFileSync(new URL('../supabase/functions/crm-ai-chat/knowledge.ts', import.meta.url), 'utf8')
  assert.match(knowledge, /SUPORTE ONLINE DO AXIVA CRM/)
  assert.match(knowledge, /passo a passo curto/)
  assert.match(knowledge, /nomes reais das áreas e botões conhecidos/)
  assert.match(knowledge, /Nunca invente botão, menu, campo, página, status, integração ou comportamento/)
  assert.match(knowledge, /suporte significa orientar e consultar; não significa executar alterações/)
})


test('nome do produto AXIVA CRM não dispara falso bloqueio de tenant', () => {
  assert.match(edge, /replace\(\/\\baxiva crm\\b\/g, " "\)/)
  assert.match(edge, /replace\(\/\\bcrm axiva\\b\/g, " "\)/)
})

test('bloqueio cross-tenant continua existindo após exceção do nome do produto', () => {
  assert.match(edge, /cross_tenant_request_blocked/)
  assert.match(edge, /containsOrganizationName\(message, String\(row\?\.name \|\| ""\)\)/)
})


test('base de suporte contém fluxo confirmado de campanha e captação', () => {
  const knowledge = fs.readFileSync(new URL('../supabase/functions/crm-ai-chat/knowledge.ts', import.meta.url), 'utf8')
  assert.match(knowledge, /INTERFACE CONFIRMADA — CAMPANHAS E CAPTAÇÃO/)
  assert.match(knowledge, /Campanhas > Público-alvo > botão "Novo público"/)
  assert.match(knowledge, /Campanhas > aba "Campanha" > botão "Nova campanha"/)
  assert.match(knowledge, /clique em "Captar automaticamente"/)
  assert.match(knowledge, /Criar a campanha não executa a captação e não envia mensagens/)
})


test('base contém mapa completo de suporte operacional confirmado', () => {
  const knowledge = fs.readFileSync(new URL('../supabase/functions/crm-ai-chat/knowledge.ts', import.meta.url), 'utf8')
  assert.match(knowledge, /MAPA CONFIRMADO DE SUPORTE — INTERFACE ATUAL/)
  assert.match(knowledge, /Campanhas > "Enviar mensagens"/)
  assert.match(knowledge, /"Prospecção por e-mail"/)
  assert.match(knowledge, /"E-mail marketing"/)
  assert.match(knowledge, /WhatsApp > "Cadastrar WhatsApp"/)
  assert.match(knowledge, /Funil de vendas > "Clientes"/)
  assert.match(knowledge, /"Importar clientes"/)
  assert.match(knowledge, /RETORNOS ATRASADOS/)
  assert.match(knowledge, /USUÁRIOS E PERMISSÕES/)
  assert.match(knowledge, /INTEGRAÇÕES/)
  assert.match(knowledge, /Não descreva código, banco, funções internas, tabelas ou arquitetura/)
})


test('base de suporte documenta fluxo atual de usuários e permissões', () => {
  const knowledge = fs.readFileSync(new URL('../supabase/functions/crm-ai-chat/knowledge.ts', import.meta.url), 'utf8')
  assert.match(knowledge, /USUÁRIOS — FLUXO ATUAL CONFIRMADO/)
  assert.match(knowledge, /Criar uma conta no AXIVA CRM não vincula automaticamente/)
  assert.match(knowledge, /Administração > "Usuários"/)
  assert.match(knowledge, /Administração > "Organizações"/)
  assert.match(knowledge, /Administrador comum da empresa não possui hoje uma tela própria/)
  assert.match(knowledge, /Não invente uma tela "Usuários" dentro da área comercial/)
})


test('base de suporte documenta permissões confirmadas por papel', () => {
  const knowledge = fs.readFileSync(new URL('../supabase/functions/crm-ai-chat/knowledge.ts', import.meta.url), 'utf8')
  assert.match(knowledge, /PERMISSÕES CONFIRMADAS POR PAPEL/)
  assert.match(knowledge, /captação de leads via Google Places é restrita/)
  assert.match(knowledge, /Importação de clientes é restrita/)
  assert.match(knowledge, /Cadastrar, conectar, alterar ou remover números de WhatsApp é restrito/)
  assert.match(knowledge, /Conectar ou alterar a conta de e-mail da empresa é restrito/)
  assert.match(knowledge, /não há uma função operacional confirmada que seja exclusiva de "Proprietário"/)
})


test('análise comercial não carrega manual completo por padrão', () => {
  assert.match(edge, /function isSupportQuestion\(message: string\)/)
  assert.match(edge, /support: isSupportQuestion\(message\)/)
  assert.match(edge, /else if \(options\.support\)/)
  assert.match(edge, /max_output_tokens: 2400/)
})

test('resposta incompleta do provedor recebe diagnóstico específico', () => {
  assert.match(edge, /provider_incomplete_/)
  assert.match(edge, /incomplete_details/)
})


test('priorização comercial usa oportunidades concretas e rejeita saída incompleta', () => {
  assert.match(edge, /priority_items/)
  assert.match(edge, /business_name,status,source,next_contact_date/)
  assert.match(edge, /negotiation: 1/)
  assert.match(edge, /proposal: 2/)
  assert.match(edge, /interested: 3/)
  assert.match(edge, /max_output_tokens: 2400/)
  assert.match(edge, /if \(providerStatus === "incomplete" \|\| incompleteReason\)/)
  assert.match(edge, /apresente no máximo 5 prioridades/)
})


test('assistente flutuante permanece disponível nas páginas quando a IA está habilitada', () => {
  assert.match(app, /AiFloatingAssistant/)
  assert.match(app, /settings\?\.feature_flags\?\.ai_assistant === true/)
  assert.match(app, /adminSandboxSettings\?\.feature_flags\?\.ai_assistant === true/)
})

test('respostas da IA não exibem marcadores markdown de negrito literalmente', () => {
  const assistant = fs.readFileSync(new URL('../src/ai-assistant.jsx', import.meta.url), 'utf8')
  assert.match(assistant, /function InlineText/)
  assert.match(assistant, /part\.slice\(2, -2\)/)
  assert.doesNotMatch(assistant, /<p>\{item\.content\}<\/p>/)
})


test('base de Sales Coach é carregada por intenção sem substituir suporte do CRM', () => {
  assert.match(edge, /function isSalesCoachingQuestion\(message: string\)/)
  assert.match(edge, /salesCoach: isSalesCoachingQuestion\(message\)/)
  assert.match(edge, /if \(options\.salesCoach\)/)
  assert.match(edge, /else if \(options\.support\)/)
  assert.match(knowledge, /AXIVA_SALES_COACH_KNOWLEDGE/)
  assert.match(knowledge, /SPIN SELLING/)
  assert.match(knowledge, /CHALLENGER SALE/)
  assert.match(knowledge, /LAER/)
  assert.match(knowledge, /GPCTBA/)
  assert.match(knowledge, /ROLEPLAY/)
  assert.match(knowledge, /REVISÃO DE DISCURSO E SCRIPTS/)
})
