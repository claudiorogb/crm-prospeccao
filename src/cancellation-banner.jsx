import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { noticeText } from './cancellation-notice.js'
import './cancellation-banner.css'

// Faixa fina no topo enquanto o plano está cancelado e o acesso ainda vale. Sem popup e sem botão de fechar:
// fica visível durante todo o período restante.
export default function CancellationBanner() {
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let active = true

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id
      if (!userId) { if (active) setNotice(null); return }
      const { data, error } = await supabase.rpc('get_my_cancellation_notice')
      if (!active) return
      if (error || !data?.access_until) { setNotice(null); return }
      setNotice({ accessUntil: data.access_until, daysLeft: data.days_left })
    }

    load()
    const { data: listener } = supabase.auth.onAuthStateChange(() => { setTimeout(load, 0) })
    return () => { active = false; listener?.subscription?.unsubscribe() }
  }, [])

  if (!notice) return null

  return (
    <div className="cancel-notice" role="status">
      <span>{noticeText(notice.daysLeft, notice.accessUntil)}</span>
    </div>
  )
}
