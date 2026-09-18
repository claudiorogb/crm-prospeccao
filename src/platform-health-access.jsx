import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'
import AdminHealthMonitor from './admin-health-monitor'

// Adds a self-contained administration-only entry without changing App.jsx or any
// customer navigation. The database independently enforces admin-only RLS.
export default function PlatformHealthAccess() {
  const [authorized, setAuthorized] = useState(false)
  const [navigation, setNavigation] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    async function refresh() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      if (!session?.user?.id) { setAuthorized(false); setOpen(false); return }
      const [admin, profile] = await Promise.all([
        supabase.from('system_admins').select('user_id').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('profiles').select('account_status').eq('id', session.user.id).maybeSingle()
      ])
      if (!active) return
      const allowed = !admin.error && Boolean(admin.data) && !profile.error && profile.data?.account_status === 'active'
      setAuthorized(allowed)
      if (!allowed) setOpen(false)
    }
    refresh()
    const { data: subscription } = supabase.auth.onAuthStateChange(() => { setTimeout(refresh, 0) })
    return () => { active = false; subscription.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!authorized) { setNavigation(null); return undefined }
    let latest = null
    const refresh = () => {
      const next = document.querySelector('.admin-subnav')
      if (next !== latest) { latest = next; setNavigation(next); if (!next) setOpen(false) }
    }
    refresh()
    const watcher = new MutationObserver(refresh)
    watcher.observe(document.getElementById('root'), { childList: true, subtree: true })
    return () => watcher.disconnect()
  }, [authorized])

  if (!authorized) return null
  return <>
    {navigation && createPortal(
      <button type="button" className={`admin-subnav-item ${open ? 'active' : ''}`} onClick={() => setOpen(true)}>
        Saúde do sistema
      </button>, navigation
    )}
    {open && navigation && createPortal(
      <div role="dialog" aria-modal="true" aria-label="Saúde do sistema" style={{ position:'fixed', inset:0, zIndex:10000, background:'rgba(11,25,44,.78)', overflowY:'auto', padding:'24px' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto', background:'var(--axiva-light, #f8fafc)', color:'var(--axiva-navy, #0b192c)', borderRadius:12, padding:20 }}>
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}><button type="button" className="secondary" onClick={() => setOpen(false)}>Fechar monitoramento</button></div>
          <AdminHealthMonitor />
        </div>
      </div>, document.body
    )}
  </>
}
