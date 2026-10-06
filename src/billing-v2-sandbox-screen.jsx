import React, { useEffect, useState } from 'react'
import { CheckCircle2, CreditCard, RefreshCw, ShieldCheck, Webhook } from 'lucide-react'
import { supabase } from './lib/supabase'
import BillingContractScreen from './billing-contract-screen'

const PLANS = [
  { id: 'axiva', name: 'AXIVA', value: 45 },
  { id: 'axiva_plus', name: 'AXIVA Plus', value: 79.8 },
  { id: 'axiva_max', name: 'AXIVA Max', value: 164.8 },
]

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function BillingV2SandboxScreen({ organization, userEmail }) {
  const [status, setStatus] = useState(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [planId, setPlanId] = useState(null)

  async function call(action) {
    const { data, error } = await supabase.functions.invoke('billing-v2-sandbox', {
      body: { action, organizationId: organization?.id }
    })
    let parsed = data
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch {}
    }
    if (error || parsed?.error) throw new Error(parsed?.error || error?.message || 'Falha na operação.')
    return parsed
  }

  async function load() {
    if (!organization?.id) return
    setLoading(true)
    setNotice('')
    try {
      setStatus(await call('status'))
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function setupWebhook() {
    setLoading(true)
    setNotice('')
    try {
      await call('setup_webhook')
      setNotice('Webhook do Billing V2 Sandbox configurado no Asaas.')
      await load()
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [organization?.id])

  if (planId) {
    return (
      <BillingContractScreen
        planId={planId}
        billingOrganizationId={organization?.id}
        onBack={() => setPlanId(null)}
      />
    )
  }

  const account = status?.account
  const licenses = status?.licenses || []
  const orders = status?.orders || []

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">BILLING V2 · SANDBOX</span>
          <h1>Testes do sistema de cobrança</h1>
          <p className="muted">Ambiente isolado. Nenhuma operação desta área altera a cobrança de Produção.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">AMBIENTE</span>
            <h2>{organization?.name || 'Organização de teste'}</h2>
            <p className="muted">Asaas Sandbox · Billing V2</p>
          </div>
          <div className="row-actions">
            <button className="secondary inline-btn" onClick={load} disabled={loading}><RefreshCw size={15}/> Atualizar</button>
            <button className="secondary inline-btn" onClick={setupWebhook} disabled={loading}><Webhook size={15}/> Configurar webhook</button>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <div className="panel"><span className="eyebrow">STATUS</span><h2>{account?.status || '—'}</h2><p className="muted">Conta Billing V2</p></div>
        <div className="panel"><span className="eyebrow">LICENÇAS</span><h2>{licenses.filter(x => x.status === 'active').length}</h2><p className="muted">Ativas</p></div>
        <div className="panel"><span className="eyebrow">PEDIDOS</span><h2>{orders.length}</h2><p className="muted">Últimos pedidos</p></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">CONTRATAÇÃO</span>
            <h2>Testar primeiro acesso</h2>
            <p className="muted">Escolha um plano. O contrato real será exibido; o pagamento será aberto no Asaas Sandbox.</p>
          </div>
          <ShieldCheck size={22}/>
        </div>
        <div className="campaign-list">
          {PLANS.map(plan => (
            <article className="panel campaign-card" key={plan.id}>
              <div>
                <strong>{plan.name}</strong>
                <h2>{money(plan.value)}/mês</h2>
                <p className="muted">1 licença • Checkout recorrente Sandbox</p>
              </div>
              <button className="primary inline-btn" onClick={() => setPlanId(plan.id)}>
                <CreditCard size={16}/> Testar contratação
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div><span className="eyebrow">LICENÇAS</span><h2>Estado atual</h2></div>
          <CheckCircle2 size={21}/>
        </div>
        {licenses.length === 0 ? <p className="muted">Nenhuma licença Billing V2 criada ainda.</p> : (
          <div className="admin-list">
            {licenses.map(item => (
              <div className="admin-list-row" key={item.id}>
                <div>
                  <strong>{item.plan_id}</strong>
                  <span>{item.status} • usuário {item.user_id || 'pendente'}</span>
                  {item.asaas_subscription_id && <small>Assinatura Asaas: {item.asaas_subscription_id}</small>}
                </div>
                <span>{item.pending_plan_id ? 'Próximo: ' + item.pending_plan_id : ''}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><div><span className="eyebrow">PEDIDOS</span><h2>Últimos pedidos</h2></div></div>
        {orders.length === 0 ? <p className="muted">Nenhum pedido criado.</p> : (
          <div className="admin-list">
            {orders.map(order => (
              <div className="admin-list-row" key={order.id}>
                <div>
                  <strong>{order.order_type} · {order.plan_id}</strong>
                  <span>{order.status} • {money(order.amount)}</span>
                  <small>{order.asaas_checkout_id ? 'Checkout: ' + order.asaas_checkout_id : 'Checkout ainda não criado'}</small>
                </div>
                {order.prorata_amount ? <strong>Pró-rata: {money(order.prorata_amount)}</strong> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
