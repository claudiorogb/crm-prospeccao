import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, RefreshCw, ChevronLeft, Save, Users, Bot, Power } from 'lucide-react'
import { supabase } from './lib/supabase'

function errorMessage(error, fallback) {
  return error?.message || fallback
}

export default function AdminAiLimits({ reloadOrganizations }) {
  const [organizations, setOrganizations] = useState([])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [users, setUsers] = useState([])
  const [companyForm, setCompanyForm] = useState({ daily_request_limit: '1000', daily_message_limit: '100' })
  const [userDrafts, setUserDrafts] = useState({})
  const [loadingOrganizations, setLoadingOrganizations] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [savingCompany, setSavingCompany] = useState(false)
  const [togglingOrganizationId, setTogglingOrganizationId] = useState('')
  const [savingUserId, setSavingUserId] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeType, setNoticeType] = useState('success')
  const userLoadSequence = useRef(0)

  const selectedOrganization = organizations.find(item => item.id === selectedOrganizationId) || null

  const loadOrganizations = useCallback(async () => {
    setLoadingOrganizations(true)
    const { data, error } = await supabase.functions.invoke('admin_ai_limits', {
      body: { action: 'list_organizations' },
    })
    setLoadingOrganizations(false)

    if (error || data?.error) {
      setNotice(errorMessage(data?.error ? new Error(data.error) : error, 'Não foi possível carregar as empresas.'))
      setNoticeType('error')
      return
    }

    setOrganizations(data?.organizations || [])
  }, [])

  const loadUsers = useCallback(async organizationId => {
    if (!organizationId) return
    const sequence = ++userLoadSequence.current
    setLoadingUsers(true)
    setUsers([])
    const { data, error } = await supabase.functions.invoke('admin_ai_limits', {
      body: { action: 'list_users', organization_id: organizationId },
    })
    if (sequence !== userLoadSequence.current) return
    setLoadingUsers(false)

    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível carregar os usuários da empresa.')
      setNoticeType('error')
      return
    }

    setUsers(data?.users || [])
    setCompanyForm({
      daily_request_limit: String(data?.organization?.daily_request_limit ?? 1000),
      daily_message_limit: String(data?.organization?.daily_message_limit ?? 100),
    })
    setUserDrafts(Object.fromEntries((data?.users || []).map(item => [
      item.user_id,
      item.daily_message_limit_override == null ? '' : String(item.daily_message_limit_override),
    ])))
  }, [])

  useEffect(() => {
    loadOrganizations()
    const refreshOnFocus = () => loadOrganizations()
    window.addEventListener('focus', refreshOnFocus)

    const channel = supabase
      .channel('admin-ai-limits-organizations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organizations' }, () => {
        loadOrganizations()
      })
      .subscribe()

    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      supabase.removeChannel(channel)
    }
  }, [loadOrganizations])

  async function refreshList() {
    await loadOrganizations()
    if (reloadOrganizations) await reloadOrganizations()
  }

  async function selectOrganization(organization) {
    setSelectedOrganizationId(organization.id)
    setNotice('')
    setUsers([])
    setCompanyForm({
      daily_request_limit: String(organization.daily_request_limit ?? 1000),
      daily_message_limit: String(organization.daily_message_limit ?? 100),
    })
    await loadUsers(organization.id)
  }

  async function toggleOrganizationAi(organization) {
    const enabled = !organization.ai_enabled
    setTogglingOrganizationId(organization.id)
    setNotice('')

    const { data, error } = await supabase.functions.invoke('admin_ai_limits', {
      body: {
        action: 'toggle_organization_ai',
        organization_id: organization.id,
        enabled,
      },
    })

    setTogglingOrganizationId('')
    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível alterar o acesso à IA.')
      setNoticeType('error')
      return
    }

    setNotice(`IA ${enabled ? 'ativada' : 'desativada'} para ${organization.name}.`)
    setNoticeType('success')
    await loadOrganizations()
    if (reloadOrganizations) await reloadOrganizations()
  }

  async function saveCompanyLimits(event) {
    event.preventDefault()
    if (!selectedOrganizationId) return
    setSavingCompany(true)
    setNotice('')
    const { data, error } = await supabase.functions.invoke('admin_ai_limits', {
      body: {
        action: 'save_organization_limits',
        organization_id: selectedOrganizationId,
        daily_request_limit: Number(companyForm.daily_request_limit),
        daily_message_limit: Number(companyForm.daily_message_limit),
      },
    })
    setSavingCompany(false)

    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível salvar os limites da empresa.')
      setNoticeType('error')
      return
    }

    setNotice('Limites da empresa salvos.')
    setNoticeType('success')
    await loadOrganizations()
    await loadUsers(selectedOrganizationId)
    if (reloadOrganizations) await reloadOrganizations()
  }

  async function saveUserLimit(user) {
    if (!selectedOrganizationId) return
    const rawLimit = userDrafts[user.user_id] ?? ''
    setSavingUserId(user.user_id)
    setNotice('')
    const { data, error } = await supabase.functions.invoke('admin_ai_limits', {
      body: {
        action: 'save_user_limit',
        organization_id: selectedOrganizationId,
        user_id: user.user_id,
        daily_message_limit: rawLimit.trim() === '' ? null : Number(rawLimit),
      },
    })
    setSavingUserId('')

    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível salvar o limite deste usuário.')
      setNoticeType('error')
      return
    }

    setNotice(`Limite de ${user.full_name || user.email || 'usuário'} salvo.`)
    setNoticeType('success')
    await loadUsers(selectedOrganizationId)
  }

  return (
    <section className="admin-ai-limits">
      <header className="admin-section-header">
        <div>
          <span className="eyebrow">GESTÃO DA INTELIGÊNCIA ARTIFICIAL</span>
          <h2>Limites da IA</h2>
          <p className="muted">Defina o limite diário total de cada empresa e o limite de perguntas por usuário.</p>
        </div>
        <div className="topbar-actions">
          <button type="button" className="secondary" onClick={refreshList} disabled={loadingOrganizations}>
            <RefreshCw size={15} /> Atualizar empresas
          </button>
        </div>
      </header>

      {notice && <div className={`notice ${noticeType === 'error' ? 'error' : ''}`} role="status">{notice}</div>}

      <div className={`ai-limits-layout ${selectedOrganization ? 'has-selection' : ''}`}>
        <section className="panel ai-limits-company-panel">
          <div className="panel-heading">
            <h3><Building2 size={17} /> Empresas cadastradas</h3>
            <span className="muted">{organizations.length}</span>
          </div>
          {loadingOrganizations && organizations.length === 0 ? (
            <p className="muted">Carregando empresas...</p>
          ) : organizations.length === 0 ? (
            <p className="muted">Nenhuma empresa cadastrada.</p>
          ) : (
            <div className="ai-limits-company-list">
              {organizations.map(organization => (
                <div
                  key={organization.id}
                  className={`ai-limits-company-card ${selectedOrganizationId === organization.id ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="ai-limits-company-select"
                    onClick={() => selectOrganization(organization)}
                  >
                    <span className="ai-limits-company-icon"><Building2 size={17} /></span>
                    <span className="ai-limits-company-copy">
                      <strong>{organization.name}</strong>
                      <small>{organization.is_sandbox ? 'Ambiente de teste' : organization.is_active ? 'Empresa ativa' : 'Empresa inativa'} · {organization.active_user_count || 0} usuário(s)</small>
                    </span>
                    <span className={`ai-limits-status ${organization.ai_enabled ? 'enabled' : ''}`}>
                      {organization.ai_enabled ? 'IA ativa' : 'IA inativa'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={organization.ai_enabled ? 'secondary mini ai-limits-toggle-button' : 'primary mini ai-limits-toggle-button'}
                    onClick={() => toggleOrganizationAi(organization)}
                    disabled={togglingOrganizationId === organization.id || loadingOrganizations}
                    aria-label={`${organization.ai_enabled ? 'Desativar' : 'Ativar'} IA para ${organization.name}`}
                  >
                    <Power size={13} />
                    {togglingOrganizationId === organization.id ? 'Salvando...' : organization.ai_enabled ? 'Desativar IA' : 'Ativar IA'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="ai-limits-footnote">A lista é atualizada ao abrir a página, ao voltar para ela e quando uma nova empresa é cadastrada.</p>
        </section>

        {selectedOrganization ? (
          <div className="ai-limits-detail">
            <button type="button" className="text-button ai-limits-back" onClick={() => setSelectedOrganizationId('')}>
              <ChevronLeft size={16} /> Todas as empresas
            </button>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3><Bot size={18} /> {selectedOrganization.name}</h3>
                  <p className="muted">{selectedOrganization.ai_enabled ? 'A IA está habilitada no backend.' : 'A IA está desabilitada no backend; os limites podem ser configurados antes da ativação.'}</p>
                </div>
              </div>

              <form onSubmit={saveCompanyLimits}>
                <div className="ai-limits-settings-grid">
                  <label>
                    Limite total da empresa por dia
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      step="1"
                      required
                      value={companyForm.daily_request_limit}
                      onChange={event => setCompanyForm(current => ({ ...current, daily_request_limit: event.target.value }))}
                    />
                    <small>Soma das perguntas de todos os usuários da empresa.</small>
                  </label>
                  <label>
                    Limite padrão por usuário/dia
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      required
                      value={companyForm.daily_message_limit}
                      onChange={event => setCompanyForm(current => ({ ...current, daily_message_limit: event.target.value }))}
                    />
                    <small>Aplicado aos usuários sem limite individual definido.</small>
                  </label>
                </div>
                <div className="ai-limits-form-footer">
                  <span className="muted">O limite total da empresa e o limite individual são verificados no envio de cada pergunta.</span>
                  <button type="submit" className="primary" disabled={savingCompany}>
                    <Save size={15} /> {savingCompany ? 'Salvando...' : 'Salvar limites da empresa'}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel ai-limits-users-panel">
              <div className="panel-heading">
                <h3><Users size={17} /> Usuários da empresa</h3>
                <span className="muted">{users.length}</span>
              </div>
              {loadingUsers ? (
                <p className="muted">Carregando usuários...</p>
              ) : users.length === 0 ? (
                <p className="muted">Esta empresa ainda não possui usuários vinculados.</p>
              ) : (
                <div className="ai-limits-user-list">
                  {users.map(user => (
                    <div className="ai-limits-user-row" key={user.user_id}>
                      <div className="ai-limits-user-identity">
                        <strong>{user.full_name || user.email || 'Usuário sem nome'}</strong>
                        <span>{user.email || 'E-mail não disponível'}</span>
                        <small>{user.role} · {user.is_active && user.account_status === 'active' ? 'Ativo' : 'Inativo'}</small>
                      </div>
                      <div className="ai-limits-user-control">
                        <label>
                          Perguntas por dia
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            step="1"
                            value={userDrafts[user.user_id] ?? ''}
                            placeholder={`Padrão: ${companyForm.daily_message_limit}`}
                            onChange={event => setUserDrafts(current => ({ ...current, [user.user_id]: event.target.value }))}
                            aria-label={`Limite diário de ${user.full_name || user.email || 'usuário'}`}
                          />
                        </label>
                        <small>Em branco = padrão da empresa ({companyForm.daily_message_limit}/dia).</small>
                      </div>
                      <button
                        type="button"
                        className="secondary mini"
                        onClick={() => saveUserLimit(user)}
                        disabled={savingUserId === user.user_id || loadingUsers}
                      >
                        <Save size={13} /> {savingUserId === user.user_id ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <section className="panel ai-limits-empty">
            <Bot size={25} />
            <h3>Selecione uma empresa</h3>
            <p className="muted">Ao selecionar uma empresa, você poderá configurar os limites diários e ajustar cada usuário individualmente.</p>
          </section>
        )}
      </div>
    </section>
  )
}
