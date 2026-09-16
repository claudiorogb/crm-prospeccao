import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

// Apenas o administrador do sistema pode montar esta tela. A inclusão também
// é revalidada no banco, sem transferir contas de organizações reais.
export default function AdminTestUsers({ organization, adminUserId }) {
  const [members, setMembers] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!organization?.id || organization.is_sandbox !== true) return
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', {
      body: { action: 'list_users' }
    })
    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível listar os usuários.')
      return
    }
    setMembers((data?.users || []).flatMap(user =>
      (user.organizations || [])
        .filter(m => m.organization_id === organization.id)
        .map(m => ({ ...user, membership: m }))
    ))
  }, [organization?.id, organization?.is_sandbox])

  useEffect(() => { load() }, [load])

  async function add(e) {
    e.preventDefault()
    if (busy || organization?.is_sandbox !== true) return
    setBusy(true)
    setNotice('')
    const { error } = await supabase.rpc('admin_test_add_member', {
      p_email: email.trim().toLowerCase(), p_role: role
    })
    setBusy(false)
    if (error) { setNotice(error.message); return }
    setEmail('')
    setNotice('Usuário vinculado somente ao Teste.')
    await load()
  }

  async function change(member, patch) {
    if (busy || organization?.is_sandbox !== true || member.id === adminUserId) return
    setBusy(true)
    setNotice('')
    const { error } = await supabase.from('organization_members').update(patch)
      .eq('organization_id', organization.id).eq('user_id', member.id)
    setBusy(false)
    setNotice(error ? error.message : 'Acesso ao Teste atualizado.')
    if (!error) await load()
  }

  if (organization?.is_sandbox !== true) return <div className="notice error">Organização de testes não encontrada.</div>

  return <section className="panel">
    <span className="eyebrow">ACESSO EXCLUSIVO AO TESTE</span>
    <h2>Usuários da empresa Teste</h2>
    <p className="muted">Adicione uma conta já cadastrada no CRM. Por segurança, contas vinculadas a outras empresas não são transferidas. Para um novo usuário, ele deve primeiro criar a própria conta na tela de acesso.</p>
    {notice && <div className="notice" role="status">{notice}</div>}
    <form className="admin-member-form" onSubmit={add}>
      <input type="email" aria-label="E-mail do usuário de teste" value={email}
        onChange={e => setEmail(e.target.value)} placeholder="usuario@exemplo.com" required disabled={busy}/>
      <select aria-label="Perfil no Teste" value={role} onChange={e => setRole(e.target.value)} disabled={busy}>
        <option value="member">Usuário</option><option value="admin">Administrador da empresa</option>
      </select>
      <button className="primary inline-btn" disabled={busy}>{busy ? 'Salvando...' : 'Adicionar ao Teste'}</button>
    </form>
    <div className="admin-list">
      {members.map(member => <div className="admin-list-row" key={member.id}>
        <div><strong>{member.full_name || member.email || 'Usuário'}</strong>
          <span>{member.email || 'E-mail não informado'}</span>
          <small>{member.membership.is_active ? 'Ativo no Teste' : 'Suspenso no Teste'}</small>
        </div>
        <div className="row-actions">
          <select aria-label={`Perfil no Teste de ${member.email || 'usuário'}`} value={member.membership.role}
            disabled={busy || member.id === adminUserId}
            onChange={e => change(member, { role: e.target.value })}>
            <option value="member">Usuário</option><option value="admin">Administrador da empresa</option>
            {member.membership.role === 'owner' && <option value="owner">Proprietário</option>}
          </select>
          {member.id !== adminUserId && <button className="secondary mini" disabled={busy}
            onClick={() => change(member, { is_active: !member.membership.is_active })}>
            {member.membership.is_active ? 'Suspender no Teste' : 'Reativar no Teste'}
          </button>}
        </div>
      </div>)}
      {!members.length && <p className="muted">Nenhum usuário vinculado.</p>}
    </div>
  </section>
}
