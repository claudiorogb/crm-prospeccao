import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const evolution = fs.readFileSync(new URL('../supabase/functions/whatsapp-inbound-webhook/index.ts', import.meta.url), 'utf8')
const meta = fs.readFileSync(new URL('../supabase/functions/whatsapp-meta-webhook/index.ts', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `função ${name} encontrada`)
  const bodyStart = source.indexOf('{', start)
  let depth = 0

  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }

  throw new Error(`fim da função ${name} não encontrado`)
}

function loadClassifier(source) {
  const normalize = extractFunction(source, 'normalizeText')
    .replace(/function normalizeText\(value:\s*string\)/, 'function normalizeText(value)')
  const classify = extractFunction(source, 'isAutomaticReply')
    .replace(/function isAutomaticReply\(text:\s*string\)/, 'function isAutomaticReply(text)')
  return new Function(`${normalize}\n${classify}\nreturn isAutomaticReply;`)()
}

for (const [provider, source] of [['Evolution', evolution], ['Meta', meta]]) {
  test(`${provider}: apresentação de atendente humano não é classificada como automática`, () => {
    const isAutomaticReply = loadClassifier(source)
    assert.equal(
      isAutomaticReply('Olá o grupo soul agradece seu contato, sou o Evandro e estarei prestando-lhe atendimento, como podemos ajudar?'),
      false,
    )
    assert.equal(isAutomaticReply('Não é necessário, utilizamos o CRM com nosso ERP.'), false)
  })

  test(`${provider}: mensagens automáticas sucessivas continuam fora do Kanban`, () => {
    const isAutomaticReply = loadClassifier(source)
    const automaticMessages = [
      'Esta é uma mensagem automática. Retornaremos assim que possível.',
      'Aguarde, estamos transferindo você para o setor responsável.',
      'Digite 1 para financeiro, 2 para suporte, 3 para vendas.',
      'Olá, sou a assistente virtual da empresa.',
    ]

    for (const message of automaticMessages) {
      assert.equal(isAutomaticReply(message), true, message)
    }
  })

  test(`${provider}: qualquer resposta humana move o lead para Respondeu, sem lista de fases permitidas`, () => {
    assert.match(source, /if\s*\(classification\s*===\s*"human"\s*\)/)
    assert.match(source, /status\s*:\s*"replied"/)
    assert.match(source, /\.neq\("status",\s*"discarded"\)/)
    assert.doesNotMatch(source, /classification\s*===\s*"human"\s*&&\s*\[[^\]]+\]\.includes\(lead\.status\)/)
    assert.doesNotMatch(source, /\.in\("status",\s*\["new",\s*"queued",\s*"contacted"/)
  })
}
