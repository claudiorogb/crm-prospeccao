/*
 * AXIVA — Google Analytics 4 (G-8VW4GCQGYD) com aviso de cookies (LGPD).
 *
 * - Nada do Google é carregado antes de o visitante clicar em "Aceitar".
 * - A escolha fica num cookie de 1 ano em .axiva.com.br (vale para o site e para o CRM).
 * - Qualquer elemento com o atributo data-cookie-preferences reabre o aviso. Fora do modo
 *   manual, o link "Preferências de cookies" é colocado sozinho no rodapé da página.
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

  function cookieDomain() {
    return /(^|\.)axiva\.com\.br$/.test(location.hostname) ? '; domain=.axiva.com.br' : '';
  }

  function saveChoice(value) {
    document.cookie = COOKIE + '=' + value + '; max-age=31536000; path=/; SameSite=Lax' + cookieDomain() + (location.protocol === 'https:' ? '; Secure' : '');
  }

  // Ao recusar depois de ter aceitado: para o envio e apaga os cookies do Google Analytics.
  function stopGA() {
    window['ga-disable-' + GA_ID] = true;
    document.cookie.split('; ').forEach(function (c) {
      var name = c.split('=')[0];
      if (name === '_ga' || name.indexOf('_ga_') === 0) {
        document.cookie = name + '=; max-age=0; path=/' + cookieDomain();
        document.cookie = name + '=; max-age=0; path=/';
      }
    });
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
    if (value === 'declined') stopGA();
  }

  // Mesmo texto, botões e visual do aviso do site axiva.com.br.
  function showBanner() {
    if (banner || !document.body) return;
    if (!document.getElementById('axiva-cookie-css')) {
      var css = document.createElement('style');
      css.id = 'axiva-cookie-css';
      css.textContent =
        '#axiva-cookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;' +
        'background:#111827;color:#f9fafb;border-radius:12px;padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,.25);' +
        'font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;display:flex;flex-wrap:wrap;gap:12px;align-items:center}' +
        '#axiva-cookie p{margin:0;flex:1 1 260px}' +
        '#axiva-cookie a{color:#93c5fd;text-decoration:underline}' +
        '#axiva-cookie .axc-btns{display:flex;gap:8px;flex:0 0 auto}' +
        '#axiva-cookie button{font:inherit;font-weight:600;border-radius:8px;padding:8px 16px;cursor:pointer;border:1px solid #4b5563}' +
        '#axiva-cookie .axc-no{background:transparent;color:#f9fafb}' +
        '#axiva-cookie .axc-yes{background:#f9fafb;color:#111827;border-color:#f9fafb}';
      document.head.appendChild(css);
    }
    banner = document.createElement('div');
    banner.id = 'axiva-cookie';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Aviso de cookies');
    banner.innerHTML =
      '<p>Usamos cookies do Google Analytics para entender como o site \u00e9 usado e melhor\u00e1-lo. ' +
      'Voc\u00ea pode aceitar ou recusar. <a href="https://axiva.com.br/privacidade#cookies">Pol\u00edtica de Privacidade</a></p>' +
      '<div class="axc-btns"><button type="button" class="axc-no">Recusar</button>' +
      '<button type="button" class="axc-yes">Aceitar</button></div>';
    banner.querySelector('.axc-no').addEventListener('click', function () { choose('declined'); });
    banner.querySelector('.axc-yes').addEventListener('click', function () { choose('accepted'); });
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

  function openPreferences() {
    if (!allowed) return;
    hideBanner();
    showBanner();
  }

  function addFooterLink() {
    var footers = document.querySelectorAll('footer');
    var footer = footers[footers.length - 1];
    if (footer && footer.querySelector('[data-cookie-preferences]')) return;
    var link = document.createElement('a');
    link.href = '#';
    link.setAttribute('data-cookie-preferences', '');
    link.textContent = 'Prefer\u00eancias de cookies';
    var lastLink = footer && footer.querySelectorAll('a');
    lastLink = lastLink && lastLink[lastLink.length - 1];
    if (lastLink && lastLink.parentNode.tagName === 'LI') {
      // Rodapé em lista: novo item com o mesmo estilo do anterior.
      var item = document.createElement('li');
      item.className = lastLink.parentNode.className;
      link.className = lastLink.className;
      item.appendChild(link);
      lastLink.parentNode.parentNode.insertBefore(item, lastLink.parentNode.nextSibling);
    } else if (lastLink) {
      // Mesmo lugar e mesmo estilo dos outros links do rodapé.
      link.className = lastLink.className;
      lastLink.parentNode.insertBefore(link, lastLink.nextSibling);
      lastLink.parentNode.insertBefore(document.createTextNode(' '), link);
    } else {
      var box = document.createElement('div');
      box.style.cssText = 'text-align:center;padding:16px;font-size:13px;';
      link.style.cssText = 'color:inherit;opacity:.75;text-decoration:underline;';
      box.appendChild(link);
      (footer || document.body).appendChild(box);
    }
  }

  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest && event.target.closest('[data-cookie-preferences]');
    if (!el) return;
    event.preventDefault();
    openPreferences();
  });

  window.AxivaAnalytics = { setAllowed: setAllowed, openPreferences: openPreferences };
  if (!manual) {
    setAllowed(true);
    if (document.body) addFooterLink();
    else document.addEventListener('DOMContentLoaded', addFooterLink);
  }
})();
