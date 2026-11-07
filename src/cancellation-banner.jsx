import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { brazilDay, hideKey, noticeText } from './cancellation-notice.js'
import './cancellation-banner.css'

// Faixa fina no topo enquanto o plano está cancelado e o acesso ainda vale. Sem popup.
// Pode ser ocultada por hoje (volta amanhã, até o fim do acesso).
export default function CancellationBanner() {
  const [notice, setNotice] = useState(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id
      if (!userId) { if (active) setNotice(null); return }
      const { data, error } = await supabase.rpc('get_my_cancellation_notice')
      if (!active) return
      if (error || !data?.access_until) { setNotice(null); return }
      let dismissed = false
      try { dismissed = localStorage.getItem(hideKey(userId, brazilDay())) === '1' } catch { /* sem localStorage: mostra */ }
      setNotice({ userId, accessUntil: data.access_until, daysLeft: data.days_left })
      setHidden(dismissed)
    }

    load()
    const { data: listener } = supabase.auth.onAuthStateChange(() => { setTimeout(load, 0) })
    return () => { active = false; listener?.subscription?.unsubscribe() }
  }, [])

  if (!notice || hidden) return null

  function hideToday() {
    try { localStorage.setItem(hideKey(notice.userId, brazilDay()), '1') } catch { /* ignora */ }
    setHidden(true)
  }

  return (
    <div className="cancel-notice" role="status">
      <span>{noticeText(notice.daysLeft, notice.accessUntil)}</span>
      <button type="button" onClick={hideToday} aria-label="Ocultar aviso por hoje" title="Ocultar por hoje">×</button>
    </div>
  )
}
