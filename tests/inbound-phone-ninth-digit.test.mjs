import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../supabase/functions/whatsapp-inbound-webhook/index.ts', import.meta.url), 'utf8')

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `função ${name} encontrada`)
  const bodyStart = source.indexOf('{', source.indexOf(')', start))
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

function stripTypes(code) {
  return code
    .replace(/\(value: unknown\)/g, '(value)')
    .replace(/\(lead: any, senderPhone: string\)/g, '(lead, senderPhone)')
}

const { leadMatchesPhone, phoneMatchKey } = new Function(
  ['digits', 'normalizePhone', 'phoneMatchKey', 'leadMatchesPhone']
    .map(name => stripTypes(extractFunction(name)))
    .join('\n') + '\nreturn { leadMatchesPhone, phoneMatchKey }'
)()

test('celular cadastrado sem o nono dígito reconhece a resposta do WhatsApp com o 9 (caso André)', () => {
  assert.equal(leadMatchesPhone({ phone: '(19) 97553232', whatsapp_phone: null }, '5519997553232'), true)
})

test('celular cadastrado com o nono dígito reconhece a resposta do WhatsApp sem o 9 (caso Babur)', () => {
  assert.equal(leadMatchesPhone({ phone: '(43) 98434-8175', whatsapp_phone: null }, '554384348175'), true)
})

test('formatos iguais continuam reconhecendo, com ou sem o 55 no cadastro', () => {
  assert.equal(leadMatchesPhone({ phone: '11941676919' }, '5511941676919'), true)
  assert.equal(leadMatchesPhone({ phone: '5511941676919' }, '5511941676919'), true)
  assert.equal(leadMatchesPhone({ phone: null, whatsapp_phone: '(11) 94167-6919' }, '5511941676919'), true)
})

test('números diferentes não são confundidos', () => {
  assert.equal(leadMatchesPhone({ phone: '(19) 97553232' }, '5519997553233'), false)
  assert.equal(leadMatchesPhone({ phone: '(19) 97553232' }, '5511997553232'), false)
  assert.equal(leadMatchesPhone({ phone: '' , whatsapp_phone: null }, '5519997553232'), false)
})

test('telefone fixo de 8 dígitos não vira celular nem é alterado', () => {
  assert.equal(phoneMatchKey('(19) 3255-3232'), '551932553232')
  assert.equal(leadMatchesPhone({ phone: '(19) 3255-3232' }, '5519932553232'), false)
})

test('a comparação por telefone vale nos dois pontos da função (resposta recebida e mensagem enviada pelo celular)', () => {
  const uses = source.match(/leadMatchesPhone\(lead, senderPhone\)/g) || []
  assert.equal(uses.length, 2)
})
