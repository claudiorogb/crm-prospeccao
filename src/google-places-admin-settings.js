import { supabase } from './lib/supabase'

const GLOBAL_PANEL_ID = 'axiva-global-google-places-limits'
const SAVE_NOTICE_ID = 'axiva-google-places-save-notice'

function isGooglePlacesAdminPage() {
  return [...document.querySelectorAll('h2')]
    .some(el => el.textContent?.trim() === 'Google Places')
}

function findPanelByTitle(title) {
  return [...document.querySelectorAll('.admin-content .panel')]
    .find(panel => [...panel.querySelectorAll('h2')].some(h => h.textContent?.trim() === title))
}

function parseNonNegativeInteger(input, label) {
  const value = Number(input?.value)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} deve ser um número inteiro igual ou maior que zero.`)
  }
  return value
}

function ensureNotice(host) {
  let notice = document.getElementById(SAVE_NOTICE_ID)
  if (!notice) {
    notice = document.createElement('div')
    notice.id = SAVE_NOTICE_ID
    host?.appendChild(notice)
  }
  return notice
}

function setNotice(host, message, error = false) {
  const notice = ensureNotice(host)
  notice.className = error ? 'notice error' : 'notice'
  notice.textContent = message
}

async function saveOrganizationQuotas(button) {
  const orgSelect = document.querySelector('.admin-org-select select')
  const organizationId = orgSelect?.value
  const enterprisePanel = findPanelByTitle('Enterprise')
  const proPanel = findPanelByTitle('Pro')
  const enterpriseInput = enterprisePanel?.querySelector('input[type="number"]')
  const proInput = proPanel?.querySelector('input[type="number"]')
  const host = button.closest('.panel') || button.parentElement

  if (!organizationId || !enterpriseInput || !proInput) {
    setNotice(host, 'Não foi possível identificar os campos de limite.', true)
    return
  }

  let enterpriseQuota
  let proQuota
  try {
    enterpriseQuota = parseNonNegativeInteger(enterpriseInput, 'Limite Enterprise')
    proQuota = parseNonNegativeInteger(proInput, 'Limite Pro')
  } catch (error) {
    setNotice(host, error.message, true)
    return
  }

  button.disabled = true
  setNotice(host, 'Salvando limites...')

  const { data, error } = await supabase.rpc('admin_set_google_places_quotas', {
    p_organization_id: organizationId,
    p_enterprise_quota: enterpriseQuota,
    p_pro_quota: proQuota
  })

  button.disabled = false

  if (error || !data?.length) {
    setNotice(host, error?.message || 'O banco não confirmou a gravação dos limites.', true)
    return
  }

  const saved = data[0]
  enterpriseInput.value = String(saved.enterprise_quota)
  proInput.value = String(saved.pro_quota)
  setNotice(host, 'Limites mensais desta empresa salvos e confirmados.')
}

function bindOrganizationQuotaSave() {
  const button = [...document.querySelectorAll('button')]
    .find(btn => btn.textContent?.replace(/\s+/g, ' ').trim().includes('Salvar limites'))

  if (!button || button.dataset.axivaVerifiedSave === 'true') return
  button.dataset.axivaVerifiedSave = 'true'

  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    saveOrganizationQuotas(button).catch(error => {
      const host = button.closest('.panel') || button.parentElement
      button.disabled = false
      setNotice(host, error?.message || 'Não foi possível salvar os limites.', true)
    })
  }, true)
}

function globalPanelMarkup(settings) {
  const enterpriseRemaining = Math.max(Number(settings.enterprise_monthly_quota || 0) - Number(settings.enterprise_usage_month || 0), 0)
  const proRemaining = Math.max(Number(settings.pro_monthly_quota || 0) - Number(settings.pro_usage_month || 0), 0)

  return `
    <span class="eyebrow">SEGURANÇA GLOBAL AXIVA</span>
    <h2>Limite global do Google Places</h2>
    <p class="muted">Este limite vale para a soma de todas as empresas e impede que o CRM ultrapasse o teto mensal definido.</p>
    <div class="field-grid">
      <label>
        Enterprise — limite global mensal
        <input id="axiva-global-enterprise-quota" type="number" min="0" step="1" value="${Number(settings.enterprise_monthly_quota || 0)}" />
      </label>
      <label>
        Pro — limite global mensal
        <input id="axiva-global-pro-quota" type="number" min="0" step="1" value="${Number(settings.pro_monthly_quota || 0)}" />
      </label>
    </div>
    <div class="settings-preview">
      <div><strong>Enterprise:</strong> ${Number(settings.enterprise_usage_month || 0)} usado(s) • ${enterpriseRemaining} restante(s)</div>
      <div><strong>Pro:</strong> ${Number(settings.pro_usage_month || 0)} usado(s) • ${proRemaining} restante(s)</div>
    </div>
    <div class="form-actions">
      <button id="axiva-global-google-save" class="primary inline-btn" type="button">Salvar limite global</button>
    </div>
    <div id="axiva-global-google-notice"></div>
  `
}

async function loadGlobalSettings() {
  const { data, error } = await supabase
    .from('platform_google_places_limits')
    .select('singleton_key,enterprise_monthly_quota,enterprise_usage_month,pro_monthly_quota,pro_usage_month,usage_month')
    .eq('singleton_key', true)
    .single()

  if (error) throw error
  return data
}

async function renderGlobalPanel() {
  if (!isGooglePlacesAdminPage()) {
    document.getElementById(GLOBAL_PANEL_ID)?.remove()
    return
  }

  const host = document.querySelector('.admin-content')
  if (!host) return

  let panel = document.getElementById(GLOBAL_PANEL_ID)
  if (!panel) {
    panel = document.createElement('section')
    panel.id = GLOBAL_PANEL_ID
    panel.className = 'panel'
    const apiPanel = [...host.querySelectorAll('.panel')]
      .find(el => el.textContent?.includes('SITUAÇÃO DA API'))
    if (apiPanel) host.insertBefore(panel, apiPanel)
    else host.appendChild(panel)
  }

  if (panel.dataset.loading === 'true' || panel.dataset.loaded === 'true') return
  panel.dataset.loading = 'true'
  panel.innerHTML = '<p class="muted">Carregando limite global...</p>'

  try {
    const settings = await loadGlobalSettings()
    panel.innerHTML = globalPanelMarkup(settings)
    panel.dataset.loaded = 'true'
    panel.dataset.loading = 'false'

    const saveButton = panel.querySelector('#axiva-global-google-save')
    const enterpriseInput = panel.querySelector('#axiva-global-enterprise-quota')
    const proInput = panel.querySelector('#axiva-global-pro-quota')
    const notice = panel.querySelector('#axiva-global-google-notice')

    saveButton?.addEventListener('click', async () => {
      let enterpriseQuota
      let proQuota
      try {
        enterpriseQuota = parseNonNegativeInteger(enterpriseInput, 'Limite global Enterprise')
        proQuota = parseNonNegativeInteger(proInput, 'Limite global Pro')
      } catch (error) {
        notice.className = 'notice error'
        notice.textContent = error.message
        return
      }

      saveButton.disabled = true
      notice.className = ''
      notice.textContent = ''

      const { data, error } = await supabase.rpc('admin_set_global_google_places_quotas', {
        p_enterprise_quota: enterpriseQuota,
        p_pro_quota: proQuota
      })

      saveButton.disabled = false

      if (error || !data?.length) {
        notice.className = 'notice error'
        notice.textContent = error?.message || 'O banco não confirmou a gravação do limite global.'
        return
      }

      notice.className = 'notice'
      notice.textContent = 'Limite global salvo e confirmado.'
      panel.dataset.loaded = 'false'
      setTimeout(() => renderGlobalPanel(), 250)
    })
  } catch (error) {
    panel.dataset.loading = 'false'
    panel.dataset.loaded = 'false'
    panel.innerHTML = `<div class="notice error">Não foi possível carregar o limite global: ${String(error?.message || error)}</div>`
  }
}

async function enhance() {
  if (!isGooglePlacesAdminPage()) return
  bindOrganizationQuotaSave()
  await renderGlobalPanel()
}

const observer = new MutationObserver(() => {
  enhance().catch(() => {})
})

observer.observe(document.body, { childList: true, subtree: true })
setInterval(() => enhance().catch(() => {}), 1500)
enhance().catch(() => {})
