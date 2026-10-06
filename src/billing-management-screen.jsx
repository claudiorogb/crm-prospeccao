import React, { useEffect, useState } from 'react'
import { Loader2, UserMinus, XCircle } from 'lucide-react'
import { supabase } from './lib/supabase'
import BillingPlanScreen from './billing-plan-screen'

const PLANS = {
  axiva: { name: 'AXIVA', value: 45 },
  axiva_plus: { name: 'AXIVA Plus', value: 79.8 },
  axiva_max: { name: 'AXIVA Max', value: 164.8 },
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const DEFAULT_ASAAS_ENVIRONMENT = String(import.meta.env.VITE_ASAAS_ENVIRONMENT || '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production'

export default function BillingManagementScreen({ onBackToCrm, isFreeTrial = false }) {
  const asaasEnvironment = (() => {
    if (DEFAULT_ASAAS_ENVIRONMENT === 'sandbox') return 'sandbox'
    try { return localStorage.getItem('axiva_asaas_environment_v1') === 'sandbox' ? 'sandbox' : DEFAULT_ASAAS_ENVIRONMENT } catch { return DEFAULT_ASAAS_ENVIRONMENT }
  })()
  const billingFunction = asaasEnvironment === 'sandbox' ? 'manage-asaas-billing-sandbox' : 'manage-asaas-billing'
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [contracting, setContracting] = useState(false)
  const [pendingChange, setPendingChange] = useState(null)

  async function load() {
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('get_my_billing_overview')
    if (rpcError) setError(rpcError.message)
    else { setOverview(data); setError('') }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function manage(action, userId, planId = '') {
    const key = action + ':' + userId
    setBusy(key); setError(''); setMessage('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke(billingFunction, { body: { action, userId, planId } })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error + (data.requiresReauthorization ? ' A forma de pagamento pode exigir nova autorização no Asaas.' : ''))
      setMessage('Alteração realizada. Nova mensalidade: ' + money(data.totalMonthly) + '.')
      await load()
    } catch (err) {
      setError(err?.message || 'Não foi possível alterar a assinatura.')
    } finally { setBusy('') }
  }

  async function cancelPlan() {
    if (!window.confirm('Cancelar a assinatura da empresa? Os dados do CRM serão preservados.')) return
    setBusy('cancel'); setError(''); setMessage('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke(billingFunction, { body: { action: 'cancel' } })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      setMessage('Assinatura cancelada. Os dados do CRM foram preservados.')
      await load()
    } catch (err) {
      setError(err?.message || 'Não foi possível cancelar a assinatura.')
    } finally { setBusy('') }
  }

  if (loading) return <div className="loading-screen">Carregando plano...</div>
  if (contracting) return <BillingPlanScreen onBack={() => setContracting(false)} asaasEnvironment={asaasEnvironment} hideTrialOption={isFreeTrial} />

  const account = overview?.billing_account
  const members = overview?.members || []
  const canManage = Boolean(overview?.can_manage)
  const hasPaid = account?.status === 'active' || account?.status === 'past_due'
  const activeCount = members.filter(m => m.plan_status === 'active' && !m.trial_ends_at).length

  return (
    <div>
      <header className="section-header">
        <div>
          <span className="eyebrow">COBRANÇA</span>
          <h1>Meu plano</h1>
          <p className="muted">Planos, usuários e cobrança mensal da empresa.</p>
        </div>
        {onBackToCrm && <button className="secondary inline-btn" onClick={onBackToCrm}>Voltar ao CRM</button>}
      </header>

      {error && <div className="notice error" style={{ marginBottom: 16 }}>{error}</div>}
      {message && <div className="notice" style={{ marginBottom: 16 }}>{message}</div>}

      {canManage && pendingChange && (
        <section className="notice" role="alert" style={{ marginBottom: 16, padding: '16px 18px', border: '1px solid #cbd5e1', background: '#f8fafc' }}>
          <div style={{ fontWeight: 700, color: '#0b192c', marginBottom: 6 }}>Confirmar mudança de plano</div>
          <div style={{ color: '#475569', lineHeight: 1.5 }}>
            Deseja realmente mudar o plano de <strong>{pendingChange.memberName}</strong>?
            <br />
            Novo plano: <strong>{pendingChange.planName}</strong> — <strong>{money(pendingChange.planValue)}/mês</strong>.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="primary inline-btn"
              disabled={Boolean(busy)}
              onClick={async () => {
                const change = pendingChange
                setPendingChange(null)
                await manage('change_plan', change.userId, change.planId)
              }}
            >
              {busy === 'change_plan:' + pendingChange.userId ? <><Loader2 size={15} className="spin" /> Confirmando...</> : 'Confirmar mudança'}
            </button>
            <button
              type="button"
              className="secondary inline-btn"
              disabled={Boolean(busy)}
              onClick={() => setPendingChange(null)}
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <span className="eyebrow">ASSINATURA</span>
            <h2 style={{ margin: '6px 0' }}>{isFreeTrial ? 'Plano gratuito' : (hasPaid ? 'Assinatura ativa' : 'Sem assinatura ativa')}</h2>
            <p className="muted" style={{ margin: 0 }}>{isFreeTrial ? 'Período gratuito de 30 dias.' : 'Uma única cobrança mensal reúne os usuários licenciados.'}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 13 }}>Plano</div>
            <strong style={{ fontSize: 20, color: '#0b192c' }}>{isFreeTrial ? 'gratuito' : '—'}</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Valor</div>
            <strong style={{ fontSize: 28, color: '#0b192c' }}>{isFreeTrial ? 'R$0,00' : money(overview?.total_monthly)}</strong>
            {!hasPaid && canManage && <div style={{ marginTop: 10 }}><button className="primary inline-btn" onClick={() => setContracting(true)}>Contratar plano</button></div>}
          </div>
        </div>
        {account?.next_due_date && <div className="muted" style={{ marginTop: 14 }}>Próxima cobrança: {new Date(account.next_due_date + 'T12:00:00').toLocaleDateString('pt-BR')}</div>}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <div><span className="eyebrow">USUÁRIOS</span><h2 style={{ margin: '6px 0' }}>Licenças por usuário</h2></div>
          <strong>{activeCount} ativos</strong>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={{ textAlign: 'left', padding: 10 }}>Usuário</th><th style={{ textAlign: 'left', padding: 10 }}>Plano</th><th style={{ textAlign: 'right', padding: 10 }}>Valor</th>{canManage && <th />}</tr></thead>
            <tbody>
              {members.map(member => {
                const active = member.plan_status === 'active' && !member.trial_ends_at
                return (
                  <tr key={member.user_id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: 10 }}><strong>{member.full_name || member.email}</strong><div className="muted" style={{ fontSize: 12 }}>{member.email}</div></td>
                    <td style={{ padding: 10 }}>
                      {canManage && hasPaid ? (
                        <select
                          value={active ? (member.plan_id || 'axiva') : ''}
                          onChange={e => {
                            const nextPlanId = e.target.value
                            const currentPlanId = active ? (member.plan_id || 'axiva') : ''
                            if (!nextPlanId || nextPlanId === currentPlanId) return
                            const nextPlan = PLANS[nextPlanId]
                            setPendingChange({
                              userId: member.user_id,
                              memberName: member.full_name || member.email || 'usuário',
                              planId: nextPlanId,
                              planName: nextPlan.name,
                              planValue: nextPlan.value,
                            })
                          }}
                          disabled={Boolean(busy) || Boolean(pendingChange)}
                          style={{ minWidth: 170 }}
                        >
                          {!active && <option value="">Sem licença</option>}
                          {Object.entries(PLANS).map(([id, plan]) => <option key={id} value={id}>{plan.name}</option>)}
                        </select>
                      ) : <span>{active ? member.plan_name : 'Sem licença'}</span>}
                    </td>
                    <td style={{ padding: 10, textAlign: 'right' }}>{active ? money(member.price_monthly) : '—'}</td>
                    {canManage && <td style={{ padding: 10, textAlign: 'right' }}>{active && activeCount > 1 && <button className="secondary inline-btn" onClick={() => manage('remove_user', member.user_id)} disabled={Boolean(busy)}>{busy === 'remove_user:' + member.user_id ? <Loader2 size={15} className="spin" /> : <UserMinus size={15} />} Remover licença</button>}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {canManage && hasPaid && <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Ao atribuir um plano a um usuário sem licença, o AXIVA utiliza uma licença disponível ou acrescenta uma nova licença à cobrança.</p>}
      </section>

      {canManage && hasPaid && <section className="panel" style={{ marginTop: 16 }}>
        <span className="eyebrow">ASSINATURA</span>
        <h2 style={{ margin: '6px 0' }}>Cancelar plano</h2>
        <p className="muted">O cancelamento encerra a recorrência no Asaas e preserva os dados comerciais.</p>
        <button className="secondary inline-btn" onClick={cancelPlan} disabled={Boolean(busy)}>{busy === 'cancel' ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />} Cancelar assinatura</button>
      </section>}

      <style>{'.spin{animation:axiva-spin .9s linear infinite}@keyframes axiva-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}
