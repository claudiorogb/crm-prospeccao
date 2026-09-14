const BRAND_NAME = 'AXIVA CRM'

function brandMarkElement() {
  const img = document.createElement('img')
  img.src = '/axiva-mark.svg'
  img.alt = 'AXIVA'
  img.className = 'axiva-brand-symbol'
  return img
}

function applyAxivaBranding() {
  document.title = BRAND_NAME

  document.querySelectorAll('.brand-mark').forEach(mark => {
    if (mark.dataset.axivaBranded === 'true') return
    mark.textContent = ''
    mark.appendChild(brandMarkElement())
    mark.dataset.axivaBranded = 'true'
    mark.setAttribute('aria-label', 'AXIVA')
  })

  document.querySelectorAll('h1, strong').forEach(element => {
    if (element.textContent.trim() === 'CRM Prospecção') {
      element.textContent = BRAND_NAME
    }
  })
}

const style = document.createElement('style')
style.textContent = `
  .brand-mark[data-axiva-branded="true"] {
    padding: 0 !important;
    overflow: hidden;
    background: #05090f !important;
    border: 1px solid rgba(255,255,255,.10);
  }

  .brand-mark[data-axiva-branded="true"] .axiva-brand-symbol {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
`
document.head.appendChild(style)

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyAxivaBranding, { once: true })
} else {
  applyAxivaBranding()
}

const observer = new MutationObserver(applyAxivaBranding)
observer.observe(document.documentElement, { childList: true, subtree: true })
