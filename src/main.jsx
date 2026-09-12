import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { supabase } from './lib/supabase'
import './styles.css'
import './role-access.css'

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

supabase.auth.getSession().then(({ data }) => {
  syncOrganizationRole(data.session)
})

supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => syncOrganizationRole(session), 0)
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
