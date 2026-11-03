import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
const swFull = readFileSync('public/sw.js', 'utf8')
const sw = swFull.replace(/\/\*[\s\S]*?\*\//g, '') // só o código, sem o comentário
const install = readFileSync('public/pwa/pwa-install.js', 'utf8')
const html = readFileSync('index.html', 'utf8')
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
const offline = readFileSync('public/offline.html', 'utf8')
const menuItem = readFileSync('src/install-app-menu-item.jsx', 'utf8')
const app = readFileSync('src/App.jsx', 'utf8')

test('manifesto usa nome, cores e ícones da marca AXIVA', () => {
  assert.equal(manifest.name, 'AXIVA CRM')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.theme_color, '#0B192C')
  assert.equal(manifest.background_color, '#F8FAFC')
  assert.ok(!manifest.start_url.includes('?'), 'start_url sem parâmetros')
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`)
  assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'))
  for (const icon of manifest.icons) assert.ok(existsSync(`public${icon.src}`), icon.src)
  assert.ok(existsSync('public/pwa/apple-touch-icon.png'))
})

test('service worker não guarda nem intercepta dados da conta', () => {
  // só navegação, só mesmo domínio, só GET
  assert.match(sw, /request\.mode !== 'navigate'/)
  assert.match(sw, /new URL\(request\.url\)\.origin !== self\.location\.origin/)
  // nada é gravado no cache além do pré-cache fixo
  assert.doesNotMatch(sw, /cache\.put|\.put\(/)
  assert.doesNotMatch(sw, /supabase|Authorization|apikey|localStorage|indexedDB|postMessage|push|sync/i)
  assert.match(sw, /const OFFLINE_URL = '\/offline\.html'/)
  assert.match(sw, /const PRECACHE = \[OFFLINE_URL, '\/pwa\/icon-192\.png'\]/)
  // o único addAll é o pré-cache
  assert.equal((sw.match(/addAll/g) || []).length, 1)
  // rede primeiro
  assert.match(sw, /fetch\(request\)\.catch/)
})

test('instalação só por item de menu, restrita a celular/tablet, sem HTML dinâmico', () => {
  assert.doesNotMatch(install, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write/)
  assert.doesNotMatch(install, /supabase|sb-|token|password|senha|localStorage/i)
  assert.match(install, /isSecureContext/)
  assert.match(install, /display-mode: standalone/)
  // só Android e iPhone/iPad (nunca computador)
  assert.match(install, /function canShow\(\) \{ return \(isIos \|\| isAndroid\) && !installed \}/)
  // sem aviso flutuante
  assert.doesNotMatch(install, /axiva-pwa-x|snooze|position:fixed;left:12px/)
})

test('menu do CRM tem a linha "Instalar CRM no celular" nos dois menus, antes do rodapé', () => {
  assert.match(menuItem, /Instalar CRM no celular/)
  assert.match(menuItem, /window\.axivaPwa\?\.canShow\(\)/)
  assert.match(menuItem, /if \(!visible\) return null/)
  assert.equal((app.match(/<InstallAppMenuItem onDone=\{\(\) => setMobileMenuOpen\(false\)\} \/>/g) || []).length, 2)
  assert.match(app, /import InstallAppMenuItem from '\.\/install-app-menu-item'/)
})

test('index.html liga manifesto, ícone iOS e script, sem remover nada existente', () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(html, /apple-touch-icon/)
  assert.match(html, /apple-mobile-web-app-capable/)
  assert.match(html, /data-sw="\/sw\.js" data-scope="\/"/)
  assert.match(html, /src="\/src\/main\.jsx"/)
  assert.match(html, /axiva-branding\.js/)
})

test('cabeçalhos de segurança atuais continuam e o SW não fica em cache', () => {
  const all = vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => `${h.key}=${h.value}`)
  assert.ok(all.includes('X-Frame-Options=DENY'))
  assert.ok(all.includes("Content-Security-Policy=frame-ancestors 'none'"))
  assert.ok(all.includes('X-Content-Type-Options=nosniff'))
  assert.ok(all.includes('Referrer-Policy=strict-origin-when-cross-origin'))
  assert.ok(all.includes('Permissions-Policy=camera=(), geolocation=(), usb=()'))
  const swh = vercel.headers.find((h) => h.source === '/sw.js').headers
  assert.ok(swh.some((h) => h.key === 'Cache-Control' && /max-age=0/.test(h.value)))
  assert.ok(vercel.headers.some((h) => h.source === '/manifest.webmanifest'))
})

test('página offline segue a marca e não carrega recursos externos', () => {
  assert.match(offline, /Inter,Arial,Helvetica/)
  for (const color of ['#F8FAFC', '#0B192C', '#475569', '#00A88F']) assert.ok(offline.includes(color), color)
  assert.doesNotMatch(offline, /https?:\/\//)
})
