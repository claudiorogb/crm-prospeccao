import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/App.jsx', 'utf8')
const nav = readFileSync('src/back-navigation.js', 'utf8')
const layer = readFileSync('src/back-layer.js', 'utf8')

test('o histórico guarda só nomes de telas, nunca dados da conta', () => {
  const states = nav.match(/(pushState|replaceState)\(\{[^}]*\}/g) || []
  assert.ok(states.length >= 3)
  for (const s of states) assert.doesNotMatch(s, /session|token|email|user|lead|client|cliente|phone|telefone/i)
  assert.doesNotMatch(nav, /localStorage|sessionStorage|supabase/i)
  assert.doesNotMatch(layer, /localStorage|sessionStorage|supabase/i)
})

test('App: cada tela do menu entra no histórico e o Voltar reaplica a tela anterior', () => {
  assert.match(app, /import \{ commitScreen, installScreenPopHandler \} from '\.\/back-navigation'/)
  assert.match(app, /commitScreen\(\{ page, sys: systemAdminView, adm: adminCommercialPage \}\)/)
  assert.match(app, /if \(!session\?\.user \|\| accessLoading\) return/)
  assert.match(app, /installScreenPopHandler\(snap => \{\n\s+if \(!sessionUserRef\.current\) return/)
  assert.match(app, /setPage\(snap\.page\)/)
})

test('App: menu do celular e detalhe do cliente são camadas fechadas pelo Voltar', () => {
  assert.match(app, /useBackLayer\(mobileMenuOpen, \(\) => setMobileMenuOpen\(false\)\)/)
  assert.match(app, /useBackLayer\(Boolean\(selectedClient\), \(\) => setSelectedId\(null\)\)/)
})

test('camada: registro adiado e desfaz a entrada ao fechar por outro caminho', () => {
  assert.match(nav, /const openTimer = setTimeout/)
  assert.match(nav, /window\.history\.back\(\)/)
  assert.match(layer, /if \(!active\) return undefined/)
})
