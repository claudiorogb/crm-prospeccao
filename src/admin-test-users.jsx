import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

// Usuários de demonstração da empresa Teste.
// Somente o administrador do sistema monta esta tela, e cada ação é revalidada no servidor:
//  - Incluir: admin-add-user (cria a conta, vincula à Teste como Usuário, libera o Plano AXIVA
//    sem Asaas e sem Trial e envia o e-mail para definir a senha);
//  - Bloquear/Desbloquear: admin_manage_organizations › set_account_status (conta suspensa);
//  - Excluir: archive_user_soft (vai para Usuários excluídos, de onde pode ser reativado).
// Os usuários entram sempre como "Usuário": sem acesso à Administração nem a Equipe/Meu plano.
const DEMO_PLAN_ID = 'axiva'

export default function AdminTestUsers({ organization, adminUserId }) {
  const [members, setMembers] = useState([])
  const [form, setForm] = useState({ name: '', email: '' })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  const isTest = organization?.is_sandbox === true

  const load = useCallback(async () => {
    if (!organization?.id || !isTest) return
    setLoading(true)
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', {
      body: { action: 'list_users' }
    })
    setLoading(false)
    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível listar os usuários.')
      return
    }
    setMembers((data?.users || []).flatMap(user =>
      (user.organizations || [])
        .filter(m => m.organization_id === organization.id)
        .map(m => ({ ...user, membership: m }))
    ))
  }, [organization?.id, isTest])

  useEffect(() => { load() }, [load])

  async function add(e) {
    e.preventDefault()
    if (busy || !isTest) return
    const name = form.name.trim().replace(/\s+/g, ' ')
    const email = form.email.trim().toLowerCase()
    setBusy(true)
    setNotice('')
    const { data, error } = await supabase.functions.invoke('admin-add-user', {
      body: { organizationId: organization.id, name, email, role: 'member', planId: DEMO_PLAN_ID }
    })
    setBusy(false)
    if (error || data?.error) {
      let detail = data?.error || ''
      if (!detail) { try { detail = (await error?.context?.json?.())?.error || '' } catch {} }
      setNotice(detail || error?.message || 'Não foi possível incluir o usuário.')
      if (data?.ok) { setForm({ name: '', email: '' }); await load() }
      return
    }
    setForm({ name: '', email: '' })
    setNotice(`${name} foi incluído na empresa Teste com o Plano AXIVA, sem cobrança. O e-mail para definir a senha foi enviado para ${email}.`)
    await load()
  }

  async function setBlocked(member, blocked) {
    if (busy || !isTest || member.id === adminUserId) return
    setBusy(true)
    setNotice('')
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', {
      body: { action: 'set_account_status', user_id: member.id, status: blocked ? 'suspended' : 'active' }
    })
    setBusy(false)
    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível alterar o acesso.')
      return
    }
    const label = member.full_name || member.email
    setNotice(blocked
      ? `Acesso de ${label} bloqueado. Ao entrar, ele verá "Conta suspensa" até ser desbloqueado.`
      : `Acesso de ${label} desbloqueado.`)
    await load()
  }

  async function remove(member) {
    if (busy || !isTest || member.id === adminUserId) return
    setBusy(true)
    setNotice('')
    const { error } = await supabase.rpc('archive_user_soft', { target_user: member.id })
    setBusy(false)
    if (error) {
      setNotice(error.message || 'Não foi possível excluir o usuário.')
      return
    }
    setNotice(`${member.full_name || member.email} foi excluído. Ele não acessa mais o CRM e aparece em Administração › Usuários › Usuários excluídos, de onde pode ser reativado.`)
    await load()
  }

  if (!isTest) return <div className="notice error">Organização de testes não encontrada.</div>

  const demoMembers = members.filter(member => member.id !== adminUserId)

  return <section className="panel">
    <span className="eyebrow">ACESSO EXCLUSIVO AO TESTE</span>
    <h2>Usuários de demonstração</h2>
    <p className="muted">Inclua quem vai usar a empresa Teste em demonstrações. A conta é criada já dentro da Teste, com o Plano AXIVA liberado sem cobrança e sem período de testes, e a pessoa recebe um e-mail para definir a senha. Esses usuários não acessam a Administração. Todos veem os mesmos leads e o mesmo Kanban da empresa Teste.</p>
    {notice && <div className="notice" role="status">{notice}</div>}

    <form className="admin-member-form demo-user-form" onSubmit={add}>
      <input
        aria-label="Nome do usuário de demonstração"
        value={form.name}
        onChange={e => setForm({ ...form, name: e.target.value })}
        placeholder="Nome"
        minLength={2}
        maxLength={80}
        required
        disabled={busy}
      />
      <input
        type="email"
        aria-label="E-mail do usuário de demonstração"
        value={form.email}
        onChange={e => setForm({ ...form, email: e.target.value })}
        placeholder="usuario@exemplo.com"
        required
        disabled={busy}
      />
      <button className="primary inline-btn" disabled={busy}>{busy ? 'Salvando...' : 'Incluir usuário'}</button>
    </form>

    <div className="admin-list">
      {demoMembers.map(member => {
        const blocked = member.account_status === 'suspended' || member.account_status === 'inactive'
        const label = member.full_name || member.email || 'usuário'
        return <div className="admin-list-row" key={member.id}>
          <div>
            <strong>{member.full_name || member.email || 'Usuário'}</strong>
            <span>{member.email || 'E-mail não informado'}</span>
            <small>{blocked ? 'Acesso bloqueado' : 'Acesso liberado'}{member.last_sign_in_at ? '' : ' · ainda não entrou no CRM'}</small>
          </div>
          <div className="row-actions">
            <button type="button" className="secondary mini" disabled={busy}
              onClick={() => setBlocked(member, !blocked)}>
              {blocked ? 'Desbloquear acesso' : 'Bloquear acesso'}
            </button>
            <button type="button" className="text-danger mini" disabled={busy}
              data-confirm-message={`Tem certeza que deseja excluir o usuário “${label}”? Ele deixará de acessar o CRM e irá para Usuários excluídos, de onde pode ser reativado. Os dados ficam preservados no banco.`}
              onClick={() => remove(member)}>
              Excluir
            </button>
          </div>
        </div>
      })}
      {!loading && !demoMembers.length && <p className="muted">Nenhum usuário de demonstração.</p>}
    </div>
  </section>
}
