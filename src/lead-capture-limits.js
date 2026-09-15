import { supabase } from './lib/supabase'

const ADMIN_PANEL_ID = 'axiva-weekly-capture-admin'
const CAPTURE_STATUS_ID = 'axiva-weekly-capture-status'

function currentBrazilWeekStart() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  const get = type => parts.find(p => p.type === type)?.value || ''
  const date = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`)
  const day = date.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  date.setUTCDate(date.getUTCDate() - diff)
  return date.toISOString().slice(0, 10)
}

function normalizedUsage(settings) {
  if (!settings) return 0
  return settings.lead_capture_week_start === currentBrazilWeekStart()
    ? Number(settings.lead_capture_weekly_usage || 0)
    : 0
}

function remainingText(settings) {
  if (settings?.lead_capture_weekly_limit == null) return 'Sem limite definido'
  const limit = Number(settings.lead_capture_weekly_limit || 0)
  const usage = normalizedUsage(settings)
  return `${Math.max(limit - usage, 0)} restante${Math.max(limit - usage, 0) === 1 ? '' : 's'}`
}

async function loadSettings(organizationId) {
  if (!organizationId) return null
  const { data, error } = await supabase
    .from('organization_settings')
    .select('organization_id,lead_capture_weekly_limit,lead_capture_weekly_usage,lead_capture_week_start,google_places_leads_per_capture')
    .eq('organization_id', organizationId)
    .single()

  if (error) throw error
  return data
}

function fieldMarkup(settings) {
  const usage = normalizedUsage(settings)
  const limit = settings?.lead_capture_weekly_limit
  const value = limit == null ? '' : String(limit)
  const displayLimit = limit == null ? 'Ilimitado' : limit
  const leadsPerCapture = Number(settings?.google_places_leads_per_capture || 40)

  return `
    <span class="eyebrow">PLANO DE CAPTAÇÃO</span>
    <h2>Captações automáticas</h2>
    <p class="muted">Defina quantas captações esta empresa pode iniciar por semana e quantos leads cada captação pode buscar.</p>
    <div class="campaign-form">
      <div class="field-grid">
        <label>
          Captações permitidas por semana
          <input id="axiva-weekly-capture-input" type="number" min="0" step="1" value="${value}" placeholder="Sem limite" />
        </label>
        <label>
          Leads por captação
          <input id="axiva-leads-per-capture-input" type="number" min="1" max="60" step="1" value="${leadsPerCapture}" />
        </label>
      </div>
      <div class="settings-preview">
        <div><strong>Uso nesta semana:</strong> ${usage} / ${displayLimit}</div>
        <div><strong>Disponível:</strong> ${remainingText(settings)}</div>
        <div><strong>Consumo Google por captação:</strong> até ${Math.ceil(leadsPerCapture / 20)} chamada${Math.ceil(leadsPerCapture / 20) === 1 ? '' : 's'} Enterprise</div>
      </div>
      <small class="muted">Até 20 leads = 1 chamada; 21 a 40 = até 2; 41 a 60 = até 3. O contador semanal reinicia na segunda-feira.</small>
      <div class="form-actions">
        <button id="axiva-weekly-capture-save" class="primary inline-btn" type="button">Salvar plano de captação</button>
      </div>
      <div id="axiva-weekly-capture-notice"></div>
    </div>
  `
}

async function renderAdminPanel() {
  const isGooglePlacesPage = [...document.querySelectorAll('h2')]
    .some(el => el.textContent?.trim() === 'Google Places')
  if (!isGooglePlacesPage) {
    document.getElementById(ADMIN_PANEL_ID)?.remove()
    return
  }

  const orgSelect = document.querySelector('.admin-org-select select')
  const host = document.querySelector('.admin-content')
  if (!orgSelect || !host) return

  let panel = document.getElementById(ADMIN_PANEL_ID)
  if (!panel) {
    panel = document.createElement('section')
    panel.id = ADMIN_PANEL_ID
    panel.className = 'panel'
    const apiPanel = [...host.querySelectorAll('.panel')]
      .find(el => el.textContent?.includes('SITUAÇÃO DA API'))
    if (apiPanel) host.insertBefore(panel, apiPanel)
    else host.appendChild(panel)
  }

  const organizationId = orgSelect.value
  if (!organizationId || panel.dataset.organizationId === organizationId && panel.dataset.loaded === 'true') return

  panel.dataset.organizationId = organizationId
  panel.dataset.loaded = 'false'
  panel.innerHTML = '<p class="muted">Carregando plano de captação...</p>'

  try {
    const settings = await loadSettings(organizationId)
    if (orgSelect.value !== organizationId) return
    panel.innerHTML = fieldMarkup(settings)
    panel.dataset.loaded = 'true'

    const saveButton = panel.querySelector('#axiva-weekly-capture-save')
    const weeklyInput = panel.querySelector('#axiva-weekly-capture-input')
    const leadsInput = panel.querySelector('#axiva-leads-per-capture-input')
    const notice = panel.querySelector('#axiva-weekly-capture-notice')

    saveButton?.addEventListener('click', async () => {
      const rawWeekly = weeklyInput.value.trim()
      const weeklyLimit = rawWeekly === '' ? null : Number(rawWeekly)
      const leadsPerCapture = Number(leadsInput.value)

      if (weeklyLimit !== null && (!Number.isInteger(weeklyLimit) || weeklyLimit < 0)) {
        notice.className = 'notice error'
        notice.textContent = 'Informe um número inteiro igual ou maior que zero para o limite semanal.'
        return
      }

      if (!Number.isInteger(leadsPerCapture) || leadsPerCapture < 1 || leadsPerCapture > 60) {
        notice.className = 'notice error'
        notice.textContent = 'Leads por captação deve estar entre 1 e 60.'
        return
      }

      saveButton.disabled = true
      notice.className = ''
      notice.textContent = ''

      const { data, error } = await supabase.rpc('admin_set_lead_capture_settings', {
        p_organization_id: organizationId,
        p_weekly_limit: weeklyLimit,
        p_leads_per_capture: leadsPerCapture
      })

      if (error || !data?.length) {
        notice.className = 'notice error'
        notice.textContent = error?.message || 'Não foi possível confirmar a gravação.'
        saveButton.disabled = false
        return
      }

      notice.className = 'notice'
      notice.textContent = 'Plano de captação salvo.'
      panel.dataset.loaded = 'false'
      setTimeout(() => renderAdminPanel(), 250)
    })
  } catch (error) {
    panel.replaceChildren()
    const errorNotice = document.createElement('div')
    errorNotice.className = 'notice error'
    errorNotice.textContent = `Não foi possível carregar o plano de captação: ${error?.message || error}`
    panel.appendChild(errorNotice)
  }
}

let currentOrgId = null
let currentOrgResolvedAt = 0

async function resolveCurrentOrganizationId() {
  const now = Date.now()
  if (currentOrgId && now - currentOrgResolvedAt < 60000) return currentOrgId

  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData?.session?.user?.id
  if (!userId) return null

  const { data } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  currentOrgId = data?.organization_id || null
  currentOrgResolvedAt = now
  return currentOrgId
}

async function renderCaptureStatus(force = false) {
  const captureTitle = [...document.querySelectorAll('h1')]
    .find(el => el.textContent?.trim() === 'Captação')
  const panel = document.querySelector('.capture-panel')

  if (!captureTitle || !panel) {
    document.getElementById(CAPTURE_STATUS_ID)?.remove()
    return
  }

  let box = document.getElementById(CAPTURE_STATUS_ID)
  if (!box) {
    box = document.createElement('div')
    box.id = CAPTURE_STATUS_ID
    box.className = 'notice compact-notice'
    const controls = panel.querySelector('.capture-controls')
    if (controls) panel.insertBefore(box, controls)
    else panel.appendChild(box)
  }

  if (!force && box.dataset.loadedAt && Date.now() - Number(box.dataset.loadedAt) < 10000) return

  try {
    const organizationId = await resolveCurrentOrganizationId()
    if (!organizationId) return
    const settings = await loadSettings(organizationId)
    const usage = normalizedUsage(settings)
    const limit = settings?.lead_capture_weekly_limit
    const leadsPerCapture = Number(settings?.google_places_leads_per_capture || 40)
    const limitText = limit == null ? 'Sem limite' : `${usage} de ${limit} utilizadas`

    box.innerHTML = `<strong>Captações desta semana:</strong> ${limitText}${limit == null ? '' : ` • ${remainingText(settings)}`}<br><strong>Leads por captação:</strong> até ${leadsPerCapture}`
    box.dataset.loadedAt = String(Date.now())

    const button = panel.querySelector('.capture-button')
    if (button && limit != null && usage >= Number(limit)) {
      button.disabled = true
      button.title = 'Limite semanal de captações atingido.'
    }
  } catch {
    // O bloqueio real continua no servidor mesmo se o indicador visual não puder ser carregado.
  }
}

function bindCaptureRefresh() {
  const button = document.querySelector('.capture-button')
  if (!button || button.dataset.captureLimitBound === 'true') return
  button.dataset.captureLimitBound = 'true'
  button.addEventListener('click', () => {
    setTimeout(() => renderCaptureStatus(true), 1800)
    setTimeout(() => renderCaptureStatus(true), 4500)
  })
}

async function enhance() {
  await renderAdminPanel()
  await renderCaptureStatus()
  bindCaptureRefresh()
}

setInterval(() => {
  enhance().catch(() => {})
}, 1200)

enhance().catch(() => {})
