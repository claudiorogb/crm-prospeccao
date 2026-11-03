/*
  AXIVA — registro do PWA e aviso discreto de instalação.
  Configuração pelos atributos do <script>: data-app-name, data-sw, data-scope.
  Não lê nem grava dados da conta: só registra o service worker e mostra o aviso.
*/
(function () {
  'use strict'

  var script = document.currentScript
  if (!script) return
  var APP_NAME = script.getAttribute('data-app-name') || 'AXIVA'
  var SW_URL = script.getAttribute('data-sw')
  var SW_SCOPE = script.getAttribute('data-scope')
  if (!SW_URL || !SW_SCOPE) return

  var STORAGE_KEY = 'axiva_pwa_aviso_' + SW_SCOPE
  var SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

  // 1) Service worker (só em conexão segura)
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }).catch(function () {})
    })
  }

  // 2) Aviso de instalação — só em celular/tablet e só se ainda não instalado
  var ua = navigator.userAgent || ''
  var isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  var isAndroid = /Android/.test(ua)
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true
  if (standalone || !(isIos || isAndroid)) return

  function snoozed() {
    try {
      var until = Number(localStorage.getItem(STORAGE_KEY) || 0)
      return until > Date.now()
    } catch (e) { return false }
  }
  function snooze() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now() + SNOOZE_MS)) } catch (e) {}
  }
  if (snoozed()) return

  var banner = null
  var deferredPrompt = null

  function removeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner)
    banner = null
  }

  function buildBanner(message, actionLabel, onAction) {
    if (!document.getElementById('axiva-pwa-style')) {
      var style = document.createElement('style')
      style.id = 'axiva-pwa-style'
      style.textContent =
        '.axiva-pwa{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9999;max-width:440px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:#0B192C;color:#F8FAFC;font:500 13px/1.4 Inter,Arial,Helvetica,sans-serif;border:1px solid rgba(248,250,252,.18);box-shadow:0 8px 24px rgba(11,25,44,.25)}' +
        '.axiva-pwa span{flex:1}' +
        '.axiva-pwa b{font-weight:700}' +
        '.axiva-pwa button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:9px 12px;cursor:pointer}' +
        '.axiva-pwa .axiva-pwa-go{background:#00A88F;color:#0B192C}' +
        '.axiva-pwa .axiva-pwa-x{background:transparent;color:#F8FAFC;padding:9px 8px;font-weight:500}'
      document.head.appendChild(style)
    }
    var box = document.createElement('div')
    box.className = 'axiva-pwa'
    box.setAttribute('role', 'region')
    box.setAttribute('aria-label', 'Instalar aplicativo')
    var text = document.createElement('span')
    var strong = document.createElement('b')
    strong.textContent = 'Instale o ' + APP_NAME + '. '
    text.appendChild(strong)
    text.appendChild(document.createTextNode(message))
    box.appendChild(text)
    if (actionLabel) {
      var go = document.createElement('button')
      go.type = 'button'
      go.className = 'axiva-pwa-go'
      go.textContent = actionLabel
      go.addEventListener('click', onAction)
      box.appendChild(go)
    }
    var close = document.createElement('button')
    close.type = 'button'
    close.className = 'axiva-pwa-x'
    close.setAttribute('aria-label', 'Dispensar aviso')
    close.textContent = actionLabel ? 'Agora não' : 'Entendi'
    close.addEventListener('click', function () { snooze(); removeBanner() })
    box.appendChild(close)
    document.body.appendChild(box)
    banner = box

    // Não atrapalha a digitação: ao focar em um campo, o aviso some só nesta visita
    document.addEventListener('focusin', function hide(ev) {
      var t = ev.target
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
        removeBanner()
        document.removeEventListener('focusin', hide)
      }
    })
  }

  window.addEventListener('appinstalled', function () { snooze(); removeBanner() })

  if (isAndroid) {
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault()
      deferredPrompt = event
      setTimeout(function () {
        if (!deferredPrompt || banner) return
        buildBanner('Acesse direto da tela inicial, como um aplicativo.', 'Instalar', function () {
          var prompt = deferredPrompt
          deferredPrompt = null
          removeBanner()
          if (prompt) {
            prompt.prompt()
            if (prompt.userChoice) prompt.userChoice.then(function (choice) { if (!choice || choice.outcome !== 'accepted') snooze() }).catch(function () {})
          }
        })
      }, 2500)
    })
  } else if (isIos) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        if (banner) return
        buildBanner('Toque em Compartilhar e depois em “Adicionar à Tela de Início”.', null, null)
      }, 2500)
    })
  }
})()
