import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PlatformHealthAccess from './platform-health-access'
import TrialBanner from './trial-banner'
import { supabase } from './lib/supabase'
import './styles.css'
import './role-access.css'
import './mobile-v104.css'
import './user-account-confirmation.js'
import './ui-copy-cleanup.js'

async function syncOrganizationRole(session) {
  if (!session?.user?.id) {
    delete document.body.dataset.orgRole
    return
  }

  document.body.dataset.orgRole = 'loading'

  const { data, error } = await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', session.user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    document.body.dataset.orgRole = 'restricted'
    return
  }

  document.body.dataset.orgRole = data?.role || 'restricted'
}

// Google Analytics só nas telas públicas (login e cadastro); nunca com usuário logado
// nem nos links de definir/recuperar senha.
function syncAnalytics(session) {
  const params = new URLSearchParams(window.location.search)
  const hash = window.location.hash
  const passwordLink = params.get('reset') === '1' || hash.includes('type=recovery') || hash.includes('type=invite')
  window.AxivaAnalytics?.setAllowed(!session?.user && !passwordLink)
}

supabase.auth.getSession().then(({ data }) => {
  syncOrganizationRole(data.session)
  syncAnalytics(data.session)
})

supabase.auth.onAuthStateChange((_event, session) => {
  syncAnalytics(session)
  setTimeout(() => syncOrganizationRole(session), 0)
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TrialBanner />
    <App />
    <PlatformHealthAccess />
  </React.StrictMode>,
)
