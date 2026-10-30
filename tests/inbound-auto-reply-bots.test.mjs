import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync('supabase/functions/whatsapp-inbound-webhook/index.ts', 'utf8')
const code = src.slice(src.indexOf('function normalizeText'), src.indexOf('// Desempate quando')).replace(/: string/g, '')
const isAuto = new Function(`${code};return isAutomaticReply`)()

const bots = [
  'Olá! Seja muito bem-vindo(a) à La Panela Brigaderia! 😊 Seu contato é muito importante para nós ♥️\nPara que possamos te atender da melhor forma, confira nossos catálogos aqui no WhatsApp e escolha a opção que deseja:\n1️⃣ *Fazer encomendas*\n2️⃣ *Contratar o Bar de Brigadeiros*\n3️⃣ *Clube de Vantagens LP*\n4️⃣ *Informações sobre delivery*\n5️⃣ *Outros assuntos*\nEnvie o número da opção desejada. 😉\nEm breve retornaremos o contato.',
  'Bem Vinda (o) a empresa *Unisabor*\nPor favor, informe seu nome.',
  'Qual é o seu nome?\n_(responda só com o nome, ex: Maria)_',
  'Olá! 😊 Aqui é o *assistente virtual* da Essencial Nutrição. Vou te direcionar para o setor certo em poucos passos. *Responda de forma curta*, por favor.'
]
test('mensagens de bots reais são classificadas como automáticas', () => {
  bots.forEach(text => assert.equal(isAuto(text), true, text.slice(0, 40)))
})
test('respostas humanas comuns continuam humanas', () => {
  for (const text of ['Tenho interesse, pode me ligar?', 'Bom dia! Quanto custa?', 'Meu nome é Carlos, pode falar', 'Pode enviar a proposta por e-mail', 'Não tenho interesse, obrigado'])
    assert.equal(isAuto(text), false, text)
})

test('reação (emoji) do WhatsApp é lida como texto da mensagem', () => {
  assert.match(src, /message\?\.reactionMessage\?\.text/)
})
