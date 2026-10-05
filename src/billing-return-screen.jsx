import React, { useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'

export default function BillingReturnScreen({ status }) {
  const [checking, setChecking] = useState(false)

  const success = status === 'success'
  const cancelled = status === 'cancelled'
  const expired = status === 'expired'

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => window.location.reload(), 2500)
    return () => window.clearTimeout(timer)
  }, [success])

  function clearAndReload() {
    setChecking(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('billing')
    window.history.replaceState({}, '', url.toString())
    window.location.reload()
  }

  return (
    <main className="auth-shell">
      <section className="auth-card access-state-card" style={{ maxWidth: 620 }}>
        <div className="brand-mark">AX</div>
        <span className="eyebrow">CONTRATAÇÃO</span>

        {success ? (
          <>
            <CheckCircle2 size={42} style={{ margin: '4px 0 14px', color: '#008e79' }} />
            <h1>Pagamento recebido</h1>
            <p className="muted">
              O Asaas confirmou a conclusão da jornada de pagamento. Estamos atualizando seu acesso ao AXIVA CRM.
            </p>
            <p className="muted">A página será atualizada automaticamente.</p>
          </>
        ) : (
          <>
            <XCircle size={42} style={{ margin: '4px 0 14px', color: '#64748b' }} />
            <h1>{cancelled ? 'Contratação cancelada' : 'Checkout expirado'}</h1>
            <p className="muted">
              {cancelled
                ? 'Nenhuma alteração foi feita no seu plano.'
                : 'O checkout expirou. Você pode iniciar uma nova contratação quando desejar.'}
            </p>
          </>
        )}

        <button className="primary full" onClick={clearAndReload} disabled={checking} style={{ marginTop: 20 }}>
          <RefreshCw size={17} /> {checking ? 'Atualizando...' : 'Verificar meu acesso'}
        </button>
      </section>
    </main>
  )
}
