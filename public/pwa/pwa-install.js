/*
  AXIVA — registro do PWA e opção "Instalar no celular" (usada pelo item do menu).
  Configuração pelos atributos do <script>: data-app-name, data-sw, data-scope.
  Não lê nem grava dados da conta: só registra o service worker e dispara a instalação.
  A opção só existe em celular/tablet e só se o app ainda não estiver instalado.
*/
(function () {
  'use strict'

  var script = document.currentScript
  if (!script) return
  var APP_NAME = script.getAttribute('data-app-name') || 'AXIVA'
  var SW_URL = script.getAttribute('data-sw')
  var SW_SCOPE = script.getAttribute('data-scope')
  if (!SW_URL || !SW_SCOPE) return

  // 1) Service worker (só em conexão segura)
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }).catch(function () {})
    })
  }

  // 2) Quem pode ver a opção: celular e tablet (nunca computador), app ainda não instalado
  var ua = navigator.userAgent || ''
  var isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  var isAndroid = /Android/.test(ua)
  var installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true
  var deferredPrompt = null

  function canShow() { return (isIos || isAndroid) && !installed }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault()
    deferredPrompt = event
  })
  window.addEventListener('appinstalled', function () {
    installed = true
    deferredPrompt = null
    window.dispatchEvent(new Event('axiva-pwa-change'))
    syncMenuItems()
  })

  // 3) Quadro com o passo a passo (iPhone/iPad, ou Android sem o instalador automático)
  function showHelp() {
    if (document.getElementById('axiva-pwa-help')) return
    if (!document.getElementById('axiva-pwa-style')) {
      var style = document.createElement('style')
      style.id = 'axiva-pwa-style'
      style.textContent =
        '.axiva-pwa-back{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(11,25,44,.6);font-family:Inter,Arial,Helvetica,sans-serif}' +
        '.axiva-pwa-card{width:min(380px,100%);background:#F8FAFC;color:#0B192C;border-radius:16px;padding:22px;box-shadow:0 16px 40px rgba(11,25,44,.35)}' +
        '.axiva-pwa-card h2{margin:0 0 12px;font-size:18px;font-weight:700}' +
        '.axiva-pwa-card ol{margin:0 0 18px;padding-left:20px;color:#475569;font-size:15px;line-height:1.55}' +
        '.axiva-pwa-card li{margin-bottom:6px}' +
        '.axiva-pwa-card b{color:#0B192C}' +
        '.axiva-pwa-card button{width:100%;border:0;border-radius:12px;background:#00A88F;color:#0B192C;font:inherit;font-weight:700;padding:12px;cursor:pointer}'
      document.head.appendChild(style)
    }
    var back = document.createElement('div')
    back.id = 'axiva-pwa-help'
    back.className = 'axiva-pwa-back'
    var card = document.createElement('div')
    card.className = 'axiva-pwa-card'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-labelledby', 'axiva-pwa-title')
    var title = document.createElement('h2')
    title.id = 'axiva-pwa-title'
    title.textContent = 'Instalar ' + APP_NAME + ' no celular'
    card.appendChild(title)

    var steps = document.createElement('ol')
    function step(parts) {
      var li = document.createElement('li')
      parts.forEach(function (p) {
        if (p.b) { var b = document.createElement('b'); b.textContent = p.b; li.appendChild(b) }
        else li.appendChild(document.createTextNode(p.t))
      })
      steps.appendChild(li)
    }
    if (isIos) {
      step([{ t: 'Abra este endereço no ' }, { b: 'Safari' }, { t: '.' }])
      step([{ t: 'Toque em ' }, { b: 'Compartilhar' }, { t: ' (o quadrado com a seta para cima).' }])
      step([{ t: 'Escolha ' }, { b: 'Adicionar à Tela de Início' }, { t: ' e confirme.' }])
    } else {
      step([{ t: 'Toque no menu do navegador (' }, { b: '⋮' }, { t: ').' }])
      step([{ t: 'Escolha ' }, { b: 'Instalar aplicativo' }, { t: ' ou ' }, { b: 'Adicionar à tela inicial' }, { t: '.' }])
      step([{ t: 'Confirme a instalação.' }])
    }
    card.appendChild(steps)

    var close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Entendi'
    function done() { document.removeEventListener('keydown', onKey); if (back.parentNode) back.parentNode.removeChild(back) }
    function onKey(ev) { if (ev.key === 'Escape') done() }
    close.addEventListener('click', done)
    back.addEventListener('click', function (ev) { if (ev.target === back) done() })
    document.addEventListener('keydown', onKey)
    card.appendChild(close)
    back.appendChild(card)
    document.body.appendChild(back)
    close.focus()
  }

  function install() {
    if (!canShow()) return
    if (deferredPrompt) {
      var prompt = deferredPrompt
      deferredPrompt = null
      prompt.prompt()
      return
    }
    showHelp()
  }

  window.axivaPwa = { canShow: canShow, install: install }
  window.dispatchEvent(new Event('axiva-pwa-change'))

  // 4) Itens de menu estáticos (ex.: Invest): <button data-axiva-install class="... hidden">
  function syncMenuItems() {
    var show = canShow()
    document.querySelectorAll('[data-axiva-install]').forEach(function (el) {
      if (show) el.classList.remove('hidden')
      else el.classList.add('hidden')
    })
  }
  function wireMenuItems() {
    document.querySelectorAll('[data-axiva-install]').forEach(function (el) {
      if (el.getAttribute('data-axiva-wired')) return
      el.setAttribute('data-axiva-wired', '1')
      el.addEventListener('click', install)
    })
    syncMenuItems()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireMenuItems)
  else wireMenuItems()
})()
