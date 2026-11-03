import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/App.jsx', 'utf8')

test('falha ao ler a sessão não deixa o app preso em "Carregando..."', () => {
  const start = app.indexOf('supabase.auth.getSession().then(async ({ data }) => {')
  assert.ok(start > 0)
  const block = app.slice(start, start + 1400)
  assert.match(block, /\}\)\.catch\(\(\) => \{\n[\s\S]*?setSession\(null\)\n\s+setLoading\(false\)/)
  // o tratamento do erro não apaga login nem dados do aparelho
  const catchBody = block.slice(block.indexOf('.catch('), block.indexOf('const { data: listener }'))
  assert.doesNotMatch(catchBody, /removeItem|signOut|clear\(/)
})

test('tela de carregamento oferece Recarregar depois de 10 segundos', () => {
  assert.match(app, /function SlowLoadingScreen\(\)/)
  assert.match(app, /setTimeout\(\(\) => setSlow\(true\), 10000\)/)
  assert.match(app, /window\.location\.reload\(\)\}>Recarregar/)
  assert.match(app, /return <SlowLoadingScreen \/>/)
})
