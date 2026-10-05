import React, { useState } from 'react'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from './lib/supabase'
import BillingContractScreen from './billing-contract-screen'

const PLANS = [
  { id: 'axiva', name: 'AXIVA', price: 'R$ 45,00/mês' },
  { id: 'axiva_plus', name: 'AXIVA Plus', price: 'R$ 79,80/mês' },
  { id: 'axiva_max', name: 'AXIVA Max', price: 'R$ 164,80/mês' },
]

export default function BillingPlanScreen({ onBack, initialPlanId = '', paidSignup = null, asaasEnvironment = 'production' }) {
  const [loadingPlan, setLoadingPlan] = useState('')
  const [selectedPlan, setSelectedPlan] = useState(initialPlanId)
  const [licenseQuantity, setLicenseQuantity] = useState(1)
  const [error, setError] = useState('')

  async function openContract(planId) {
    if (loadingPlan) return
    setError('')
    setSelectedPlan(planId)
  }

  async function continueToAsaas() {
    if (!selectedPlan) return
    setLoadingPlan(selectedPlan)
    setError('')

    try {
      const functionName = asaasEnvironment === 'sandbox' ? 'create-asaas-checkout-sandbox' : 'create-asaas-checkout'
      const { data, error: functionError } = await supabase.functions.invoke(functionName, {
        body: { planId: selectedPlan, licenseQuantity },
      })

      if (functionError) throw functionError
      if (!data?.checkoutUrl) throw new Error(data?.error || 'Não foi possível iniciar a contratação.')
      if (asaasEnvironment === 'sandbox') localStorage.setItem('axiva_asaas_environment_v1', 'sandbox')
      else localStorage.removeItem('axiva_asaas_environment_v1')
      if (paidSignup) localStorage.removeItem('axiva_pending_paid_v1')

      window.location.assign(data.checkoutUrl)
    } catch (err) {
      setError(err?.message || 'Não foi possível iniciar a contratação. Tente novamente.')
      setLoadingPlan('')
    }
  }

  if (selectedPlan) {
    return (
      <BillingContractScreen
        planId={selectedPlan}
        licenseQuantity={licenseQuantity}
        paidSignup={paidSignup}
        onBack={() => { setSelectedPlan(''); setError('') }}
        onContinue={continueToAsaas}
      />
    )
  }

  return (
    <main
      className="auth-shell"
      style={{
        minHeight: '100vh',
        padding: '32px 20px',
        alignItems: 'flex-start',
        overflowY: 'auto',
      }}
    >
      <section
        className="auth-card"
        style={{
          width: 'min(760px, 100%)',
          maxWidth: 760,
          margin: '20px auto',
          padding: '32px',
        }}
      >
        {onBack && (
          <button
            type="button"
            className="text-button"
            onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 18 }}
          >
            <ArrowLeft size={16} /> Voltar
          </button>
        )}

        <div className="brand-mark">AX</div>
        <span className="eyebrow">CONTRATAÇÃO</span>
        <h1 style={{ marginBottom: 8 }}>Escolha seu plano</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Escolha o plano mensal do AXIVA CRM para continuar usando todos os recursos sem restrições.
        </p>

        <div style={{ marginTop: 22, padding: '14px 16px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <strong>Quantidade de usuários</strong>
            <div className="muted" style={{ fontSize: 13 }}>Cada usuário tem sua própria licença e pode ter um plano diferente depois.</div>
          </div>
          <select value={licenseQuantity} onChange={e => setLicenseQuantity(Math.max(1, Math.min(100, Number(e.target.value))))} style={{ width: 110 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} {n === 1 ? 'usuário' : 'usuários'}</option>)}
          </select>
        </div>

        <div
          style={{
            marginTop: 28,
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          {PLANS.map((plan, index) => (
            <div
              key={plan.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 180px 150px',
                alignItems: 'center',
                gap: 18,
                padding: '18px 20px',
                borderTop: index ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <strong style={{ color: '#0b192c', fontSize: 16 }}>{plan.name}</strong>
              <span style={{ color: '#475569', fontWeight: 600 }}>{plan.price}</span>
              <button
                type="button"
                className="primary full"
                onClick={() => openContract(plan.id)}
                disabled={Boolean(loadingPlan)}
                style={{ minHeight: 42, whiteSpace: 'nowrap' }}
              >
                {loadingPlan === plan.id ? (
                  <><Loader2 size={16} className="spin" /> Abrindo...</>
                ) : (
                  'Contratar'
                )}
              </button>
            </div>
          ))}
        </div>

        {error && (
          <div className="notice error" role="alert" style={{ marginTop: 18 }}>
            {error}
          </div>
        )}

        <p
          className="muted"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            marginTop: 20,
            fontSize: 13,
          }}
        >
          <CheckCircle2 size={16} style={{ flex: '0 0 auto', marginTop: 2, color: '#008e79' }} />
          Antes do pagamento, você verá o contrato de uso e dará seu aceite eletrônico. O pagamento será realizado em uma página segura do Asaas.
        </p>
      </section>

      <style>{`
        .spin { animation: axiva-spin .9s linear infinite; }
        @keyframes axiva-spin { to { transform: rotate(360deg); } }
        @media (max-width: 620px) {
          .auth-card { padding: 24px !important; }
          .auth-card > div[style*="grid-template-columns"] > div {
            grid-template-columns: 1fr !important;
            gap: 8px !important;
          }
        }
      `}</style>
    </main>
  )
}
