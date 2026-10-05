import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import BillingPlanScreen from './billing-plan-screen'

function daysUntil(value) {
  if (!value) return null
  const end = new Date(value).getTime()
  if (!Number.isFinite(end)) return null
  return Math.ceil((end - Date.now()) / 86400000)
}

export default function TrialBanner() {
  const [daysLeft, setDaysLeft] = useState(null)
  const [showBilling, setShowBilling] = useState(false)

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
        .eq('status', 'trial')
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

  if (showBilling) {
    return <BillingPlanScreen onBack={() => setShowBilling(false)} />
  }

  if (!(daysLeft === 10 || (daysLeft >= 1 && daysLeft <= 5))) return null

  return (
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
  )
}
