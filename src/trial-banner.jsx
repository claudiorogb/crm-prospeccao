import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import BillingPlanScreen from './billing-plan-screen'

// Dias em que o aviso também abre como popup (uma vez por dia de aviso, por usuário).
const POPUP_DAYS = [10, 5, 4, 3, 2, 1]
const popupKey = (userId, days) => `axiva_trial_popup_v1:${userId}:${days}`

function daysUntil(value) {
  if (!value) return null
  const end = new Date(value).getTime()
  if (!Number.isFinite(end)) return null
  return Math.ceil((end - Date.now()) / 86400000)
}

export default function TrialBanner() {
  const [daysLeft, setDaysLeft] = useState(null)
  const [showBilling, setShowBilling] = useState(false)
  const [popupDays, setPopupDays] = useState(null)
  const [popupUser, setPopupUser] = useState('')

  useEffect(() => {
    let active = true
    let timer

    async function loadTrial() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id
      if (!userId) {
        if (active) setDaysLeft(null)
        return
      }

      const { data, error } = await supabase
        .from('user_plan_assignments')
        .select('status,trial_ends_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .not('trial_ends_at', 'is', null)
        .order('trial_ends_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!active || error || !data?.trial_ends_at) {
        if (active) setDaysLeft(null)
        return
      }

      const update = () => {
        if (!active) return
        const remaining = daysUntil(data.trial_ends_at)
        setDaysLeft(remaining)
        if (POPUP_DAYS.includes(remaining)) {
          let seen = false
          try { seen = localStorage.getItem(popupKey(userId, remaining)) === '1' } catch { /* sem localStorage: mostra o popup */ }
          if (!seen) { setPopupUser(userId); setPopupDays(remaining) }
        }
      }

      update()
      timer = window.setInterval(update, 60000)
    }

    loadTrial()

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      loadTrial()
    })

    return () => {
      active = false
      if (timer) window.clearInterval(timer)
      listener?.subscription?.unsubscribe()
    }
  }, [])

  function closePopup() {
    try { if (popupUser && popupDays) localStorage.setItem(popupKey(popupUser, popupDays), '1') } catch { /* ignora */ }
    setPopupDays(null)
  }

  if (showBilling) {
    return <BillingPlanScreen onBack={() => setShowBilling(false)} hideTrialOption />
  }

  const popup = popupDays ? (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(11,25,44,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1300 }}>
      <div style={{ maxWidth: 460, width: '100%', background: '#fff', borderRadius: 14, padding: '24px 22px', boxShadow: '0 20px 50px rgba(11,25,44,.25)', color: '#0b192c' }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 20 }}>Período de testes</h2>
        <p style={{ margin: 0, lineHeight: 1.5, color: '#334155' }}>
          Faltam {popupDays} {popupDays === 1 ? 'dia' : 'dias'} para acabar o período de testes, contrate o plano mensal e continue usando o AXIVA CRM sem restrições.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="secondary inline-btn" onClick={closePopup}>Agora não</button>
          <button type="button" className="primary inline-btn" onClick={() => { closePopup(); setShowBilling(true) }}>Contratar plano mensal</button>
        </div>
      </div>
    </div>
  ) : null

  if (!(daysLeft === 10 || (daysLeft >= 1 && daysLeft <= 5))) return null

  return (
    <>
    {popup}
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1200,
        width: '100%',
        padding: '11px 18px',
        background: '#fff7df',
        borderBottom: '1px solid #f0d48a',
        color: '#5b4300',
        textAlign: 'center',
        fontSize: '14px',
        lineHeight: 1.45,
        fontWeight: 600,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span>
        Faltam {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} para acabar o período de testes, contrate o plano mensal e continue usando o AXIVA CRM sem restrições.
      </span>
      <button
        type="button"
        onClick={() => setShowBilling(true)}
        style={{
          border: 0,
          borderRadius: 5,
          padding: '8px 13px',
          background: '#0b192c',
          color: '#fff',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Contratar plano mensal
      </button>
    </div>
    </>
  )
}
