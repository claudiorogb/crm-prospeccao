import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Save, Users } from 'lucide-react'
import { supabase } from './lib/supabase'

export default function AdminUserPlans() {
  const [users, setUsers] = useState([])
  const [plans, setPlans] = useState([])
  const [drafts, setDrafts] = useState({})
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

  return (
    <section className="panel">
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
          {users.map(user => (
            <div className="admin-list-row" key={`${user.organization_id}-${user.user_id}`}>
              <div>
                <strong>{user.full_name || user.email || 'Usuário'}</strong>
                <span>{user.email || 'E-mail não informado'}</span>
                <small>{user.organization_name || 'Sem organização'} · {user.trial_active ? `Trial até ${new Date(user.trial_ends_at).toLocaleDateString('pt-BR')}` : user.plan_name || 'Sem plano'}</small>
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
          {!users.length && <p className="muted"><Users size={16}/> Nenhum usuário encontrado.</p>}
        </div>
      )}
    </section>
  )
}
