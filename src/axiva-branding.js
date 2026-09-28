const BRAND_NAME = 'AXIVA CRM'
const MARK_DATA_URL = '/axiva-crm-login-logo.png'
const SIDEBAR_MARK_URL = '/axiva-crm-sidebar-mark.svg'
const SIDEBAR_WORDMARK_URL = '/axiva-crm-wordmark.svg'

function applyBranding() {
  document.title = BRAND_NAME

  document.querySelectorAll('.brand-mark').forEach(mark => {
    const current = mark.querySelector('img[data-axiva-mark]')
    if (current) return
    mark.textContent = ''
    const img = document.createElement('img')
    const isSidebar = Boolean(mark.closest('.sidebar-brand'))
    img.src = isSidebar ? SIDEBAR_MARK_URL : MARK_DATA_URL
    img.alt = isSidebar ? 'AXIVA' : 'AXIVA'
    img.dataset.axivaMark = 'true'
    img.style.width = '100%'
    img.style.height = '100%'
    img.style.objectFit = 'contain'
    img.style.display = 'block'
    mark.style.padding = '0'
    mark.style.background = 'transparent'

    if (isSidebar) {
      mark.style.width = '52px'
      mark.style.height = '52px'
      mark.style.borderRadius = '0'
      mark.style.flex = '0 0 52px'

      const copy = mark.nextElementSibling
      if (copy) {
        copy.querySelectorAll('img[data-axiva-wordmark]').forEach(node => node.remove())
        const strong = copy.querySelector('strong')
        if (strong) strong.style.display = 'none'
      }
    } else {
      mark.style.width = '200px'
      mark.style.height = '108px'
      mark.style.maxWidth = '100%'
      mark.style.borderRadius = '0'
      mark.style.marginBottom = '14px'

      const card = mark.closest('.auth-card')
      const heading = card?.querySelector('h1')
      if (heading) heading.style.display = 'none'
    }

    mark.appendChild(img)
  })

  document.querySelectorAll('h1, strong').forEach(element => {
    if (element.textContent.trim() === 'CRM Prospecção') element.textContent = BRAND_NAME
  })
}

applyBranding()
window.setInterval(applyBranding, 700)
