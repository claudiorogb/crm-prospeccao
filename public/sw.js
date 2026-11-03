/*
  AXIVA CRM — service worker (PWA)

  Regra de segurança: este arquivo NÃO guarda dados do usuário.
  - Só intercepta navegação de página (mode === 'navigate') do mesmo domínio.
  - Sempre busca a página na rede; só usa a cópia local (offline.html, sem dados)
    quando o aparelho está sem internet.
  - Não intercepta chamadas ao Supabase, às funções, nem nenhum outro pedido
    (dados, login e tokens passam direto pelo navegador, como no computador).
  - Nada de respostas da rede é gravado no cache.
*/
const CACHE = 'axiva-crm-shell-v1'
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/pwa/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('axiva-crm-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.mode !== 'navigate' || request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match(OFFLINE_URL)))
  )
})
