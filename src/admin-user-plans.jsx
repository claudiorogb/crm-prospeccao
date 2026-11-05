import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Save, Users } from 'lucide-react'
import { supabase } from './lib/supabase'

export default function AdminUserPlans() {
  const [users, setUsers] = useState([])
  const [plans, setPlans] = useState([])
  const [drafts, setDrafts] = useState({})
  const [summary, setSummary] = useState(null)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setNotice('')
    setError('')
    const { data, error: fnError } = await supabase.rpc('admin_list_user_plans')
    setLoading(false)
    if (fnError) {
      setError(fnError.message)
      return
    }
    // Resumo é complementar: se falhar, a lista de planos continua funcionando.
    const { data: summaryData } = await supabase.rpc('admin_plans_summary')
    setSummary(summaryData || null)
    setUsers(data?.users || [])
    setPlans(data?.plans || [])
    setDrafts(Object.fromEntries((data?.users || []).map(user => [user.user_id, user.plan_id || ''])))
  }, [])

  useEffect(() => { load() }, [load])

  async function save(user) {
    const planId = drafts[user.user_id]
    if (!planId) return
    setSaving(user.user_id)
    setNotice('')
    setError('')
    const { error: saveError } = await supabase.rpc('admin_set_user_plan', {
      p_user_id: user.user_id,
      p_organization_id: user.organization_id,
      p_plan_id: planId
    })
    setSaving('')
    if (saveError) {
      setError(saveError.message)
      return
    }
    setNotice(`Plano de ${user.full_name || user.email || 'usuário'} atualizado.`)
    await load()
  }

  const categoriesByUser = Object.fromEntries((summary?.users || []).map(item => [`${item.organization_id}-${item.user_id}`, item.categories || []]))
  const visibleUsers = users.filter(user => {
    if (filter === 'all') return true
    const key = `${user.organization_id}-${user.user_id}`
    if (filter.startsWith('plan:')) return user.plan_id === filter.slice(5) && user.status === 'active'
    return (categoriesByUser[key] || []).includes(filter)
  })
  const totals = summary?.totals || {}
  const summaryCards = [
    ['paying', 'Pagando', totals.paying],
    ['trial', 'Em trial', totals.trial],
    ['paid_after_trial', 'Pagaram após o trial', totals.paid_after_trial],
    ['trial_expired', 'Trial vencido sem pagar', totals.trial_expired],
    ['cancelled_after_trial', 'Cancelaram após o trial', totals.cancelled_after_trial],
    ['cancelled', 'Cancelados / suspensos', totals.cancelled],
    ['unconfirmed', 'Cadastro não confirmado', totals.unconfirmed]
  ]

  return (
    <section className="panel">
      {summary && (
        <div className="admin-plans-summary" style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {summaryCards.map(([key, label, value]) => (
              <button
                type="button"
                key={key}
                className={filter === key ? 'primary' : 'secondary'}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 12px', textAlign: 'left' }}
                onClick={() => setFilter(current => current === key ? 'all' : key)}
              >
                <strong style={{ fontSize: 22 }}>{value ?? 0}</strong>
                <span style={{ fontSize: 12 }}>{label}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>Usuários por plano:</span>
            {(summary.by_plan || []).map(plan => (
              <button
                type="button"
                key={plan.plan_id}
                className={filter === `plan:${plan.plan_id}` ? 'primary mini' : 'secondary mini'}
                onClick={() => setFilter(current => current === `plan:${plan.plan_id}` ? 'all' : `plan:${plan.plan_id}`)}
              >
                {plan.plan_name}: {plan.users}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Clique em um número para filtrar a lista abaixo. "Pagaram/cancelaram após o trial" contam a partir de hoje (o sistema não guardava esse histórico antes).
            {filter !== 'all' && <> <button type="button" className="secondary mini" onClick={() => setFilter('all')}>Limpar filtro</button></>}
          </p>
        </div>
      )}
      <header className="admin-section-header">
        <div>
          <span className="eyebrow">PLANOS E ACESSOS</span>
          <h2>Planos por usuário</h2>
          <p className="muted">O plano é individual. Alterar o plano de um usuário não altera os demais usuários da empresa.</p>
        </div>
        <button type="button" className="secondary" onClick={load} disabled={loading}>
          <RefreshCw size={15} /> Atualizar
        </button>
      </header>

      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}

      {loading ? <p className="muted">Carregando usuários...</p> : (
        <div className="admin-list">
          {visibleUsers.map(user => (
            <div className="admin-list-row" key={`${user.organization_id}-${user.user_id}`}>
              <div>
                <strong>{user.full_name || user.email || 'Usuário'}</strong>
                <span>{user.email || 'E-mail não informado'}</span>
                <small>{user.organization_name || 'Sem organização'} · {user.trial_active ? `Trial até ${new Date(user.trial_ends_at).toLocaleDateString('pt-BR')}` : user.plan_name || 'Sem plano'}{(categoriesByUser[`${user.organization_id}-${user.user_id}`] || []).includes('unconfirmed') ? ' · E-mail não confirmado' : ''}</small>
              </div>
              <div className="row-actions">
                <select
                  aria-label={`Plano de ${user.email || 'usuário'}`}
                  value={drafts[user.user_id] || ''}
                  onChange={event => setDrafts(current => ({ ...current, [user.user_id]: event.target.value }))}
                  disabled={saving === user.user_id}
                >
                  <option value="" disabled>Selecionar plano</option>
                  {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} — R$ {Number(plan.price_monthly).toFixed(2).replace('.', ',')}</option>)}
                </select>
                <button type="button" className="secondary mini" onClick={() => save(user)} disabled={saving === user.user_id || !drafts[user.user_id]}>
                  <Save size={13} /> {saving === user.user_id ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          ))}
          {!visibleUsers.length && <p className="muted"><Users size={16}/> Nenhum usuário encontrado.</p>}
        </div>
      )}
    </section>
  )
}
