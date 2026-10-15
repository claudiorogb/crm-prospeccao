/*
 * AXIVA — Google Analytics 4 (G-8VW4GCQGYD) com aviso de cookies (LGPD).
 *
 * - Nada do Google é carregado antes de o visitante clicar em "Aceitar".
 * - A escolha fica num cookie de 1 ano em .axiva.com.br (vale para o site e para o CRM).
 * - Usar só em páginas públicas. Com data-manual="true", a página decide quando
 *   pode medir chamando window.AxivaAnalytics.setAllowed(true | false).
 */
(function () {
  if (window.AxivaAnalytics) return;

  var GA_ID = 'G-8VW4GCQGYD';
  var COOKIE = 'axiva_cookie_consent';
  var script = document.currentScript;
  var manual = !!(script && script.getAttribute('data-manual') === 'true');
  var allowed = false;
  var loaded = false;
  var banner = null;

  function readChoice() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    return m ? m[1] : null;
  }

  function saveChoice(value) {
    var host = location.hostname;
    var domain = /(^|\.)axiva\.com\.br$/.test(host) ? '; domain=.axiva.com.br' : '';
    document.cookie = COOKIE + '=' + value + '; max-age=31536000; path=/; SameSite=Lax' + domain + (location.protocol === 'https:' ? '; Secure' : '');
  }

  // Endereço enviado ao Google sem "#..." e sem o parâmetro email (dado pessoal).
  function cleanLocation() {
    var params = new URLSearchParams(location.search);
    params.delete('email');
    var qs = params.toString();
    return location.origin + location.pathname + (qs ? '?' + qs : '');
  }

  function loadGA() {
    window['ga-disable-' + GA_ID] = false;
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { page_location: cleanLocation() });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  function hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function choose(value) {
    saveChoice(value);
    hideBanner();
    if (value === 'accepted' && allowed) loadGA();
  }

  function showBanner() {
    if (banner || !document.body) return;
    banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Aviso de cookies');
    banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:720px;margin:0 auto;' +
      'background:#0B192C;color:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 8px 30px rgba(0,0,0,.25);' +
      'font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;display:flex;flex-wrap:wrap;gap:12px;align-items:center;';
    var text = document.createElement('p');
    text.style.cssText = 'margin:0;flex:1 1 320px;';
    text.appendChild(document.createTextNode('Usamos cookies do Google Analytics para entender, de forma estat\u00edstica, como o site \u00e9 usado. Voc\u00ea aceita? '));
    var link = document.createElement('a');
    link.href = 'https://axiva.com.br/privacidade';
    link.textContent = 'Pol\u00edtica de Privacidade';
    link.style.cssText = 'color:#7fe3d3;text-decoration:underline;';
    text.appendChild(link);
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;';
    function button(label, value, primary) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'cursor:pointer;border-radius:8px;padding:8px 16px;font:600 14px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;' +
        (primary ? 'background:#00A88F;color:#fff;border:1px solid #00A88F;' : 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);');
      b.addEventListener('click', function () { choose(value); });
      return b;
    }
    actions.appendChild(button('Recusar', 'declined', false));
    actions.appendChild(button('Aceitar', 'accepted', true));
    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  }

  function setAllowed(value) {
    allowed = !!value;
    if (!allowed) {
      // Área logada: some o aviso e, se o Analytics já tiver sido carregado, para de enviar dados.
      hideBanner();
      window['ga-disable-' + GA_ID] = true;
      return;
    }
    var choice = readChoice();
    if (choice === 'accepted') loadGA();
    else if (choice !== 'declined') {
      if (document.body) showBanner();
      else document.addEventListener('DOMContentLoaded', function () { if (allowed && !readChoice()) showBanner(); });
    }
  }

  window.AxivaAnalytics = { setAllowed: setAllowed };
  if (!manual) setAllowed(true);
})();
