import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  LogOut, Building2, Users, Search, MessageSquareText, Settings,
  ChevronRight, Plus, Target, Trash2, ClipboardCopy, Tags, Send,
  Phone, ListChecks, Shield, Database, SlidersHorizontal, History,
  Pause, Play, RefreshCw, XCircle, CheckCircle2, Activity, UserPlus,
  Save, ChevronDown, Menu, X, CalendarDays, Clock, UserRound
} from 'lucide-react'
import { Link2 } from 'lucide-react'
import { supabase } from './lib/supabase'
import CustomerImportPanel from './customer-import'
import CrmFullExport from './crm-full-export'
import { mergeLeadsWithLocalDrafts } from './kanban-draft-merge.js'
import { sortKanbanColumn } from './kanban-order.js'
import AdminTestUsers from './admin-test-users'
import AdminTestLimits from './admin-test-limits'
import { EmailMarketing, AdminEmailMarketing } from './email-marketing'
import DashboardVisual from './dashboard-visual'

const UF_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
]

function renderTemplate(body, lead) {
  return String(body || '')
    .replaceAll('{empresa}', lead?.business_name || '')
    .replaceAll('{cidade}', lead?.city || '')
    .replaceAll('{uf}', lead?.state || '')
    .replaceAll('{telefone}', lead?.phone || '')
    .replaceAll('{segmento}', lead?.segment || '')
}


function normalizeWhatsAppNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('55')) return digits
  return `55${digits}`
}


function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}



function formatDateTime(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('pt-BR')
  } catch {
    return String(value)
  }
}


function currentBrazilDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  const get = type => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function resetOverdueLoginAlerts() {
  // These flags are UI-only; never store tokens or other credentials here.
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index)
    if (key?.startsWith('crm_overdue_login_alert_') || key?.startsWith('crm_overdue_alert_')) {
      sessionStorage.removeItem(key)
    }
  }
}

function formatPhone(value) {
  if (!value) return '—'
  return String(value)
}

function safeExternalUrl(value) {
  if (!value) return null
  try {
    const url = new URL(String(value))
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function ExternalWebsiteLink({ value }) {
  const url = safeExternalUrl(value)
  return url
    ? <a className="lead-site-link" href={url} target="_blank" rel="noopener noreferrer">Abrir site</a>
    : <span />
}

function formatCurrency(value) {
  const number = Number(value || 0)
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function currentLocalDateTimeInput() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function installGlobalDeleteConfirmation() {
  if (typeof document === 'undefined' || window.__crmDeleteConfirmationInstalled) return
  window.__crmDeleteConfirmationInstalled = true

  document.addEventListener('click', event => {
    const origin = event.target
    const button = origin?.closest ? origin.closest('button') : null
    if (!button) return

    // Os botões do próprio modal não podem ser interceptados novamente.
    // Sem esta trava, "Sim, arquivar" abre/intercepta a própria confirmação e o modal fica preso.
    if (button.closest('.delete-confirm-overlay') || button.dataset.deleteAction) return

    if (button.dataset.deleteConfirmed === 'true') {
      delete button.dataset.deleteConfirmed
      return
    }

    const label = [
      button.textContent || '',
      button.getAttribute('aria-label') || '',
      button.getAttribute('title') || ''
    ].join(' ').toLowerCase()

    if (!label.includes('excluir') && !label.includes('arquivar')) return

    event.preventDefault()
    event.stopPropagation()
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()

    document.querySelector('.delete-confirm-overlay')?.remove()

    const scope = button.closest('article, tr, section, .panel')
    const itemName = scope?.querySelector('h2, h3, strong')?.textContent?.trim()
    const customMessage = button.dataset.confirmMessage || ''

    const overlay = document.createElement('div')
    overlay.className = 'delete-confirm-overlay'
    overlay.innerHTML = `
      <div class="delete-confirm-banner" role="dialog" aria-modal="true" aria-label="Confirmar exclusão">
        <h3>Confirmar arquivamento</h3>
        <p data-delete-message></p>
        <div class="delete-confirm-actions">
          <button type="button" class="secondary" data-delete-action="cancel">Cancelar</button>
          <button type="button" class="delete-confirm-danger" data-delete-action="confirm">Sim, arquivar</button>
        </div>
      </div>`

    // Treat names and custom messages as text, never as HTML.
    overlay.querySelector('[data-delete-message]').textContent =
      customMessage || `Tem certeza que deseja excluir${itemName ? ` “${itemName}”` : ' este registro'}? O registro será ocultado das telas normais, mas permanecerá preservado no banco.`

    const close = () => overlay.remove()
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close()
    })
    overlay.querySelector('[data-delete-action="cancel"]')?.addEventListener('click', close)
    overlay.querySelector('[data-delete-action="confirm"]')?.addEventListener('click', () => {
      button.dataset.deleteConfirmed = 'true'
      close()
      button.click()
    })

    document.body.appendChild(overlay)
  }, true)
}

installGlobalDeleteConfirmation()

async function softDeleteRow(table, id, organizationId, extra = {}) {
  const { data, error } = await supabase.functions.invoke('archive_record', {
    body: {
      table,
      id,
      organization_id: organizationId
    }
  })

  if (error) return { error }
  if (data?.error) return { error: new Error(data.error) }
  return { data, error: null }
}

function AdminSectionHeader({ eyebrow = 'ADMINISTRAÇÃO', title, description, actions }) {
  return (
    <header className="admin-section-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </header>
  )
}

function AuthScreen() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', fullName: '' })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim(), {
          redirectTo: window.location.origin
        })
        if (error) throw error
        setMessage('Se o e-mail estiver cadastrado, enviaremos um link para criar uma nova senha.')
      } else if (mode === 'signup') {
        if (form.password.length < 10) {
          throw new Error('A senha precisa ter pelo menos 10 caracteres.')
        }
        const displayName = form.fullName.trim().replace(/\s+/g, ' ')
        if (displayName.length < 2) throw new Error('Informe como deseja ser chamado.')

        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: displayName } }
        })
        if (error) throw error
        setMessage('Cadastro criado. Se a confirmação de e-mail estiver ativa, confirme pelo link recebido.')
      } else {
        // Reset before auth emits SIGNED_IN, so a fresh login can show its notice.
        resetOverdueLoginAlerts()
        const { error } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password
        })
        if (error) throw error
      }
    } catch (err) {
      setMessage(err.message || 'Não foi possível concluir.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">CP</div>
        <h1>CRM Prospecção</h1>
        <p className="muted">Digite seu e-mail e senha para entrar.</p>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Entrar</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setMessage('') }}>Criar conta</button>
        </div>

        {mode === 'forgot' && (
          <div className="notice">Informe seu e-mail. Você receberá um link seguro para criar uma nova senha.</div>
        )}

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              Como deseja ser chamado
              <input
                value={form.fullName}
                onChange={e => setForm({ ...form, fullName: e.target.value })}
                placeholder="Ex.: Claudio"
                minLength={2}
                maxLength={80}
                autoComplete="name"
                required
              />
            </label>
          )}
          <label>
            E-mail
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="voce@empresa.com.br" required />
          </label>
          {mode !== 'forgot' && (
            <label>
              Senha
              <input type="password" minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mínimo de 10 caracteres" required />
            </label>
          )}
          <button className="primary full" disabled={loading}>
            {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : mode === 'forgot' ? 'Enviar link de redefinição' : 'Criar conta'}
          </button>
          {mode === 'login' && (
            <button type="button" className="secondary full" onClick={() => { setMode('forgot'); setMessage('') }}>
              Esqueci minha senha
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" className="secondary full" onClick={() => { setMode('login'); setMessage('') }}>
              Voltar para entrar
            </button>
          )}
        </form>
        {message && <div className="notice">{message}</div>}
      </section>
    </main>
  )
}


function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(e) {
    e.preventDefault()
    setMessage('')
    if (password.length < 10) {
      setMessage('A nova senha deve ter pelo menos 10 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setMessage('As senhas não conferem.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMessage(error.message || 'Não foi possível alterar a senha.')
      setLoading(false)
      return
    }

    await supabase.auth.signOut()
    setLoading(false)
    onDone()
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">CP</div>
        <h1>Criar nova senha</h1>
        <p className="muted">Defina uma nova senha para acessar o CRM.</p>
        <form onSubmit={submit}>
          <label>
            Nova senha
            <input type="password" minLength={10} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 10 caracteres" required />
          </label>
          <label>
            Confirmar nova senha
            <input type="password" minLength={10} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
          </label>
          <button className="primary full" disabled={loading}>{loading ? 'Salvando...' : 'Salvar nova senha'}</button>
        </form>
        {message && <div className="notice">{message}</div>}
      </section>
    </main>
  )
}

function Onboarding({ user, onCreated }) {
  const [form, setForm] = useState({ organizationName: '', city: 'Campinas', state: 'SP', radius: '30' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createOrganization(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: form.organizationName, created_by: user.id })
        .select()
        .single()
      if (orgError) throw orgError

      const { error: memberError } = await supabase
        .from('organization_members')
        .insert({ organization_id: org.id, user_id: user.id, role: 'owner' })
      if (memberError) throw memberError

      const { error: settingsError } = await supabase
        .from('organization_settings')
        .insert({
          organization_id: org.id,
          default_city: form.city,
          default_state: form.state,
          default_radius_km: Number(form.radius),
          default_daily_contact_limit: 20,
          default_cadence_days: [1, 3, 5],
          google_places_monthly_quota: 900
        })
      if (settingsError) throw settingsError
      onCreated(org)
    } catch (err) {
      setError(err.message || 'Erro ao criar organização.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card onboarding-card">
        <div className="brand-mark">CP</div>
        <h1>Configuração inicial</h1>
        <p className="muted">Vamos definir a base da sua primeira operação de prospecção.</p>
        <form onSubmit={createOrganization}>
          <label>
            Nome da empresa ou operação
            <input value={form.organizationName} onChange={e => setForm({ ...form, organizationName: e.target.value })} required />
          </label>
          <div className="field-grid">
            <label>
              Cidade principal
              <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} required />
            </label>
            <label>
              UF
              <select
                value={form.state}
                onChange={e => setForm({ ...form, state: e.target.value })}
                required
              >
                {UF_OPTIONS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </label>
          </div>
          <label>
            Raio inicial de prospecção (km)
            <input type="number" min="1" max="200" value={form.radius} onChange={e => setForm({ ...form, radius: e.target.value })} required />
          </label>
          <div className="settings-preview">
            <div><strong>Cadência:</strong> segunda, quarta e sexta</div>
            <div><strong>Novos contatos:</strong> até 20/dia</div>
            <div><strong>Cota Google Places:</strong> 900/mês</div>
          </div>
          <button className="primary full" disabled={loading}>
            {loading ? 'Criando...' : 'Criar minha operação'}
          </button>
        </form>
        {error && <div className="notice error">{error}</div>}
      </section>
    </main>
  )
}


function WaitingAccessScreen({ email, onLogout }) {
  return (
    <main className="auth-shell">
      <section className="auth-card access-state-card">
        <div className="brand-mark">CP</div>
        <span className="eyebrow">ACESSO</span>
        <h1>Conta aguardando liberação</h1>
        <p className="muted">
          Sua conta foi confirmada, mas ainda não está vinculada a uma empresa no CRM.
        </p>
        <div className="access-email">{email}</div>
        <p className="muted small-copy">
          O administrador do sistema fará o vínculo com a empresa correta.
        </p>
        <div className="access-actions">
          <button className="secondary" onClick={() => window.location.reload()}>
            Verificar acesso
          </button>
          <button className="primary" onClick={onLogout}>Sair</button>
        </div>
      </section>
    </main>
  )
}

function BlockedAccessScreen({ status, email, onLogout }) {
  const suspended = status === 'suspended'
  return (
    <main className="auth-shell">
      <section className="auth-card access-state-card">
        <div className="brand-mark">CP</div>
        <span className="eyebrow">ACESSO</span>
        <h1>{suspended ? 'Conta suspensa' : 'Conta inativa'}</h1>
        <p className="muted">
          {suspended
            ? 'O acesso desta conta foi suspenso pelo administrador do sistema.'
            : 'Esta conta está inativa e não pode acessar o CRM no momento.'}
        </p>
        <div className="access-email">{email}</div>
        <button className="primary full" onClick={onLogout}>Sair</button>
      </section>
    </main>
  )
}

function StatCard({ label, value, detail }) {
  return (
    <article className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-detail">{detail}</div>
    </article>
  )
}

function TeamPerformance({ organization }) {
  const [sellerRows, setSellerRows] = useState([])
  const [originRows, setOriginRows] = useState([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      const [sellerResult, originResult] = await Promise.all([
        supabase.rpc('get_seller_performance', { p_organization_id: organization.id }),
        supabase.rpc('get_origin_conversion', { p_organization_id: organization.id })
      ])

      if (!active) return
      if (sellerResult.error || originResult.error) {
        setMessage(sellerResult.error?.message || originResult.error?.message || 'Não foi possível carregar os indicadores comerciais.')
        return
      }

      setMessage('')
      setSellerRows(sellerResult.data || [])
      setOriginRows(originResult.data || [])
    }

    load()
    const timer = setInterval(load, 30000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [organization.id])

  return (
    <>
      {message && <div className="notice error">{message}</div>}

      <section className="panel commercial-analytics-v69">
        <div className="panel-head">
          <div>
            <span className="eyebrow">EQUIPE</span>
            <h2>Desempenho por vendedor</h2>
          </div>
        </div>

        <div className="analytics-table-v69 seller-table-v69">
          <div className="analytics-row-v69 analytics-head-v69">
            <span>Vendedor</span>
            <span>Em andamento</span>
            <span>Propostas</span>
            <span>Ganhos</span>
            <span>Perdidos</span>
            <span>Conversão</span>
            <span>Vendas</span>
            <span>Ticket médio</span>
          </div>
          {sellerRows.map(row => (
            <div className="analytics-row-v69" key={row.user_id}>
              <span className="analytics-name-v69">
                <strong>{row.seller_name || 'Usuário'}</strong>
                <small>{row.role === 'owner' ? 'Proprietário' : row.role === 'admin' ? 'Administrador' : 'Usuário'}</small>
              </span>
              <span>{Number(row.active_leads || 0)}</span>
              <span>{Number(row.proposals_sent || 0)}</span>
              <span>{Number(row.won_count || 0)}</span>
              <span>{Number(row.lost_count || 0)}</span>
              <span>{Number(row.conversion_rate || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>
              <span><strong>{formatCurrency(row.total_sales || 0)}</strong><small>{Number(row.sales_count || 0)} venda(s)</small></span>
              <span>{formatCurrency(row.average_ticket || 0)}</span>
            </div>
          ))}
          {!sellerRows.length && <p className="muted analytics-empty-v69">Nenhum vendedor ativo encontrado.</p>}
        </div>
      </section>

      <section className="panel commercial-analytics-v69">
        <div className="panel-head">
          <div>
            <span className="eyebrow">ORIGEM E CONVERSÃO</span>
            <h2>Resultado por canal</h2>
            <p className="muted">Mostra quais origens geram leads, clientes e receita.</p>
          </div>
        </div>

        <div className="analytics-table-v69 origin-table-v69">
          <div className="analytics-row-v69 analytics-head-v69">
            <span>Origem</span>
            <span>Leads</span>
            <span>Contatados</span>
            <span>Ganhos</span>
            <span>Conversão</span>
            <span>Vendas</span>
            <span>Valor vendido</span>
          </div>
          {originRows.map(row => (
            <div className="analytics-row-v69" key={row.origin_label}>
              <span><strong>{row.origin_label}</strong></span>
              <span>{Number(row.leads_total || 0)}</span>
              <span>{Number(row.contacted || 0)}</span>
              <span>{Number(row.won_count || 0)}</span>
              <span>{Number(row.conversion_rate || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>
              <span>{Number(row.sales_count || 0)}</span>
              <span><strong>{formatCurrency(row.sales_value || 0)}</strong></span>
            </div>
          ))}
          {!originRows.length && <p className="muted analytics-empty-v69">Nenhum dado de origem disponível.</p>}
        </div>
      </section>
    </>
  )
}

function Dashboard({ organization, userEmail, onGoCampaigns }) {
  const [stats, setStats] = useState({
    ongoing: 0,
    negotiation: 0,
    proposalsSent: 0,
    interested: 0,
    won: 0,
    lost: 0,
    captured: 0,
    registered: 0,
    contacted: 0,
    responded: 0
  })
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true

    async function loadStats() {
      const { data, error } = await supabase
        .rpc('get_dashboard_stats', { p_organization_id: organization.id })

      if (!active) return

      if (error) {
        setMessage(`Não foi possível atualizar o Dashboard: ${error.message}`)
        return
      }

      setMessage('')
      setStats({
        ongoing: Number(data?.ongoing || 0),
        negotiation: Number(data?.negotiation || 0),
        proposalsSent: Number(data?.proposals_sent || 0),
        interested: Number(data?.interested || 0),
        won: Number(data?.won || 0),
        lost: Number(data?.lost || 0),
        captured: Number(data?.captured || 0),
        registered: Number(data?.registered || 0),
        contacted: Number(data?.contacted || 0),
        responded: Number(data?.responded || 0)
      })
    }

    loadStats()
    const timer = setInterval(loadStats, 15000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [organization.id])

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">PAINEL</span>
          <h1>Dashboard</h1>
          <p className="muted">Visão resumida do funil, resultados e atividade comercial.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="panel dashboard-block-v61 dashboard-funnel-v61">
        <div className="dashboard-hero-v61">
          <StatCard
            label="Negócios em andamento"
            value={stats.ongoing}
            detail="Interessado + Proposta + Negociação"
          />
        </div>

        <div className="dashboard-metric-grid-v61 dashboard-metric-grid-three-v61">
          <StatCard label="Total em Negociação" value={stats.negotiation} detail="Oportunidades na etapa Negociação" />
          <StatCard label="Total de propostas enviadas" value={stats.proposalsSent} detail="Leads que já tiveram proposta registrada" />
          <StatCard label="Total Interessados" value={stats.interested} detail="Oportunidades atualmente em Interessado" />
        </div>
      </section>

      <section className="panel dashboard-block-v61">
        <div className="dashboard-block-head-v61">
          <div>
            <span className="eyebrow">RESULTADOS</span>
            <h2>Fechamentos</h2>
            <p className="muted">Resultado das oportunidades que saíram do funil ativo.</p>
          </div>
        </div>
        <div className="dashboard-metric-grid-v61 dashboard-metric-grid-two-v61">
          <StatCard label="Ganhos" value={stats.won} detail="Negócios convertidos em clientes" />
          <StatCard label="Perdidos" value={stats.lost} detail="Negócios encerrados como perdidos" />
        </div>
      </section>

      <section className="panel dashboard-block-v61">
        <div className="dashboard-block-head-v61">
          <div>
            <span className="eyebrow">BASE COMERCIAL</span>
            <h2>Leads e contatos</h2>
          </div>
        </div>
        <div className="dashboard-metric-grid-v61 dashboard-metric-grid-four-v61">
          <StatCard label="Total de leads captados" value={stats.captured} detail="Captados pela busca de empresas" />
          <StatCard label="Total de leads cadastrados" value={stats.registered} detail="Cadastrados manualmente" />
          <StatCard label="Total Leads contatados" value={stats.contacted} detail="Leads que já receberam contato" />
          <StatCard label="Total que respondeu" value={stats.responded} detail="Responderam ou avançaram após a resposta" />
        </div>
      </section>

      <DashboardVisual organization={organization} />

      <TeamPerformance organization={organization} />
    </>
  )
}


function CatalogAdmin({ userEmail }) {
  const [segments, setSegments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogPage, setCatalogPage] = useState(0)
  const CATALOG_PAGE_SIZE = 10
  const [form, setForm] = useState({
    name: '',
    description: '',
    recommended: '',
    additional: ''
  })

  async function loadCatalog() {
    const { data, error } = await supabase
      .from('catalog_segments')
      .select('id,name,slug,description,is_active,sort_order,catalog_segment_terms(id,term,is_recommended,is_active,sort_order)')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) setMessage(`Não foi possível carregar o catálogo: ${error.message}`)
    else setSegments(data || [])
  }

  useEffect(() => { loadCatalog() }, [])

  function startNew() {
    setEditing(null)
    setForm({ name: '', description: '', recommended: '', additional: '' })
    setMessage('')
    setShowForm(true)
  }

  function startEdit(segment) {
    const terms = (segment.catalog_segment_terms || [])
      .filter(t => t.is_active)
      .sort((a,b) => a.sort_order - b.sort_order)

    setEditing(segment)
    setForm({
      name: segment.name,
      description: segment.description || '',
      recommended: terms.filter(t => t.is_recommended).map(t => t.term).join('\n'),
      additional: terms.filter(t => !t.is_recommended).map(t => t.term).join('\n')
    })
    setMessage('')
    setShowForm(true)
  }

  function parseLines(value) {
    return String(value || '')
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)
      .filter((x, i, arr) => arr.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i)
  }

  async function saveCatalogSegment(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const recommended = parseLines(form.recommended)
    const additional = parseLines(form.additional)
      .filter(x => !recommended.some(r => r.toLowerCase() === x.toLowerCase()))

    if (!recommended.length && !additional.length) {
      setMessage('Inclua pelo menos um termo de busca.')
      setLoading(false)
      return
    }

    let segmentId = editing?.id

    if (editing) {
      const { error } = await supabase
        .from('catalog_segments')
        .update({
          name: form.name.trim(),
          description: form.description.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', editing.id)

      if (error) {
        setMessage(error.message)
        setLoading(false)
        return
      }

      await supabase
        .from('catalog_segment_terms')
        .update({ is_active: false })
        .eq('catalog_segment_id', editing.id)
    } else {
      const { data, error } = await supabase
        .from('catalog_segments')
        .insert({
          name: form.name.trim(),
          slug: slugify(form.name),
          description: form.description.trim() || null,
          is_active: true,
          sort_order: 100
        })
        .select('id')
        .single()

      if (error) {
        setMessage(error.message)
        setLoading(false)
        return
      }

      segmentId = data.id
    }

    const { data: existingTerms } = await supabase
      .from('catalog_segment_terms')
      .select('id,term')
      .eq('catalog_segment_id', segmentId)

    const finalTerms = [
      ...recommended.map((term, i) => ({ term, is_recommended: true, sort_order: (i + 1) * 10 })),
      ...additional.map((term, i) => ({ term, is_recommended: false, sort_order: 500 + (i + 1) * 10 }))
    ]

    for (const item of finalTerms) {
      const existing = (existingTerms || []).find(
        x => x.term.toLowerCase() === item.term.toLowerCase()
      )

      if (existing) {
        await supabase
          .from('catalog_segment_terms')
          .update({
            is_active: true,
            is_recommended: item.is_recommended,
            sort_order: item.sort_order
          })
          .eq('id', existing.id)
      } else {
        await supabase
          .from('catalog_segment_terms')
          .insert({
            catalog_segment_id: segmentId,
            term: item.term,
            is_recommended: item.is_recommended,
            is_active: true,
            sort_order: item.sort_order
          })
      }
    }

    setMessage(editing ? 'Segmento do catálogo atualizado.' : 'Segmento adicionado ao catálogo.')
    setShowForm(false)
    setEditing(null)
    setForm({ name: '', description: '', recommended: '', additional: '' })
    await loadCatalog()
    setLoading(false)
  }

  async function toggleCatalogSegment(segment) {
    const { error } = await supabase
      .from('catalog_segments')
      .update({
        is_active: !segment.is_active,
        updated_at: new Date().toISOString()
      })
      .eq('id', segment.id)

    if (error) setMessage(error.message)
    else await loadCatalog()
  }

  const filteredCatalogSegments = segments.filter(segment => {
    const q = catalogSearch.trim().toLowerCase()
    return !q || (segment.name || '').toLowerCase().includes(q)
  })

  const catalogTotalPages = Math.max(1, Math.ceil(filteredCatalogSegments.length / CATALOG_PAGE_SIZE))
  const safeCatalogPage = Math.min(catalogPage, catalogTotalPages - 1)
  const pagedCatalogSegments = filteredCatalogSegments.slice(
    safeCatalogPage * CATALOG_PAGE_SIZE,
    safeCatalogPage * CATALOG_PAGE_SIZE + CATALOG_PAGE_SIZE
  )

  useEffect(() => {
    setCatalogPage(0)
  }, [catalogSearch])

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>Catálogo CRM</h1>
          <p className="muted">Gerencie os segmentos e termos sugeridos para todos os clientes.</p>
        </div>
        <div className="topbar-actions">
          <div className="user-badge">{userEmail}</div>
          <button className="primary inline-btn" onClick={startNew}>
            <Plus size={17}/> Novo segmento
          </button>
        </div>
      </header>

      {showForm && (
        <section className="panel campaign-form-panel">
          <span className="eyebrow">{editing ? 'EDITAR CATÁLOGO' : 'NOVO SEGMENTO'}</span>
          <h2>{editing ? 'Atualizar segmento' : 'Adicionar segmento ao catálogo'}</h2>

          <form onSubmit={saveCatalogSegment} className="campaign-form">
            <label>
              Nome do segmento
              <input
                value={form.name}
                onChange={e => setForm({...form, name: e.target.value})}
                placeholder="Ex.: Academias"
                required
              />
            </label>

            <label>
              Descrição
              <input
                value={form.description}
                onChange={e => setForm({...form, description: e.target.value})}
                placeholder="Descrição curta do tipo de empresa"
              />
            </label>

            <div className="field-grid">
              <label>
                Termos recomendados
                <textarea
                  className="message-textarea"
                  rows="6"
                  value={form.recommended}
                  onChange={e => setForm({...form, recommended: e.target.value})}
                  placeholder={'Um termo por linha.\nEsses termos aparecerão destacados para o cliente.'}
                />
              </label>

              <label>
                Outros termos sugeridos
                <textarea
                  className="message-textarea"
                  rows="6"
                  value={form.additional}
                  onChange={e => setForm({...form, additional: e.target.value})}
                  placeholder={'Um termo por linha.\nO cliente poderá selecionar se quiser.'}
                />
              </label>
            </div>

            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button className="primary" disabled={loading}>
                {loading ? 'Salvando...' : 'Salvar no catálogo'}
              </button>
            </div>
          </form>
        </section>
      )}

      {message && <div className="notice">{message}</div>}

      <section className="panel admin-search-panel compact-search-panel">
        <div className="search-box">
          <Search size={17}/>
          <input
            value={catalogSearch}
            onChange={e => setCatalogSearch(e.target.value)}
            placeholder="Buscar segmento por nome"
          />
        </div>
        <span className="admin-result-count">{filteredCatalogSegments.length} de {segments.length} segmentos</span>
      </section>

      <section className="compact-admin-list catalog-compact-list">
        {filteredCatalogSegments.length === 0 ? (
          <article className="panel empty-state compact-empty"><Search size={26}/><h2>Nenhum segmento encontrado</h2></article>
        ) : pagedCatalogSegments.map(segment => {
          const terms = (segment.catalog_segment_terms || [])
            .filter(t => t.is_active)
            .sort((a,b) => a.sort_order - b.sort_order)
          const recommended = terms.filter(t => t.is_recommended)
          const additional = terms.filter(t => !t.is_recommended)

          return (
            <article className="panel compact-admin-row catalog-compact-row" key={segment.id}>
              <div className="compact-admin-main">
                <div className="compact-admin-title-line">
                  <span className={`compact-status ${segment.is_active ? 'active' : 'inactive'}`}>{segment.is_active ? 'Ativo' : 'Inativo'}</span>
                  <strong>{segment.name}</strong>
                </div>
                <p>{segment.description || 'Sem descrição'}</p>
                <div className="compact-term-line">
                  <span><b>{recommended.length}</b> recomendados</span>
                  <span><b>{additional.length}</b> outros termos</span>
                  {terms.slice(0, 4).map(t => <em key={t.id}>{t.term}</em>)}
                  {terms.length > 4 && <em>+{terms.length - 4}</em>}
                </div>
              </div>
              <div className="row-actions compact-row-actions">
                <button className="secondary mini" onClick={() => startEdit(segment)}>Editar</button>
                <button className="secondary mini" onClick={() => toggleCatalogSegment(segment)}>
                  {segment.is_active ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            </article>
          )
        })}
      </section>

      {filteredCatalogSegments.length > 0 && (
        <div className="admin-pagination-v64">
          <span>
            Página <strong>{safeCatalogPage + 1}</strong> de <strong>{catalogTotalPages}</strong>
            {' • '}{filteredCatalogSegments.length} segmento{filteredCatalogSegments.length === 1 ? '' : 's'}
          </span>
          <div>
            <button
              type="button"
              className="secondary mini"
              onClick={() => setCatalogPage(Math.max(0, safeCatalogPage - 1))}
              disabled={safeCatalogPage <= 0}
            >
              Anterior
            </button>
            <button
              type="button"
              className="secondary mini"
              onClick={() => setCatalogPage(Math.min(catalogTotalPages - 1, safeCatalogPage + 1))}
              disabled={safeCatalogPage >= catalogTotalPages - 1}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </>
  )
}


function TargetSegments({ organization, userEmail }) {
  const [segments, setSegments] = useState([])
  const [catalog, setCatalog] = useState([])
  const [catalogTerms, setCatalogTerms] = useState([])
  const [selectedTerms, setSelectedTerms] = useState(new Set())
  const [customTerms, setCustomTerms] = useState([])
  const [customInput, setCustomInput] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    catalog_segment_id: ''
  })

  async function loadData() {
    const [{ data: targetData, error: targetError }, { data: catalogData, error: catalogError }] =
      await Promise.all([
        supabase
          .from('target_segments')
          .select('id,name,description,is_active,catalog_segment_id,created_at,target_segment_search_terms(id,term,priority,is_active)')
          .eq('organization_id', organization.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
        supabase
          .from('catalog_segments')
          .select('id,name,description,is_active,sort_order,catalog_segment_terms(id,term,is_recommended,is_active,sort_order)')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true })
      ])

    if (targetError) setMessage(`Não foi possível carregar os públicos-alvo: ${targetError.message}`)
    else setSegments(targetData || [])

    if (catalogError) setMessage(`Não foi possível carregar o catálogo: ${catalogError.message}`)
    else setCatalog(catalogData || [])
  }

  useEffect(() => { loadData() }, [organization.id])

  function applyCatalogSegmentByName(value) {
    const selected = catalog.find(c => c.name.toLowerCase() === value.trim().toLowerCase())

    if (!selected) {
      setCatalogTerms([])
      setSelectedTerms(new Set())
      setForm(old => ({
        ...old,
        catalog_segment_id: '',
        name: value
      }))
      return
    }

    const terms = (selected.catalog_segment_terms || [])
      .filter(t => t.is_active)
      .sort((a,b) => a.sort_order - b.sort_order)

    setCatalogTerms(terms)
    setSelectedTerms(new Set(
      terms.filter(t => t.is_recommended).map(t => t.term)
    ))
    setCustomTerms([])
    setForm(old => ({
      ...old,
      catalog_segment_id: selected.id,
      name: selected.name,
      description: selected.description || old.description || ''
    }))
  }

  function startNew() {
    setEditing(null)
    setForm({ name: '', description: '', catalog_segment_id: '' })
    setCatalogTerms([])
    setSelectedTerms(new Set())
    setCustomTerms([])
    setCustomInput('')
    setShowForm(true)
    setMessage('')
  }

  function startEdit(segment) {
    const activeTerms = (segment.target_segment_search_terms || [])
      .filter(t => t.is_active)
      .sort((a,b) => a.priority - b.priority)
      .map(t => t.term)

    const catalogSegment = catalog.find(c => c.id === segment.catalog_segment_id)
    const availableCatalogTerms = (catalogSegment?.catalog_segment_terms || [])
      .filter(t => t.is_active)
      .sort((a,b) => a.sort_order - b.sort_order)

    const availableLower = new Set(availableCatalogTerms.map(t => t.term.toLowerCase()))
    const selectedCatalogTerms = activeTerms.filter(t => availableLower.has(t.toLowerCase()))
    const custom = activeTerms.filter(t => !availableLower.has(t.toLowerCase()))

    setEditing(segment)
    setCatalogTerms(availableCatalogTerms)
    setSelectedTerms(new Set(selectedCatalogTerms))
    setCustomTerms(custom)
    setCustomInput('')
    setForm({
      name: segment.name,
      description: segment.description || '',
      catalog_segment_id: segment.catalog_segment_id || ''
    })
    setShowForm(true)
    setMessage('')
  }

  function toggleSuggestedTerm(term) {
    setSelectedTerms(old => {
      const next = new Set(old)
      if (next.has(term)) next.delete(term)
      else next.add(term)
      return next
    })
  }

  function addCustomTerm() {
    const term = customInput.trim()
    if (!term) return

    const exists =
      [...selectedTerms].some(x => x.toLowerCase() === term.toLowerCase()) ||
      customTerms.some(x => x.toLowerCase() === term.toLowerCase())

    if (!exists) setCustomTerms(old => [...old, term])
    setCustomInput('')
  }

  function removeCustomTerm(term) {
    setCustomTerms(old => old.filter(x => x !== term))
  }

  async function saveSegment(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const terms = [
      ...Array.from(selectedTerms),
      ...customTerms
    ]
      .map(x => x.trim())
      .filter(Boolean)
      .filter((x, i, arr) => arr.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i)

    if (!terms.length) {
      setMessage('Selecione ou adicione pelo menos um termo de busca.')
      setLoading(false)
      return
    }

    let segmentId = editing?.id

    if (editing) {
      const { error } = await supabase
        .from('target_segments')
        .update({
          name: form.name.trim(),
          description: form.description.trim() || null,
          catalog_segment_id: form.catalog_segment_id || null
        })
        .eq('id', editing.id)
        .eq('organization_id', organization.id)

      if (error) {
        setMessage(error.message)
        setLoading(false)
        return
      }

      await supabase
        .from('target_segment_search_terms')
        .update({ is_active: false })
        .eq('target_segment_id', editing.id)
    } else {
      const { data, error } = await supabase
        .from('target_segments')
        .insert({
          organization_id: organization.id,
          name: form.name.trim(),
          description: form.description.trim() || null,
          catalog_segment_id: form.catalog_segment_id || null,
          is_active: true
        })
        .select('id')
        .single()

      if (error) {
        setMessage(error.message)
        setLoading(false)
        return
      }

      segmentId = data.id
    }

    const { data: existing } = await supabase
      .from('target_segment_search_terms')
      .select('id,term')
      .eq('target_segment_id', segmentId)

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i]
      const found = (existing || []).find(x => x.term.toLowerCase() === term.toLowerCase())

      if (found) {
        await supabase
          .from('target_segment_search_terms')
          .update({ is_active: true, priority: i + 1 })
          .eq('id', found.id)
      } else {
        await supabase
          .from('target_segment_search_terms')
          .insert({
            target_segment_id: segmentId,
            term,
            priority: i + 1,
            is_active: true
          })
      }
    }

    setMessage(editing ? 'Público-alvo atualizado.' : 'Público-alvo criado.')
    setShowForm(false)
    setEditing(null)
    setForm({ name: '', description: '', catalog_segment_id: '' })
    setCatalogTerms([])
    setSelectedTerms(new Set())
    setCustomTerms([])
    await loadData()
    setLoading(false)
  }

  async function toggleSegment(segment) {
    const { error } = await supabase
      .from('target_segments')
      .update({ is_active: !segment.is_active })
      .eq('id', segment.id)
      .eq('organization_id', organization.id)

    if (error) setMessage(error.message)
    else await loadData()
  }

  async function deleteTargetSegment(segment) {
    setMessage('')
    const { error } = await softDeleteRow('target_segments', segment.id, organization.id, { is_active: false })
    if (error) {
      setMessage(`Não foi possível arquivar o público-alvo: ${error.message}`)
      return
    }
    setMessage('Público-alvo arquivado. O histórico foi preservado.')
    await loadData()
  }


  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">PROSPECÇÃO</span>
          <h1>Públicos-alvo</h1>
          <p className="muted">Escolha um segmento sugerido ou crie um público totalmente personalizado.</p>
        </div>

        <div className="topbar-actions">
          <div className="user-badge">{userEmail}</div>
          <button className="primary inline-btn" onClick={startNew}>
            <Plus size={17}/> Novo público
          </button>
        </div>
      </header>

      {showForm && (
        <section className="panel campaign-form-panel">
          <span className="eyebrow">{editing ? 'EDITAR PÚBLICO' : 'NOVO PÚBLICO'}</span>
          <h2>{editing ? 'Atualizar público-alvo' : 'Criar público-alvo'}</h2>

          <form onSubmit={saveSegment} className="campaign-form">
            <label>
              Segmento / público-alvo
              <input
                list="catalog-segment-options"
                value={form.name}
                onChange={e => applyCatalogSegmentByName(e.target.value)}
                placeholder="Digite ou escolha uma sugestão. Ex.: Clínicas médicas"
                autoComplete="off"
                required
              />
              <datalist id="catalog-segment-options">
                {catalog.map(item => (
                  <option key={item.id} value={item.name} />
                ))}
              </datalist>
            </label>

            <div className="catalog-match-hint">
              {form.catalog_segment_id
                ? 'Segmento encontrado no catálogo. Os termos sugeridos foram carregados abaixo.'
                : form.name
                  ? 'Segmento personalizado. Você pode continuar digitando e adicionar seus próprios termos.'
                  : 'Comece a digitar para ver sugestões do catálogo.'}
            </div>

            <label>
              Descrição
              <input
                value={form.description}
                onChange={e => setForm({...form, description: e.target.value})}
                placeholder="Opcional: descreva o perfil de empresa"
              />
            </label>

            {catalogTerms.length > 0 && (
              <div className="suggested-terms-box">
                <div className="suggested-title">
                  <strong>Termos sugeridos</strong>
                  <span>Clique para selecionar ou remover.</span>
                </div>

                <div className="suggested-term-grid">
                  {catalogTerms.map(term => {
                    const active = selectedTerms.has(term.term)
                    return (
                      <button
                        type="button"
                        key={term.id}
                        className={`suggested-term ${active ? 'selected' : ''} ${term.is_recommended ? 'recommended' : ''}`}
                        onClick={() => toggleSuggestedTerm(term.term)}
                      >
                        <span>{active ? '✓' : '+'}</span>
                        {term.term}
                        {term.is_recommended && <small>Recomendado</small>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="custom-term-box">
              <label>
                Adicionar outro termo
                <div className="custom-term-input">
                  <input
                    value={customInput}
                    onChange={e => setCustomInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCustomTerm()
                      }
                    }}
                    placeholder="Digite um termo que não está nas sugestões"
                  />
                  <button type="button" className="secondary" onClick={addCustomTerm}>
                    Adicionar
                  </button>
                </div>
              </label>

              {customTerms.length > 0 && (
                <div className="custom-term-list">
                  {customTerms.map(term => (
                    <span key={term}>
                      {term}
                      <button type="button" onClick={() => removeCustomTerm(term)}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {!form.catalog_segment_id && (
              <div className="notice">
                Esse público será personalizado. Você pode definir qualquer nome e adicionar os termos manualmente.
              </div>
            )}

            <div className="notice">
              A cada captação o sistema usa um dos termos selecionados e alterna automaticamente entre eles.
            </div>

            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button className="primary" disabled={loading}>
                {loading ? 'Salvando...' : 'Salvar público'}
              </button>
            </div>
          </form>
        </section>
      )}

      {message && <div className="notice">{message}</div>}

      <section className="campaign-list">
        {segments.length === 0 ? (
          <article className="panel empty-state">
            <Tags size={34}/>
            <h2>Nenhum público-alvo criado</h2>
            <p>Escolha um segmento do catálogo ou crie um público personalizado.</p>
          </article>
        ) : segments.map(segment => {
          const terms = (segment.target_segment_search_terms || [])
            .filter(t => t.is_active)
            .sort((a,b) => a.priority - b.priority)

          return (
            <article className="panel campaign-card" key={segment.id}>
              <div>
                <span className={`eyebrow ${segment.is_active ? '' : 'status-inactive-v51'}`}>{segment.is_active ? 'ATIVO' : 'INATIVO'}</span>
                <h2>{segment.name}</h2>
                <p>{segment.description || 'Sem descrição'}</p>
                <div className="tag-row">
                  {terms.slice(0,6).map(t => <span key={t.id}>{t.term}</span>)}
                </div>
              </div>

              <div className="message-card-actions">
                <button className="secondary" onClick={() => startEdit(segment)}>Editar</button>
                <button className="secondary" onClick={() => toggleSegment(segment)}>
                  {segment.is_active ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  className="text-danger"
                  data-confirm-message={`Tem certeza que deseja excluir o público-alvo “${segment.name}”? As campanhas existentes serão mantidas, mas ficarão sem público até serem editadas.`}
                  onClick={() => deleteTargetSegment(segment)}
                >
                  <Trash2 size={14}/> Arquivar
                </button>
              </div>
            </article>
          )
        })}
      </section>
    </>
  )
}



function Campaigns({ organization, settings, userEmail }) {
  const [campaigns, setCampaigns] = useState([])
  const [segments, setSegments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const emptyForm = () => ({
    name: '',
    target_segment_id: '',
    city: settings?.default_city || 'Campinas',
    state: settings?.default_state || 'SP',
    radius_km: settings?.default_radius_km || 30,
    daily_contact_limit: settings?.default_daily_contact_limit || 20
  })
  const [form, setForm] = useState(emptyForm)

  async function loadData() {
    const [{data: campaignData}, {data: segmentData}] = await Promise.all([
      supabase
        .from('campaigns')
        .select('*, target_segments(name)')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .order('created_at', {ascending:false}),
      supabase
        .from('target_segments')
        .select('id,name,is_active')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name')
    ])
    setCampaigns(campaignData || [])
    setSegments(segmentData || [])
    if (!form.target_segment_id && segmentData?.length) {
      setForm(old => ({...old, target_segment_id: segmentData[0].id}))
    }
  }

  useEffect(() => { loadData() }, [organization.id])

  function startNew() {
    setEditingId(null)
    const next = emptyForm()
    if (segments.length) next.target_segment_id = segments[0].id
    setForm(next)
    setMessage('')
    setShowForm(true)
  }

  function startEdit(c) {
    setEditingId(c.id)
    setForm({
      name: c.name || '',
      target_segment_id: c.target_segment_id || '',
      city: c.city || settings?.default_city || 'Campinas',
      state: c.state || settings?.default_state || 'SP',
      radius_km: c.radius_km || settings?.default_radius_km || 30,
      daily_contact_limit: c.daily_contact_limit || settings?.default_daily_contact_limit || 20
    })
    setMessage('')
    setShowForm(true)
  }

  async function saveCampaign(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const selected = segments.find(s => s.id === form.target_segment_id)
    const payload = {
      name: form.name.trim(),
      target_segment_id: form.target_segment_id,
      segment: selected?.name || 'Público personalizado',
      city: form.city.trim(),
      state: form.state,
      radius_km: Number(form.radius_km),
      daily_contact_limit: Number(form.daily_contact_limit)
    }

    let error
    if (editingId) {
      ;({ error } = await supabase.from('campaigns').update(payload).eq('id', editingId).eq('organization_id', organization.id))
    } else {
      ;({ error } = await supabase.from('campaigns').insert({
        ...payload,
        organization_id: organization.id,
        cadence_days: [1,3,5],
        status: 'draft',
        search_term_cursor: 0
      }))
    }

    if (error) setMessage(error.message)
    else {
      setMessage(editingId ? 'Campanha atualizada.' : 'Campanha criada com sucesso.')
      setEditingId(null)
      setShowForm(false)
      setForm(emptyForm())
      await loadData()
    }
    setLoading(false)
  }

  async function deleteCampaign(c) {
    const { error } = await softDeleteRow('campaigns', c.id, organization.id, { status: 'paused' })
    if (error) setMessage(error.message)
    else {
      setMessage('Campanha arquivada.')
      await loadData()
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">PROSPECÇÃO</span>
          <h1>Campanhas</h1>
          <p className="muted">Associe um público-alvo a uma região de prospecção.</p>
        </div>
        <div className="topbar-actions">
          <div className="user-badge">{userEmail}</div>
          <button className="primary inline-btn" onClick={startNew} disabled={!segments.length}>
            <Plus size={17}/> Nova campanha
          </button>
        </div>
      </header>

      {!segments.length && <div className="notice">Crie pelo menos um público-alvo antes de criar uma campanha.</div>}

      {showForm && (
        <section className="panel campaign-form-panel">
          <span className="eyebrow">{editingId ? 'EDITAR CAMPANHA' : 'NOVA CAMPANHA'}</span>
          <h2>{editingId ? 'Editar campanha' : 'Configurar prospecção'}</h2>
          <form onSubmit={saveCampaign} className="campaign-form">
            <label>Nome da campanha
              <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex.: Clínicas Campinas" required />
            </label>
            <label>Público-alvo
              <select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})} required>
                {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="field-grid three">
              <label>Cidade<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} required /></label>
              <label>UF
                <select value={form.state} onChange={e=>setForm({...form,state:e.target.value})} required>
                  {UF_OPTIONS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </label>
              <label>Raio (km)<input type="number" min="1" max="50" value={form.radius_km} onChange={e=>setForm({...form,radius_km:e.target.value})} required /></label>
            </div>
            <label>Limite de contatos/dia
              <input type="number" min="1" max="100" value={form.daily_contact_limit} onChange={e=>setForm({...form,daily_contact_limit:e.target.value})} required />
            </label>
            <div className="settings-preview">
              <div><strong>Filtro:</strong> público + raio + empresa operacional + duplicidade</div>
              <div><strong>Cadência:</strong> segunda, quarta e sexta</div>
              <div><strong>Busca:</strong> termos do público alternados automaticamente</div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={()=>{setShowForm(false);setEditingId(null)}}>Cancelar</button>
              <button className="primary" disabled={loading}>{loading?'Salvando...':editingId?'Salvar alterações':'Salvar campanha'}</button>
            </div>
          </form>
        </section>
      )}

      {message && <div className="notice">{message}</div>}

      <section className="campaign-list">
        {campaigns.length===0 ? (
          <article className="panel empty-state"><Target size={34}/><h2>Nenhuma campanha criada</h2><p>Crie a primeira campanha para iniciar a prospecção.</p></article>
        ) : campaigns.map(c => (
          <article className="panel campaign-card" key={c.id}>
            <div>
              <span className="eyebrow">{c.target_segments?.name || c.segment}</span>
              {(c.status === 'paused' || c.deleted_at) && <span className="status-inactive-v51 campaign-inactive-v51">INATIVA</span>}
              <h2>{c.name}</h2>
              <p>{c.city} / {c.state} • raio de {c.radius_km} km</p>
            </div>
            <div className="campaign-meta campaign-actions-v32">
              <span>{c.daily_contact_limit}/dia</span>
              <button className="secondary" onClick={() => startEdit(c)}>Editar</button>
              <button className="text-danger" onClick={() => deleteCampaign(c)}><Trash2 size={14}/> Arquivar</button>
            </div>
          </article>
        ))}
      </section>
    </>
  )
}


function Capture({ organization, settings, userEmail }) {
  const [campaigns, setCampaigns] = useState([])
  const [campaignId, setCampaignId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadCampaigns() {
      const { data, error } = await supabase
        .from('campaigns')
        .select('id,name,city,state,radius_km,status,target_segment_id,target_segments(name)')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (!error) {
        setCampaigns(data || [])
        if (data?.length && !campaignId) setCampaignId(data[0].id)
      }
    }
    loadCampaigns()
  }, [organization.id])

  const selectedCampaign = campaigns.find(c => c.id === campaignId)

  async function runCapture() {
    if (!campaignId) return
    setLoading(true)
    setError('')
    setResult(null)

    const { data, error } = await supabase.functions.invoke('capture_places_leads', {
      body: { campaign_id: campaignId }
    })

    if (error) setError(error.message || 'Não foi possível executar a captação.')
    else if (data?.error) setError(data.error)
    else setResult(data)
    setLoading(false)
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">CAPTAÇÃO AUTOMÁTICA</span>
          <h1>Captação</h1>
          <p className="muted">Encontre empresas do público escolhido dentro do raio da campanha.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <section className="panel capture-panel">
        <span className="eyebrow">BUSCA POR CAMPANHA</span>
        <h2>Escolha a operação</h2>

        <div className="capture-controls">
          <label>
            Campanha
            <select value={campaignId} onChange={e => setCampaignId(e.target.value)}>
              {!campaigns.length && <option value="">Nenhuma campanha criada</option>}
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <button className="primary capture-button" onClick={runCapture} disabled={loading || !campaignId}>
            <Search size={17}/>
            {loading ? 'Buscando empresas...' : 'Captar automaticamente'}
          </button>
        </div>

        {selectedCampaign && (
          <div className="capture-summary">
            <div><span>Público-alvo</span><strong>{selectedCampaign.target_segments?.name || '—'}</strong></div>
            <div><span>Região</span><strong>{selectedCampaign.city} / {selectedCampaign.state}</strong></div>
            <div><span>Raio</span><strong>{selectedCampaign.radius_km} km</strong></div>
          </div>
        )}

        <div className="notice capture-note">
          A entrada do lead usa critérios objetivos: público-alvo, raio, estabelecimento operacional e ausência de duplicidade.
        </div>

        {error && <div className="notice error">{error}</div>}

        {result && (
          <div className="capture-result">
            <div className="capture-result-grid five">
              <div><strong>{result.found ?? 0}</strong><span>Encontrados</span></div>
              <div><strong>{result.inserted ?? 0}</strong><span>Novos leads</span></div>
              <div><strong>{result.duplicates ?? 0}</strong><span>Duplicados</span></div>
              <div><strong>{result.outside_radius ?? 0}</strong><span>Fora do raio</span></div>
              <div><strong>{result.non_operational ?? 0}</strong><span>Não operacionais</span></div>
            </div>

            <div className="quota-progress">
              <div>
                <span>Uso mensal — captação</span>
                <strong>{result.usage ?? 0} / {result.quota ?? 900}</strong>
              </div>
              <div className="quota-bar">
                <div className="quota-fill" style={{ width: `${Math.min(((result.usage || 0) / (result.quota || 900)) * 100, 100)}%` }} />
              </div>
              <small>Restantes: {result.remaining ?? '—'}</small>
            </div>

            <div className="quota-progress compact">
              <div><span>Localização de cidades</span><strong>{result.pro_usage ?? 0} / {result.pro_quota ?? 4500}</strong></div>
            </div>

            <p className="muted result-query">
              Público: {result.target_segment || '—'} • termo usado: <strong>{result.query}</strong>
              {result.search_terms_total > 1 ? ` • termo ${result.search_term_index} de ${result.search_terms_total}` : ''}
              {' • '}raio: {result.radius_km ?? '—'} km
            </p>
          </div>
        )}
      </section>
    </>
  )
}


function LeadExportPanel({ leads, onClose, onMessage }) {
  const today = currentBrazilDate()
  const [mode, setMode] = useState('month')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`)
  const [endDate, setEndDate] = useState(today)

  const statusNames = {
    new: 'Novo',
    queued: 'Na fila',
    contacted: 'Contatado',
    replied: 'Respondeu',
    interested: 'Interessado',
    proposal: 'Proposta',
    not_interested: 'Sem interesse',
    won: 'Ganho',
    lost: 'Perdido',
    discarded: 'Descartado'
  }

  function dateKey(value) {
    if (!value) return ''
    try {
      const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date(value))
      const get = type => parts.find(part => part.type === type)?.value || ''
      return `${get('year')}-${get('month')}-${get('day')}`
    } catch {
      return String(value).slice(0, 10)
    }
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`
  }

  function exportToExcel() {
    if (mode === 'month' && !month) {
      onMessage('Selecione o mês para exportação.')
      return
    }
    if (mode === 'range' && (!startDate || !endDate || startDate > endDate)) {
      onMessage('Informe um período válido para exportação.')
      return
    }

    const rows = leads.filter(lead => {
      if (mode === 'all') return true
      const date = dateKey(lead.created_at)
      if (!date) return false
      if (mode === 'month') return date.startsWith(month)
      return date >= startDate && date <= endDate
    })

    if (!rows.length) {
      onMessage('Não existem leads no período selecionado.')
      return
    }

    const headers = [
      'Empresa', 'Público-alvo', 'Campanha', 'Telefone', 'E-mail',
      'Cidade', 'UF', 'Contato', 'Status', 'Valor da proposta',
      'Proposta enviada', 'Último contato', 'Próximo contato',
      'Observações', 'Data de cadastro'
    ]

    const data = rows.map(lead => [
      lead.business_name || '',
      lead.target_segments?.name || lead.segment || '',
      lead.campaigns?.name || '',
      lead.phone || '',
      lead.email || '',
      lead.city || '',
      lead.state || '',
      lead.contact_name || '',
      statusNames[lead.status] || lead.status || '',
      lead.proposal_value === null || lead.proposal_value === undefined || lead.proposal_value === ''
        ? ''
        : formatCurrency(lead.proposal_value),
      lead.proposal_sent_at || '',
      lead.last_contact_date || '',
      lead.next_contact_date || '',
      lead.commercial_notes || '',
      lead.created_at ? new Date(lead.created_at).toLocaleString('pt-BR') : ''
    ])

    const csv = '\uFEFF' + [headers, ...data]
      .map(row => row.map(csvCell).join(';'))
      .join('\r\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const periodName = mode === 'all'
      ? 'todo-periodo'
      : mode === 'month'
        ? month
        : `${startDate}_a_${endDate}`

    link.href = url
    link.download = `crm-leads-${periodName}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    onMessage(`${rows.length} lead(s) exportado(s). O arquivo abre diretamente no Excel.`)
  }

  return (
    <section className="panel export-panel-v41">
      <div className="export-panel-head-v41">
        <div>
          <span className="eyebrow">EXPORTAÇÃO</span>
          <h2>Exportar leads para Excel</h2>
          <p className="muted">Escolha um mês, um intervalo de datas ou todo o período.</p>
        </div>
        <button type="button" className="secondary" onClick={onClose}>Fechar</button>
      </div>

      <div className="export-fields-v41">
        <label>
          Período
          <select value={mode} onChange={e => setMode(e.target.value)}>
            <option value="month">Por mês</option>
            <option value="range">Período personalizado</option>
            <option value="all">Todo o período</option>
          </select>
        </label>

        {mode === 'month' && (
          <label>
            Mês
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </label>
        )}

        {mode === 'range' && (
          <>
            <label>
              Data inicial
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            <label>
              Data final
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </label>
          </>
        )}

        <button type="button" className="primary inline-btn export-button-v41" onClick={exportToExcel}>
          <Save size={17}/> Exportar Excel
        </button>
      </div>
    </section>
  )
}


function Leads({ organization, settings, userEmail }) {
  const kanbanScrollRef = useRef(null)
  const kanbanFixedScrollRef = useRef(null)
  const [journeyEntries, setJourneyEntries] = useState([])
  const [expandedLeadIds, setExpandedLeadIds] = useState(() => new Set())
  const [noteDrafts, setNoteDrafts] = useState({})
  const [savingLeadIds, setSavingLeadIds] = useState(new Set())
  const dirtyLeadFieldsRef = useRef({})

  function parseMoneyValue(value) {
    if (value === '' || value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null

    let normalized = String(value)
      .trim()
      .replace(/R\$/g, '')
      .replace(/\s/g, '')

    if (!normalized) return null

    if (normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '')
    }

    const parsed = Number(normalized)
    return parsed !== null && Number.isFinite(parsed) ? parsed : null
  }

  function formatMoneyField(value) {
    const parsed = parseMoneyValue(value)
    if (parsed === null) return ''
    return parsed.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  useEffect(() => {
    const kanban = kanbanScrollRef.current
    const fixedBar = kanbanFixedScrollRef.current

    function routeVerticalWheelToPage(event) {
      if (event.ctrlKey || event.metaKey) return

      const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (horizontalIntent || !event.deltaY) return

      event.preventDefault()
      window.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' })
    }

    const options = { passive: false }
    if (kanban) kanban.addEventListener('wheel', routeVerticalWheelToPage, options)
    if (fixedBar) fixedBar.addEventListener('wheel', routeVerticalWheelToPage, options)

    return () => {
      if (kanban) kanban.removeEventListener('wheel', routeVerticalWheelToPage, options)
      if (fixedBar) fixedBar.removeEventListener('wheel', routeVerticalWheelToPage, options)
    }
  }, [])
  const [leads, setLeads] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [targetSegments, setTargetSegments] = useState([])
  const [templates, setTemplates] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState(() => {
    try {
      const stored = sessionStorage.getItem('crm_focus_lead')
      if (stored) {
        sessionStorage.removeItem('crm_focus_lead')
        const lead = JSON.parse(stored)
        return { search: lead?.business_name || '', segment: 'all', status: 'all' }
      }
    } catch {}
    return { search: '', segment: 'all', status: 'all' }
  })
  const [totalLeads, setTotalLeads] = useState(0)
  const [statusCounts, setStatusCounts] = useState({})
  const [statusValueTotals, setStatusValueTotals] = useState({})
  const [statusOverdueCounts, setStatusOverdueCounts] = useState({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [form, setForm] = useState({
    business_name: '',
    campaign_id: '',
    segment: '',
    phone: '',
    website: '',
    email: '',
    address: '',
    city: settings?.default_city || 'Campinas',
    state: settings?.default_state || 'SP',
    contact_name: '',
    last_contact_date: '',
    next_contact_date: '',
    proposal_value: '',
    proposal_sent_at: '',
    status: 'new'
  })

  async function loadLookups() {
    const [
      { data: campaignData },
      { data: targetData },
      { data: templateData }
    ] = await Promise.all([
      supabase.from('campaigns').select('id,name,target_segment_id,target_segments(name)').eq('organization_id',organization.id).is('deleted_at',null).order('created_at',{ascending:false}),
      supabase.from('target_segments').select('id,name').eq('organization_id',organization.id).is('deleted_at',null).eq('is_active',true).order('name'),
      supabase.from('message_templates').select('id,name,target_segment_id,is_active').eq('organization_id',organization.id).eq('is_active',true).order('created_at',{ascending:false})
    ])

    setCampaigns(campaignData || [])
    setTargetSegments(targetData || [])
    setTemplates(templateData || [])
    if (!form.segment && targetData?.length) {
      setForm(old => ({ ...old, segment: targetData[0].id }))
    }
  }

  const ACTIVE_FUNNEL_STATUSES = ['new', 'qualified', 'queued', 'contacted', 'replied', 'interested', 'proposal', 'negotiation']
  const TERMINAL_FUNNEL_STATUSES = ['not_interested', 'won', 'lost']
  const TERMINAL_VISIBLE_LIMIT = 50

  async function loadActiveStatus(status, currentFilter) {
    const batchSize = 100
    let offset = 0
    let rows = []
    let summary = null

    while (true) {
      const { data, error } = await supabase.rpc('get_leads_page', {
        p_organization_id: organization.id,
        p_search: currentFilter.search.trim() || null,
        p_target_segment_id: currentFilter.segment === 'all' ? null : currentFilter.segment,
        p_status: status,
        p_limit: batchSize,
        p_offset: offset
      })
      if (error) throw error

      const payload = data || {}
      if (!summary) summary = payload
      const batchRows = Array.isArray(payload.rows) ? payload.rows : []
      rows = [...rows, ...batchRows]
      const total = Number(payload.total || 0)
      if (!batchRows.length || rows.length >= total) break
      offset += batchRows.length
    }

    return {
      status,
      rows,
      total: Number(summary?.total || rows.length),
      value: Number(summary?.status_value_totals?.[status] || 0),
      overdue: Number(summary?.status_overdue_counts?.[status] || 0)
    }
  }

  async function loadTerminalPreview(status, currentFilter, memberNames) {
    let query = supabase
      .from('leads')
      .select('id,organization_id,campaign_id,target_segment_id,business_name,segment,phone,website,email,address,city,state,status,contact_name,last_contact_date,last_contacted_at,next_contact_date,commercial_notes,proposal_value,proposal_sent_at,renegotiated_value,contract_value,contract_signed_at,lost_from_status,captured_by,assigned_to,created_at,status_changed_at,campaigns(name),target_segments(name)')
      .eq('organization_id', organization.id)
      .eq('status', status)
      .is('deleted_at', null)

    // Imported customers are in the customer portfolio, not sales-funnel wins.
    if (status === 'won') query = query.neq('source', 'import')

    if (currentFilter.segment !== 'all') query = query.eq('target_segment_id', currentFilter.segment)
    const safeSearch = currentFilter.search.trim().replace(/[,%()]/g, ' ')
    if (safeSearch) {
      query = query.or(`business_name.ilike.%${safeSearch}%,city.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`)
    }

    const { data, error } = await query
      .order('status_changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(TERMINAL_VISIBLE_LIMIT)

    if (error) throw error
    const rows = (data || []).map(lead => {
      const sellerId = lead.assigned_to || lead.captured_by || null
      return {
        ...lead,
        seller_id: sellerId,
        seller_name: sellerId ? (memberNames.get(sellerId) || 'Não atribuído') : 'Não atribuído'
      }
    })
    const value = rows.reduce((sum, lead) => sum + Number(lead.contract_value ?? lead.renegotiated_value ?? lead.proposal_value ?? 0), 0)
    return { status, rows, total: rows.length, value, overdue: 0 }
  }

  async function loadAllLeads(currentFilter = filter) {
    try {
      const { data: members } = await supabase
        .from('organization_members')
        .select('user_id,display_name')
        .eq('organization_id', organization.id)
        .eq('is_active', true)
        .is('deleted_at', null)
      const memberNames = new Map((members || []).map(member => [member.user_id, member.display_name || 'Usuário']))

      const requestedActiveStatuses = currentFilter.status === 'all'
        ? ACTIVE_FUNNEL_STATUSES
        : ACTIVE_FUNNEL_STATUSES.includes(currentFilter.status) ? [currentFilter.status] : []
      const requestedTerminalStatuses = currentFilter.status === 'all'
        ? TERMINAL_FUNNEL_STATUSES
        : TERMINAL_FUNNEL_STATUSES.includes(currentFilter.status) ? [currentFilter.status] : []

      const [activeGroups, terminalGroups] = await Promise.all([
        Promise.all(requestedActiveStatuses.map(status => loadActiveStatus(status, currentFilter))),
        Promise.all(requestedTerminalStatuses.map(status => loadTerminalPreview(status, currentFilter, memberNames)))
      ])

      const groups = [...activeGroups, ...terminalGroups]
      const rows = groups.flatMap(group => group.rows)
      const counts = {}
      const values = {}
      const overdue = {}
      groups.forEach(group => {
        counts[group.status] = group.total
        values[group.status] = group.value
        overdue[group.status] = group.overdue
      })

      setLeads(previous => mergeLeadsWithLocalDrafts(rows, previous, dirtyLeadFieldsRef.current))
      setTotalLeads(rows.length)
      setStatusCounts(counts)
      setStatusValueTotals(values)
      setStatusOverdueCounts(overdue)
    } catch (error) {
      setMessage(`Não foi possível carregar os leads: ${error.message}`)
    }
  }

  async function loadData() {
    await Promise.all([
      loadLookups(),
      loadAllLeads(filter)
    ])
  }

  useEffect(() => {
    loadLookups()
  }, [organization.id])

  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      if (!active) return
      setSelected(new Set())
      await loadAllLeads(filter)
    }, 250)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [organization.id, filter.search, filter.segment, filter.status])

  useEffect(() => {
    let active = true

    async function refreshVisibleLeads() {
      if (!active) return
      await loadAllLeads(filter)
    }

    const timer = setInterval(refreshVisibleLeads, 10000)

    function handleFocus() {
      refreshVisibleLeads()
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
    }
  }, [organization.id, filter.search, filter.segment, filter.status])

  useEffect(() => {
    let active = true

    async function loadJourneyEntries() {
      const { data, error } = await supabase
        .from('lead_journey_entries')
        .select('id,lead_id,stage,contact_name,proposal_value,proposal_sent_at,renegotiated_value,next_contact_date,contract_value,contract_signed_at,note,created_at')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })

      if (!active) return
      if (error) setMessage(error.message)
      else setJourneyEntries(data || [])
    }

    loadJourneyEntries()
    return () => { active = false }
  }, [organization.id])

  async function saveLead(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const selectedTarget = targetSegments.find(s => s.id === form.segment)

    const { error } = await supabase.from('leads').insert({
      organization_id: organization.id,
      campaign_id: form.campaign_id || null,
      target_segment_id: form.segment || null,
      business_name: form.business_name.trim(),
      segment: selectedTarget?.name || 'Público personalizado',
      phone: form.phone.trim() || null,
      website: form.website.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state || null,
      contact_name: form.contact_name.trim() || null,
      last_contact_date: form.last_contact_date || null,
      next_contact_date: form.next_contact_date || null,
      proposal_value: form.proposal_value === '' ? null : Number(String(form.proposal_value).replace(',', '.')),
      proposal_sent_at: form.proposal_sent_at || null,
      status: form.status,
      source: 'manual'
    })

    if (error) setMessage(error.message)
    else {
      setMessage('Lead cadastrado com sucesso.')
      setShowForm(false)
      setForm(old => ({
        ...old,
        business_name:'',
        phone:'',
        website:'',
        email:'',
        address:'',
        contact_name:'',
        last_contact_date:'',
        next_contact_date:'',
        proposal_value:'',
        proposal_sent_at:''
      }))
      await loadData()
    }
    setLoading(false)
  }

  function updateDraftField(id, field, value) {
    dirtyLeadFieldsRef.current = {
      ...dirtyLeadFieldsRef.current,
      [id]: {
        ...(dirtyLeadFieldsRef.current[id] || {}),
        [field]: true
      }
    }

    setLeads(old => old.map(item => item.id === id ? { ...item, [field]: value } : item))
  }

  function clearDirtyFields(id) {
    if (!dirtyLeadFieldsRef.current[id]) return
    const next = { ...dirtyLeadFieldsRef.current }
    delete next[id]
    dirtyLeadFieldsRef.current = next
  }

  async function persistDraftBeforeStatusChange(lead) {
    const dirty = dirtyLeadFieldsRef.current[lead.id]
    if (!dirty || !Object.keys(dirty).length) return true

    const numericFields = new Set(['proposal_value', 'renegotiated_value', 'contract_value'])
    const payload = {}

    Object.keys(dirty).forEach(field => {
      let value = lead[field]
      if (numericFields.has(field)) {
        if (value === '' || value === null || value === undefined) value = null
        else {
          const parsed = parseMoneyValue(value)
          value = Number.isFinite(parsed) ? parsed : null
        }
      } else if (typeof value === 'string') {
        value = value.trim() || null
      }
      payload[field] = value
    })

    payload.updated_at = new Date().toISOString()

    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', lead.id)
      .eq('organization_id', organization.id)

    if (error) {
      setMessage(`Não foi possível preservar os dados antes de mudar a etapa: ${error.message}`)
      return false
    }

    clearDirtyFields(lead.id)
    return true
  }

  async function updateStatus(id, status) {
    const currentLead = leads.find(item => item.id === id)
    if (!currentLead) return

    const currentStatus = currentLead.status
    const lockedTransitions = {
      interested: ['interested', 'proposal', 'lost'],
      proposal: ['proposal', 'negotiation', 'lost'],
      negotiation: ['negotiation', 'won', 'lost'],
      won: ['won'],
      lost: ['lost']
    }

    if (lockedTransitions[currentStatus] && !lockedTransitions[currentStatus].includes(status)) {
      setMessage('A partir de Interessado, o negócio só pode avançar. Para voltar uma etapa comercial, marque como Perdido e use Recuperar lead.')
      return
    }

    if (status === 'negotiation' && !['proposal','negotiation'].includes(currentStatus)) {
      setMessage('Negociação só pode ser iniciada depois da etapa Proposta.')
      return
    }

    let repositoryNote = null
    if (status === 'not_interested') {
      repositoryNote = window.prompt('Informe o motivo do não interesse:')
      if (repositoryNote === null) return
      if (!repositoryNote.trim()) {
        window.alert('Informe o motivo do não interesse antes de enviar o lead para Leads sem interesse.')
        return
      }
    }

    if (status === 'discarded') {
      repositoryNote = window.prompt('Informe o motivo do descarte (opcional):')
      if (repositoryNote === null) return
    }

    const draftPreserved = await persistDraftBeforeStatusChange(currentLead)
    if (!draftPreserved) return

    const payload = { status, updated_at: new Date().toISOString() }

    if (currentStatus === 'negotiation' && status === 'won') {
      const negotiatedValue = parseMoneyValue(currentLead.renegotiated_value)
      const proposalValue = parseMoneyValue(currentLead.proposal_value)
      const initialContractValue = negotiatedValue !== null ? negotiatedValue : proposalValue
      if (initialContractValue !== null) payload.contract_value = initialContractValue
    }
    if (status === 'lost' && currentStatus !== 'lost') payload.lost_from_status = currentStatus
    if (repositoryNote !== null && repositoryNote.trim()) payload.commercial_notes = repositoryNote.trim()

    const { data: stageChange, error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', id)
      .eq('organization_id', organization.id)
      .select('status_changed_at')
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    const localPayload = { ...payload, status_changed_at: stageChange.status_changed_at }
    if (Object.prototype.hasOwnProperty.call(localPayload, 'contract_value')) {
      localPayload.contract_value = formatMoneyField(localPayload.contract_value)
    }

    setLeads(old => old.map(item => item.id === id ? { ...item, ...localPayload } : item))
    setMessage('')
  }

  function allowedStatusOptions(currentStatus) {
    const locked = {
      interested: ['interested', 'proposal', 'lost'],
      proposal: ['proposal', 'negotiation', 'lost'],
      negotiation: ['negotiation', 'won', 'lost'],
      won: ['won'],
      lost: ['lost']
    }

    if (locked[currentStatus]) {
      return locked[currentStatus]
        .filter(value => statusLabel[value])
        .map(value => [value, statusLabel[value]])
    }

    return Object.entries(statusLabel)
      .filter(([value]) => value !== 'queued' && value !== 'negotiation')
  }

  async function saveStageCheckpoint(lead, stage) {
    if (savingLeadIds.has(lead.id)) return

    setSavingLeadIds(old => new Set([...old, lead.id]))
    setMessage('')

    const note = (noteDrafts[lead.id] || '').trim()
    const proposalValue = parseMoneyValue(lead.proposal_value)
    const renegotiatedValue = parseMoneyValue(lead.renegotiated_value)
    const contractValue = parseMoneyValue(lead.contract_value)

    const { data, error } = await supabase.rpc('save_lead_journey_checkpoint', {
      p_organization_id: organization.id,
      p_lead_id: lead.id,
      p_stage: stage,
      p_contact_name: (lead.contact_name || '').trim() || null,
      p_proposal_value: proposalValue,
      p_proposal_sent_at: lead.proposal_sent_at || null,
      p_renegotiated_value: renegotiatedValue,
      p_next_contact_date: ['replied','interested','proposal','negotiation'].includes(stage) ? (lead.next_contact_date || null) : null,
      p_contract_value: contractValue,
      p_contract_signed_at: lead.contract_signed_at || null,
      p_note: note || null
    })

    if (error) {
      setMessage(`Não foi possível salvar: ${error.message}`)
    } else {
      const entry = Array.isArray(data) ? data[0] : data
      clearDirtyFields(lead.id)
      if (entry?.id) setJourneyEntries(old => [entry, ...old])
      setNoteDrafts(old => ({ ...old, [lead.id]: '' }))
      setMessage('Informações salvas e registradas no histórico.')
    }

    setSavingLeadIds(old => {
      const next = new Set(old)
      next.delete(lead.id)
      return next
    })
  }

  async function recoverLostLead(lead) {
    const fallback = ['interested','proposal','negotiation'].includes(lead.lost_from_status)
      ? lead.lost_from_status
      : 'interested'

    if (!window.confirm(`Recuperar "${lead.business_name}" para ${statusLabel[fallback]}? Todo o histórico e os valores serão preservados.`)) return

    const { data: stageChange, error } = await supabase
      .from('leads')
      .update({ status: fallback, lost_from_status: null, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('organization_id', organization.id)
      .select('status_changed_at')
      .single()

    if (error) setMessage(error.message)
    else {
      setLeads(old => old.map(item => item.id === lead.id ? { ...item, status: fallback, lost_from_status: null, status_changed_at: stageChange.status_changed_at } : item))
      setMessage(`${lead.business_name} voltou para ${statusLabel[fallback]} com todo o histórico preservado.`)
    }
  }

  async function updateLeadContactField(id, field, value) {
    const allowed = ['contact_name', 'last_contact_date', 'next_contact_date', 'commercial_notes', 'proposal_value', 'proposal_sent_at']
    if (!allowed.includes(field)) return

    const dbValue = value === '' ? null : value

    setLeads(old => old.map(lead =>
      lead.id === id ? { ...lead, [field]: dbValue } : lead
    ))

    const { error } = await supabase
      .from('leads')
      .update({ [field]: dbValue })
      .eq('id', id)
      .eq('organization_id', organization.id)

    if (error) {
      setMessage(`Não foi possível atualizar o lead: ${error.message}`)
      await loadData()
    }
  }

  async function deleteLead(id, businessName) {
    const { error } = await softDeleteRow('leads', id, organization.id, { status: 'discarded' })
    if (error) {
      setMessage(`Não foi possível arquivar ${businessName}: ${error.message}`)
      return
    }
    setLeads(old => old.filter(l => l.id !== id))
    setSelected(old => {
      const next = new Set(old)
      next.delete(id)
      return next
    })
  }


  const visibleLeads = leads

  const eligibleVisibleLeads = visibleLeads.filter(l => l.status !== 'discarded')

  const batchLimit = Math.max(1, Number(settings?.whatsapp_batch_limit || 20))

  function toggleSelected(id) {
    setSelected(old => {
      const next = new Set(old)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= batchLimit) {
          setMessage(`O limite atual é de ${batchLimit} leads por envio.`)
          return old
        }
        next.add(id)
      }
      return next
    })
  }

  const bulkVisibleLimit = Math.min(batchLimit, eligibleVisibleLeads.length)
  const selectedEligibleVisibleCount = eligibleVisibleLeads.filter(l => selected.has(l.id)).length
  const bulkVisibleSelected = bulkVisibleLimit > 0 && (
    selectedEligibleVisibleCount >= bulkVisibleLimit ||
    (selectedEligibleVisibleCount > 0 && selected.size >= batchLimit)
  )

  function toggleAllVisible() {
    setSelected(old => {
      const next = new Set(old)
      const selectedVisible = eligibleVisibleLeads.filter(l => next.has(l.id))
      const shouldClear = bulkVisibleLimit > 0 && (
        selectedVisible.length >= bulkVisibleLimit ||
        (selectedVisible.length > 0 && next.size >= batchLimit)
      )

      if (shouldClear) {
        eligibleVisibleLeads.forEach(l => next.delete(l.id))
        setMessage('')
        return next
      }

      const selectedOutsideVisible = [...next].filter(id => !eligibleVisibleLeads.some(l => l.id === id)).length
      const available = Math.max(batchLimit - selectedOutsideVisible, 0)
      eligibleVisibleLeads.forEach(l => next.delete(l.id))
      eligibleVisibleLeads.slice(0, available).forEach(l => next.add(l.id))

      if (eligibleVisibleLeads.length > available) {
        setMessage(`Foram selecionados até ${batchLimit} leads, conforme o limite atual do lote.`)
      } else {
        setMessage('')
      }
      return next
    })
  }

  const selectedLeads = leads.filter(l => selected.has(l.id))
  const selectedWithPhone = selectedLeads.filter(l => normalizeWhatsAppNumber(l.phone))
  const selectedWithTemplate = selectedWithPhone.filter(l => templates.some(t => t.target_segment_id === l.target_segment_id))
  const missingPhone = selectedLeads.length - selectedWithPhone.length
  const missingTemplate = selectedWithPhone.length - selectedWithTemplate.length

  async function sendSelectedMessages() {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setMessage('O envio de mensagens está disponível somente na versão para computador.')
      return
    }

    if (!selected.size) {
      setMessage('Selecione pelo menos um lead.')
      return
    }

    const selectedIds = selectedLeads
      .filter(l => l.status !== 'discarded')
      .map(l => l.id)

    if (!selectedIds.length) {
      setMessage('Nenhum lead selecionado está apto para entrar na fila.')
      return
    }

    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.functions.invoke('enqueue_whatsapp_messages', {
      body: {
        organization_id: organization.id,
        lead_ids: selectedIds
      }
    })

    if (error) {
      setMessage(error.message || 'Não foi possível criar a fila de mensagens.')
    } else if (data?.error) {
      setMessage(data.error)
    } else {
      setSelected(new Set())
      const inicio = data?.first_scheduled_for ? formatDateTime(data.first_scheduled_for) : 'agora'
      const fim = data?.last_scheduled_for ? formatDateTime(data.last_scheduled_for) : '—'
      setMessage(
        `${data?.queued || 0} mensagem(ns) adicionada(s) à fila. Intervalo: ${data?.interval_seconds || 120}s. Início: ${inicio}. Última prevista: ${fim}.`
      )
      await loadData()
    }

    setLoading(false)
  }


  function currentLeadValue(lead) {
    return parseMoneyValue(lead.contract_value)
      ?? parseMoneyValue(lead.renegotiated_value)
      ?? parseMoneyValue(lead.proposal_value)
      ?? 0
  }

  function formatKanbanDate(value) {
    if (!value) return ''
    return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')
  }

  // The date when the lead entered Lost, in the CRM's São Paulo business timezone.
  // Never use contract_signed_at for a proposal that was declined.
  function formatLostDeclineDate(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date)
    const get = type => parts.find(part => part.type === type)?.value || ''
    return `${get('year')}-${get('month')}-${get('day')}`
  }

  function toggleLeadExpanded(leadId) {
    setExpandedLeadIds(current => {
      const next = new Set(current)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
  }

  const statusLabel = {
    new: 'Novo',
    queued: 'Na fila',
    contacted: 'Contatado',
    replied: 'Respondeu',
    interested: 'Interessado',
    proposal: 'Proposta',
    negotiation: 'Negociação',
    not_interested: 'Sem interesse',
    won: 'Ganho',
    lost: 'Perdido',
    discarded: 'Descartado'
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">BASE COMERCIAL</span>
          <h1>Leads</h1>
          <p className="muted">Selecione as empresas que devem receber a mensagem definida para o público-alvo.</p>
        </div>
        <div className="topbar-actions">
          <div className="user-badge">{userEmail}</div>
          <button type="button" className="secondary inline-btn" onClick={() => setShowExport(old => !old)}><Save size={17}/> Exportar Excel</button>
        </div>
      </header>

      {showExport && (
        <LeadExportPanel
          leads={leads}
          onClose={() => setShowExport(false)}
          onMessage={setMessage}
        />
      )}

      {showForm && (
        <section className="panel campaign-form-panel">
          <span className="eyebrow">NOVO LEAD</span>
          <h2>Cadastro manual</h2>
          <form onSubmit={saveLead} className="campaign-form">
            <div className="field-grid">
              <label>Empresa<input value={form.business_name} onChange={e=>setForm({...form,business_name:e.target.value})} required /></label>
              <label>Público-alvo
                <select value={form.segment} onChange={e=>setForm({...form,segment:e.target.value})} required>
                  {targetSegments.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <div className="field-grid">
              <label>Campanha
                <select value={form.campaign_id} onChange={e=>setForm({...form,campaign_id:e.target.value})}>
                  <option value="">Sem campanha</option>
                  {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>
                Telefone
                <div className="phone-input-wrap">
                  <span className="phone-prefix">+55</span>
                  <input
                    value={String(form.phone || '').replace(/\D/g, '').replace(/^55/, '')}
                    onChange={e => {
                      const local = e.target.value.replace(/\D/g, '').slice(0, 11)
                      setForm({...form, phone: local ? `55${local}` : ''})
                    }}
                    placeholder="DDD + número"
                  />
                </div>
              </label>
            </div>
            <div className="field-grid">
              <label>Site<input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} /></label>
              <label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></label>
            </div>
            <label>Endereço<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} /></label>
            <div className="field-grid">
              <label>Cidade<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} /></label>
              <label>UF
                <select value={form.state} onChange={e=>setForm({...form,state:e.target.value})}>
                  {UF_OPTIONS.map(uf=><option key={uf} value={uf}>{uf}</option>)}
                </select>
              </label>
            </div>

            <div className="field-grid lead-contact-form-grid">
              <label>
                Nome do contato
                <input
                  value={form.contact_name}
                  onChange={e=>setForm({...form,contact_name:e.target.value})}
                  placeholder="Ex.: João Silva"
                />
              </label>
              <label>
                Último contato
                <input
                  type="date"
                  value={form.last_contact_date}
                  onChange={e=>setForm({...form,last_contact_date:e.target.value})}
                />
              </label>
            </div>

            <label>
              Próximo contato previsto
              <input
                type="date"
                value={form.next_contact_date}
                onChange={e=>setForm({...form,next_contact_date:e.target.value})}
              />
            </label>

            <div className="form-actions">
              <button type="button" className="secondary" onClick={()=>setShowForm(false)}>Cancelar</button>
              <button className="primary" disabled={loading}>{loading?'Salvando...':'Salvar lead'}</button>
            </div>
          </form>
        </section>
      )}

      {message && <div className="notice">{message}</div>}

      <section className="panel leads-toolbar">
        <div className="search-box"><Search size={17}/><input value={filter.search} onChange={e=>setFilter({...filter,search:e.target.value})} placeholder="Buscar empresa, cidade ou telefone" /></div>
        <select value={filter.segment} onChange={e=>setFilter({...filter,segment:e.target.value})}>
          <option value="all">Todos os públicos</option>
          {targetSegments.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filter.status} onChange={e=>setFilter({...filter,status:e.target.value})}>
          <option value="all">Todos os status</option>
          {Object.entries(statusLabel).filter(([value]) => value !== 'discarded').map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
      </section>

      <div
        className="kanban-fixed-horizontal-scroll"
        ref={kanbanFixedScrollRef}
        onScroll={e => {
          const target = kanbanScrollRef.current
          if (target && Math.abs(target.scrollLeft - e.currentTarget.scrollLeft) > 1) {
            target.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
        aria-label="Rolagem horizontal do funil"
      >
        <div className="kanban-fixed-horizontal-scroll-inner" />
      </div>

      <section
        className="sales-kanban-wrap sales-kanban-always-scroll"
        ref={kanbanScrollRef}
        onScroll={e => {
          const target = kanbanFixedScrollRef.current
          if (target && Math.abs(target.scrollLeft - e.currentTarget.scrollLeft) > 1) {
            target.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
      >
        <div className="sales-kanban">
          {['new','contacted','replied','interested','proposal','negotiation','won','lost']
            .map(status => {
              const label = statusLabel[status]
              const columnLeads = sortKanbanColumn(visibleLeads.filter(l => l.status === status))
              const columnTotal = Number(statusValueTotals?.[status] || 0)
              const overdueCount = Number(statusOverdueCounts?.[status] || 0)
              return (
                <div className="kanban-column" key={status}>
                  <div className="kanban-column-head kanban-column-head-v70">
                    <div className="kanban-column-title-v70">
                      <strong>{label}</strong>
                      <span>{Number(statusCounts?.[status] || 0)}</span>
                    </div>
                    {!['new', 'contacted'].includes(status) && (
                      <div className="kanban-column-metrics-v70">
                        {!['replied', 'interested'].includes(status) && <strong>{formatCurrency(columnTotal)}</strong>}
                        <span className={overdueCount > 0 ? 'has-overdue' : ''} title="Retornos atrasados">
                          <Clock size={14}/>{overdueCount}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="kanban-column-cards">
                    {columnLeads.length === 0 ? (
                      <div className="kanban-empty">Nenhum negócio</div>
                    ) : columnLeads.map(l => {
                      const earlyStage = ['new','contacted'].includes(status)
                      const repliedStage = status === 'replied'
                      const interestedStage = status === 'interested'
                      const proposalStage = status === 'proposal'
                      const negotiationStage = status === 'negotiation'
                      const closedStage = ['won','lost'].includes(status)
                      const showEditor = repliedStage || interestedStage || proposalStage || negotiationStage || closedStage
                      const leadHistory = journeyEntries.filter(entry => entry.lead_id === l.id)
                      const expanded = expandedLeadIds.has(l.id)
                      const tracksReturnDeadline = ['replied', 'interested', 'proposal', 'negotiation'].includes(status)
                      const overdue = tracksReturnDeadline && isOverdueReturn(l)
                      const withinDueDate = tracksReturnDeadline && Boolean(l.next_contact_date) && !overdue && l.next_contact_date >= currentBrazilDate()

                      return (
                        <article
                          className={`panel kanban-lead-card kanban-lead-card-v70 status-${status}-v71${overdue ? ' is-overdue-v70' : withinDueDate ? ' is-on-time-v70' : ''}`}
                          key={l.id}
                        >
                          <div className="kanban-summary-v70">
                            <div className="kanban-summary-topline-v70">
                              <div>
                                <span className="kanban-segment-v70">{l.target_segments?.name || l.segment || 'Sem segmento'}</span>
                                <span className="kanban-company-v70">{l.business_name}</span>
                              </div>
                              <button
                                type="button"
                                className="kanban-expand-toggle-v70"
                                onClick={() => toggleLeadExpanded(l.id)}
                                aria-label={expanded ? `Ocultar detalhes de ${l.business_name}` : `Exibir detalhes de ${l.business_name}`}
                                aria-expanded={expanded}
                              >
                                {expanded ? '−' : '+'}
                              </button>
                            </div>

                            <div className="kanban-people-row-v70">
                              <strong>{l.contact_name || 'Contato não informado'}</strong>
                              <span><UserRound size={14}/>{l.seller_name || 'Não atribuído'}</span>
                            </div>

                            {(!['new', 'contacted', 'replied', 'interested'].includes(status) || currentLeadValue(l) !== 0) && (
                              <strong className="kanban-value-v70">{formatCurrency(currentLeadValue(l))}</strong>
                            )}

                            {status !== 'lost' && (
                              <div className={`kanban-due-v70${overdue ? ' overdue' : withinDueDate ? ' on-time' : ''}`}>
                                {overdue ? (
                                  <strong>ATRASADO</strong>
                                ) : l.next_contact_date ? (
                                  <span><Clock size={14}/>{formatKanbanDate(l.next_contact_date)}</span>
                                ) : (
                                  <span>Sem retorno previsto</span>
                                )}
                              </div>
                            )}
                          </div>

                          {expanded && (
                            <div className="kanban-expanded-v70">
                              <div className="kanban-card-meta">
                                <span>{l.city || '—'}{l.state ? ` / ${l.state}` : ''}</span>
                                <span>{l.phone || 'Sem telefone'}</span>
                                {l.campaigns?.name && <span>{l.campaigns.name}</span>}
                              </div>

                          {showEditor && (
                            <label>
                              <span>Nome do contato</span>
                              <input
                                value={l.contact_name || ''}
                                onChange={e => updateDraftField(l.id, 'contact_name', e.target.value)}
                                placeholder="Nome do responsável"
                              />
                            </label>
                          )}

                          {proposalStage && (
                            <div className="kanban-two-fields">
                              <label>
                                <span>Valor da proposta</span>
                                <div className="money-input-wrap-v58">
                                  <span className="money-prefix-v58">R$</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={l.proposal_value ?? ''}
                                    onChange={e => updateDraftField(l.id, 'proposal_value', e.target.value)}
                                    onBlur={e => updateDraftField(l.id, 'proposal_value', formatMoneyField(e.target.value))}
                                    placeholder="0,00"
                                  />
                                </div>
                              </label>
                              <label>
                                <span>Proposta enviada</span>
                                <input
                                  type="date"
                                  value={l.proposal_sent_at || ''}
                                  onChange={e => updateDraftField(l.id, 'proposal_sent_at', e.target.value)}
                                />
                              </label>
                            </div>
                          )}

                          {negotiationStage && (
                            <>
                              <div className="kanban-two-fields">
                                <label>
                                  <span>Valor da proposta</span>
                                  <div className="money-input-wrap-v58 readonly-money-v58">
                                    <span className="money-prefix-v58">R$</span>
                                    <input type="text" value={formatMoneyField(l.proposal_value)} readOnly className="readonly-field-v54" />
                                  </div>
                                </label>
                                <label>
                                  <span>Proposta enviada</span>
                                  <input type="date" value={l.proposal_sent_at || ''} readOnly className="readonly-field-v54" />
                                </label>
                              </div>
                              <label>
                                <span>Valor renegociado</span>
                                <div className="money-input-wrap-v58">
                                  <span className="money-prefix-v58">R$</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={l.renegotiated_value ?? ''}
                                    onChange={e => updateDraftField(l.id, 'renegotiated_value', e.target.value)}
                                    onBlur={e => updateDraftField(l.id, 'renegotiated_value', formatMoneyField(e.target.value))}
                                    placeholder="0,00"
                                  />
                                </div>
                              </label>
                            </>
                          )}

                          {status === 'won' && (
                            <div className="kanban-two-fields">
                              <label>
                                <span>Valor do contrato</span>
                                <div className="money-input-wrap-v58">
                                  <span className="money-prefix-v58">R$</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={l.contract_value ?? ''}
                                    onChange={e => updateDraftField(l.id, 'contract_value', e.target.value)}
                                    onBlur={e => updateDraftField(l.id, 'contract_value', formatMoneyField(e.target.value))}
                                    placeholder="0,00"
                                  />
                                </div>
                              </label>
                              <label>
                                <span>Data da assinatura do contrato</span>
                                <input
                                  type="date"
                                  value={l.contract_signed_at || ''}
                                  onChange={e => updateDraftField(l.id, 'contract_signed_at', e.target.value)}
                                />
                              </label>
                            </div>
                          )}

                          {status === 'lost' && (
                            <label>
                              <span>Data de declínio da proposta</span>
                              <input
                                type="date"
                                value={formatLostDeclineDate(l.status_changed_at)}
                                readOnly
                                className="readonly-field-v54"
                              />
                            </label>
                          )}

                          {(repliedStage || interestedStage || proposalStage || negotiationStage) && (
                            <label className={l.next_contact_date && l.next_contact_date < currentBrazilDate() ? 'next-contact-overdue' : ''}>
                              <span>Próximo contato {l.next_contact_date && l.next_contact_date < currentBrazilDate() && <strong className="overdue-badge">Atrasado</strong>}</span>
                              <input
                                type="date"
                                value={l.next_contact_date || ''}
                                onChange={e => updateDraftField(l.id, 'next_contact_date', e.target.value)}
                              />
                            </label>
                          )}

                          {showEditor && (
                            <div className="journey-note-editor-v54">
                              <label>
                                <span>Anotações comerciais</span>
                                <textarea
                                  className="lead-notes-textarea"
                                  value={noteDrafts[l.id] || ''}
                                  onChange={e => setNoteDrafts(old => ({ ...old, [l.id]: e.target.value }))}
                                  placeholder="Registre a conversa, objeções, decisões e próximos passos."
                                />
                              </label>
                              <div className="journey-save-row-v54">
                                <button
                                  type="button"
                                  className="journey-save-button-v54"
                                  onClick={() => saveStageCheckpoint(l, status)}
                                  disabled={savingLeadIds.has(l.id)}
                                >
                                  {savingLeadIds.has(l.id) ? 'Salvando...' : 'Salvar'}
                                </button>
                              </div>
                            </div>
                          )}

                          {showEditor && (leadHistory.length > 0 || (l.commercial_notes || '').trim()) && (
                            <div className="lead-journey-history-v54">
                              <span className="lead-journey-history-title-v54">Histórico</span>
                              {!leadHistory.length && (l.commercial_notes || '').trim() && (
                                <div className="lead-journey-entry-v54 legacy">
                                  <small>Registro anterior</small>
                                  <p>{l.commercial_notes}</p>
                                </div>
                              )}
                              {leadHistory.map(entry => (
                                <div className="lead-journey-entry-v54" key={entry.id}>
                                  <small>{formatDateTime(entry.created_at)} • {statusLabel[entry.stage] || entry.stage}</small>
                                  {entry.note && <p>{entry.note}</p>}
                                  <div className="lead-journey-values-v54">
                                    {entry.proposal_value !== null && entry.proposal_value !== undefined && <span>Proposta: {formatCurrency(entry.proposal_value)}</span>}
                                    {entry.renegotiated_value !== null && entry.renegotiated_value !== undefined && <span>Renegociado: {formatCurrency(entry.renegotiated_value)}</span>}
                                    {entry.contract_value !== null && entry.contract_value !== undefined && <span>Contrato: {formatCurrency(entry.contract_value)}</span>}
                                    {entry.next_contact_date && <span>Próximo contato: {new Date(`${entry.next_contact_date}T12:00:00`).toLocaleDateString('pt-BR')}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <label>
                            <span>Status</span>
                            <select value={l.status} onChange={e => updateStatus(l.id, e.target.value)}>
                              {allowedStatusOptions(l.status).map(([value,statusName]) => <option key={value} value={value}>{statusName}</option>)}
                            </select>
                          </label>

                          {status === 'lost' && (
                            <button type="button" className="secondary recover-lead-v54" onClick={() => recoverLostLead(l)}>
                              Recuperar lead
                            </button>
                          )}

                              <div className="kanban-card-footer">
                                {l.website ? <a className="lead-site-link" href={l.website} target="_blank" rel="noreferrer">Abrir site</a> : <span />}
                              </div>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </div>
              )
            })}
        </div>
      </section>
    </>
  )
}

function Clients({ organization, userEmail, userId }) {
  const [clients, setClients] = useState([])
  const [sales, setSales] = useState([])
  const [activities, setActivities] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [clientForm, setClientForm] = useState({})
  const [interactionForm, setInteractionForm] = useState({
    type: 'whatsapp',
    occurred_at: currentLocalDateTimeInput(),
    notes: ''
  })
  const [saleForm, setSaleForm] = useState({
    id: null,
    sale_date: currentBrazilDate(),
    amount: '',
    product_service: '',
    notes: ''
  })

  function parseClientMoney(value) {
    if (value === '' || value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null

    let normalized = String(value)
      .trim()
      .replace(/R\$/g, '')
      .replace(/\s/g, '')

    if (!normalized) return null

    if (normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '')
    }

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  function formatClientMoney(value) {
    const parsed = parseClientMoney(value)
    if (parsed === null) return ''
    return parsed.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  async function loadData(preferredSelectedId = selectedId) {
    const { data: clientData, error: clientError } = await supabase
      .from('leads')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('status', 'won')
      .order('business_name', { ascending: true })

    if (clientError) {
      setMessage(`Não foi possível carregar os clientes: ${clientError.message}`)
      return
    }

    const rows = clientData || []
    setClients(rows)
    const ids = rows.map(item => item.id)

    if (!ids.length) {
      setSales([])
      setActivities([])
      setSelectedId(null)
      return
    }

    const [{ data: salesData, error: salesError }, { data: activityData, error: activityError }] = await Promise.all([
      supabase
        .from('sales')
        .select('*')
        .eq('organization_id', organization.id)
        .in('lead_id', ids)
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('activities')
        .select('*')
        .eq('organization_id', organization.id)
        .in('lead_id', ids)
        .order('occurred_at', { ascending: false })
    ])

    if (salesError) setMessage(`Não foi possível carregar as vendas: ${salesError.message}`)
    if (activityError) setMessage(`Não foi possível carregar o histórico: ${activityError.message}`)

    setSales(salesData || [])
    setActivities(activityData || [])

    const stillExists = rows.some(item => item.id === preferredSelectedId)
    if (preferredSelectedId && stillExists) setSelectedId(preferredSelectedId)
  }

  useEffect(() => {
    loadData(null)
  }, [organization.id])

  const selectedClient = clients.find(item => item.id === selectedId) || null

  useEffect(() => {
    if (!selectedClient) {
      setClientForm({})
      return
    }

    setClientForm({
      business_name: selectedClient.business_name || '',
      legal_name: selectedClient.legal_name || '',
      cnpj: selectedClient.cnpj || '',
      segment: selectedClient.segment || '',
      address: selectedClient.address || '',
      city: selectedClient.city || '',
      state: selectedClient.state || '',
      website: selectedClient.website || '',
      customer_origin: selectedClient.customer_origin || '',
      contact_name: selectedClient.contact_name || '',
      contact_role: selectedClient.contact_role || '',
      phone: selectedClient.phone || '',
      whatsapp_phone: selectedClient.whatsapp_phone || selectedClient.phone || '',
      email: selectedClient.email || '',
      next_contact_date: selectedClient.next_contact_date || '',
      commercial_notes: selectedClient.commercial_notes || ''
    })
  }, [selectedClient?.id])

  const salesByLead = useMemo(() => {
    const map = new Map()
    for (const sale of sales) {
      if (!map.has(sale.lead_id)) map.set(sale.lead_id, [])
      map.get(sale.lead_id).push(sale)
    }
    return map
  }, [sales])

  const activitiesByLead = useMemo(() => {
    const map = new Map()
    for (const activity of activities) {
      if (!map.has(activity.lead_id)) map.set(activity.lead_id, [])
      map.get(activity.lead_id).push(activity)
    }
    return map
  }, [activities])

  const visibleClients = clients.filter(client => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [
      client.business_name,
      client.legal_name,
      client.contact_name,
      client.phone,
      client.email,
      client.city
    ].some(value => String(value || '').toLowerCase().includes(q))
  })

  function clientMetrics(clientId) {
    const clientSales = salesByLead.get(clientId) || []
    const total = clientSales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)
    const lastSale = clientSales[0] || null
    return {
      count: clientSales.length,
      total,
      average: clientSales.length ? total / clientSales.length : 0,
      lastSale
    }
  }

  async function saveClient(e) {
    e.preventDefault()
    if (!selectedClient) return
    setLoading(true)
    setMessage('')

    const payload = {
      business_name: clientForm.business_name.trim(),
      legal_name: clientForm.legal_name.trim() || null,
      cnpj: clientForm.cnpj.trim() || null,
      segment: clientForm.segment.trim() || selectedClient.segment,
      address: clientForm.address.trim() || null,
      city: clientForm.city.trim() || null,
      state: clientForm.state || null,
      website: clientForm.website.trim() || null,
      customer_origin: clientForm.customer_origin.trim() || null,
      contact_name: clientForm.contact_name.trim() || null,
      contact_role: clientForm.contact_role.trim() || null,
      phone: clientForm.phone.trim() || null,
      whatsapp_phone: clientForm.whatsapp_phone.trim() || null,
      email: clientForm.email.trim() || null,
      next_contact_date: clientForm.next_contact_date || null,
      commercial_notes: clientForm.commercial_notes?.trim() || null,
      updated_at: new Date().toISOString()
    }

    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', selectedClient.id)
      .eq('organization_id', organization.id)

    if (error) setMessage(`Não foi possível salvar o cliente: ${error.message}`)
    else {
      setMessage('Dados do cliente atualizados.')
      await loadData(selectedClient.id)
    }
    setLoading(false)
  }

  async function saveInteraction(e) {
    e.preventDefault()
    if (!selectedClient || !interactionForm.notes.trim()) return
    setLoading(true)
    setMessage('')

    const mapping = {
      whatsapp: { activity_type: 'whatsapp', channel: 'whatsapp' },
      call: { activity_type: 'call', channel: 'phone' },
      email: { activity_type: 'email', channel: 'email' },
      meeting: { activity_type: 'meeting', channel: 'other' },
      note: { activity_type: 'note', channel: 'other' }
    }
    const mapped = mapping[interactionForm.type] || mapping.note
    const occurredAt = interactionForm.occurred_at
      ? new Date(interactionForm.occurred_at).toISOString()
      : new Date().toISOString()

    const { error } = await supabase.from('activities').insert({
      organization_id: organization.id,
      lead_id: selectedClient.id,
      activity_type: mapped.activity_type,
      channel: mapped.channel,
      notes: interactionForm.notes.trim(),
      occurred_at: occurredAt,
      created_by: userId || null
    })

    if (error) {
      setMessage(`Não foi possível registrar a interação: ${error.message}`)
      setLoading(false)
      return
    }

    if (interactionForm.type !== 'note') {
      const contactDate = interactionForm.occurred_at
        ? interactionForm.occurred_at.slice(0, 10)
        : currentBrazilDate()

      await supabase
        .from('leads')
        .update({
          last_contact_date: contactDate,
          last_contacted_at: occurredAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedClient.id)
        .eq('organization_id', organization.id)
    }

    setInteractionForm({ type: 'whatsapp', occurred_at: currentLocalDateTimeInput(), notes: '' })
    setMessage('Interação registrada no histórico.')
    await loadData(selectedClient.id)
    setLoading(false)
  }

  function resetSaleForm() {
    setSaleForm({ id: null, sale_date: currentBrazilDate(), amount: '', product_service: '', notes: '' })
  }

  function editSale(sale) {
    setSaleForm({
      id: sale.id,
      sale_date: sale.sale_date || currentBrazilDate(),
      amount: formatClientMoney(sale.amount),
      product_service: sale.product_service || '',
      notes: sale.notes || ''
    })
  }

  async function saveSale(e) {
    e.preventDefault()
    if (!selectedClient) return
    const amount = parseClientMoney(saleForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Informe um valor de venda maior que zero.')
      return
    }

    setLoading(true)
    setMessage('')

    const payload = {
      sale_date: saleForm.sale_date || currentBrazilDate(),
      amount,
      product_service: saleForm.product_service.trim() || null,
      notes: saleForm.notes.trim() || null,
      updated_at: new Date().toISOString()
    }

    let error
    if (saleForm.id) {
      ;({ error } = await supabase
        .from('sales')
        .update(payload)
        .eq('id', saleForm.id)
        .eq('lead_id', selectedClient.id)
        .eq('organization_id', organization.id))
    } else {
      ;({ error } = await supabase.from('sales').insert({
        ...payload,
        organization_id: organization.id,
        lead_id: selectedClient.id,
        created_by: userId || null
      }))
    }

    if (error) setMessage(`Não foi possível salvar a venda: ${error.message}`)
    else {
      setMessage(saleForm.id ? 'Venda atualizada.' : 'Nova venda adicionada ao histórico.')
      resetSaleForm()
      await loadData(selectedClient.id)
    }
    setLoading(false)
  }

  async function deleteSale(sale) {
    const { error } = await softDeleteRow('sales', sale.id, organization.id)
    if (error) setMessage(`Não foi possível arquivar a venda: ${error.message}`)
    else {
      setMessage('Venda arquivada. O histórico permanece preservado no banco.')
      await loadData(selectedClient.id)
    }
  }

  function activityLabel(activity) {
    const labels = {
      whatsapp: 'WhatsApp',
      call: 'Ligação',
      email: 'E-mail',
      meeting: 'Reunião',
      note: 'Observação',
      message_sent: 'Mensagem enviada',
      message_prepared: 'Mensagem preparada',
      reply_received: 'Resposta recebida',
      auto_reply_received: 'Resposta automática',
      follow_up: 'Follow-up',
      status_change: 'Alteração de status',
      queued: 'Incluído na fila'
    }
    return labels[activity.activity_type] || activity.activity_type
  }

  if (selectedClient) {
    const clientSales = salesByLead.get(selectedClient.id) || []
    const clientActivities = activitiesByLead.get(selectedClient.id) || []
    const metrics = clientMetrics(selectedClient.id)

    return (
      <>
        <header className="topbar">
          <div>
            <button className="client-back" onClick={() => { setSelectedId(null); setMessage(''); resetSaleForm() }}>
              ← Voltar para clientes
            </button>
            <span className="eyebrow">CLIENTE</span>
            <h1>{selectedClient.business_name}</h1>
          </div>
          <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
        </header>

        {message && <div className="notice">{message}</div>}

        <section className="client-metrics-grid">
          <StatCard label="Compras" value={metrics.count} detail="registros no histórico" />
          <StatCard label="Total comprado" value={formatCurrency(metrics.total)} detail="soma das vendas registradas" />
          <StatCard label="Ticket médio" value={formatCurrency(metrics.average)} detail="média por compra" />
          <StatCard label="Última compra" value={metrics.lastSale?.sale_date ? new Date(`${metrics.lastSale.sale_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'} detail="data mais recente" />
        </section>

        <section className="panel client-section">
          <div className="panel-head">
            <div>
              <span className="eyebrow">CADASTRO</span>
              <h2>Dados comerciais e de contato</h2>
            </div>
          </div>
          <form onSubmit={saveClient} className="client-form">
            <div className="field-grid">
              <label>Nome da empresa<input value={clientForm.business_name || ''} onChange={e => setClientForm({...clientForm, business_name:e.target.value})} required /></label>
              <label>Razão social<input value={clientForm.legal_name || ''} onChange={e => setClientForm({...clientForm, legal_name:e.target.value})} /></label>
            </div>
            <div className="field-grid three">
              <label>CNPJ<input value={clientForm.cnpj || ''} onChange={e => setClientForm({...clientForm, cnpj:e.target.value})} /></label>
              <label>Segmento<input value={clientForm.segment || ''} onChange={e => setClientForm({...clientForm, segment:e.target.value})} /></label>
              <label>Origem<input value={clientForm.customer_origin || ''} onChange={e => setClientForm({...clientForm, customer_origin:e.target.value})} placeholder="Ex.: Prospecção ativa" /></label>
            </div>
            <label>Endereço<input value={clientForm.address || ''} onChange={e => setClientForm({...clientForm, address:e.target.value})} /></label>
            <div className="field-grid three">
              <label>Cidade<input value={clientForm.city || ''} onChange={e => setClientForm({...clientForm, city:e.target.value})} /></label>
              <label>UF
                <select value={clientForm.state || ''} onChange={e => setClientForm({...clientForm, state:e.target.value})}>
                  <option value="">—</option>
                  {UF_OPTIONS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </label>
              <label>Site<input value={clientForm.website || ''} onChange={e => setClientForm({...clientForm, website:e.target.value})} /></label>
            </div>
            <div className="client-form-divider">Contato principal</div>
            <div className="field-grid">
              <label>Nome<input value={clientForm.contact_name || ''} onChange={e => setClientForm({...clientForm, contact_name:e.target.value})} /></label>
              <label>Cargo<input value={clientForm.contact_role || ''} onChange={e => setClientForm({...clientForm, contact_role:e.target.value})} /></label>
            </div>
            <div className="field-grid three">
              <label>Telefone<input value={clientForm.phone || ''} onChange={e => setClientForm({...clientForm, phone:e.target.value})} /></label>
              <label>WhatsApp<input value={clientForm.whatsapp_phone || ''} onChange={e => setClientForm({...clientForm, whatsapp_phone:e.target.value})} /></label>
              <label>E-mail<input type="email" value={clientForm.email || ''} onChange={e => setClientForm({...clientForm, email:e.target.value})} /></label>
            </div>
            <label>Próxima ação / contato<input type="date" value={clientForm.next_contact_date || ''} onChange={e => setClientForm({...clientForm, next_contact_date:e.target.value})} /></label>
            <label>
              Anotações comerciais da prospecção
              <textarea
                className="client-textarea"
                value={clientForm.commercial_notes || ''}
                onChange={e => setClientForm({...clientForm, commercial_notes:e.target.value})}
                placeholder="Informações registradas enquanto este cliente ainda era um lead interessado."
              />
            </label>
            <div className="form-actions"><button className="primary inline-btn" disabled={loading}><Save size={16}/> Salvar dados</button></div>
          </form>
        </section>

        <div className="client-detail-grid">
          <section className="panel client-section">
            <span className="eyebrow">HISTÓRICO</span>
            <h2>Interações</h2>
            <form onSubmit={saveInteraction} className="compact-form">
              <div className="field-grid">
                <label>Tipo
                  <select value={interactionForm.type} onChange={e => setInteractionForm({...interactionForm,type:e.target.value})}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="call">Ligação</option>
                    <option value="email">E-mail</option>
                    <option value="meeting">Reunião</option>
                    <option value="note">Observação</option>
                  </select>
                </label>
                <label>Data e hora<input type="datetime-local" value={interactionForm.occurred_at} required onChange={e => setInteractionForm({...interactionForm,occurred_at:e.target.value})} /></label>
              </div>
              <label>Registro<textarea className="client-textarea" value={interactionForm.notes} onChange={e => setInteractionForm({...interactionForm,notes:e.target.value})} placeholder="O que aconteceu neste contato?" required /></label>
              <div className="form-actions"><button className="primary" disabled={loading}>Registrar interação</button></div>
            </form>

            <div className="timeline-list">
              {clientActivities.length === 0 ? <p className="muted">Nenhuma interação registrada.</p> : clientActivities.map(activity => (
                <article className="timeline-item" key={activity.id}>
                  <div className="timeline-dot" />
                  <div>
                    <div className="timeline-head"><strong>{activityLabel(activity)}</strong><span>{formatDateTime(activity.occurred_at)}</span></div>
                    <p>{activity.notes || 'Sem observação.'}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel client-section">
            <span className="eyebrow">COMPRAS</span>
            <h2>{saleForm.id ? 'Editar venda' : 'Registrar venda'}</h2>
            <form onSubmit={saveSale} className="compact-form">
              <div className="field-grid">
                <label>Data<input type="date" value={saleForm.sale_date} onChange={e => setSaleForm({...saleForm,sale_date:e.target.value})} required /></label>
                <label>Valor
                  <div className="money-input-wrap-v58">
                    <span className="money-prefix-v58">R$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={saleForm.amount}
                      onChange={e => setSaleForm({...saleForm,amount:e.target.value})}
                      onBlur={e => setSaleForm(old => ({...old, amount: formatClientMoney(e.target.value)}))}
                      placeholder="0,00"
                      required
                    />
                  </div>
                </label>
              </div>
              <label>Produto / serviço<input value={saleForm.product_service} onChange={e => setSaleForm({...saleForm,product_service:e.target.value})} placeholder="Opcional" /></label>
              <label>Observação<textarea className="client-textarea" value={saleForm.notes} onChange={e => setSaleForm({...saleForm,notes:e.target.value})} placeholder="Opcional" /></label>
              <div className="form-actions">
                {saleForm.id && <button type="button" className="secondary" onClick={resetSaleForm}>Cancelar edição</button>}
                <button className="primary" disabled={loading}>{saleForm.id ? 'Salvar alteração' : 'Adicionar ao histórico'}</button>
              </div>
            </form>

            <div className="sales-history">
              {clientSales.length === 0 ? <p className="muted">Nenhuma venda registrada.</p> : clientSales.map(sale => (
                <article className="sale-row" key={sale.id}>
                  <div>
                    <strong>{formatCurrency(sale.amount)}</strong>
                    <span>{sale.sale_date ? new Date(`${sale.sale_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}{sale.product_service ? ` • ${sale.product_service}` : ''}</span>
                    {sale.notes && <p>{sale.notes}</p>}
                  </div>
                  <div className="sale-actions">
                    <button type="button" className="secondary small-action" onClick={() => editSale(sale)}>Editar</button>
                    <button type="button" className="text-danger" onClick={() => deleteSale(sale)}><Trash2 size={14}/> Arquivar</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </>
    )
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">CARTEIRA COMERCIAL</span>
          <h1>Clientes</h1>
          <p className="muted">Clientes conquistados no funil ou adicionados por importação aparecem aqui.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <CustomerImportPanel organization={organization} userId={userId} onImported={() => loadData(null)} />
      <CrmFullExport organization={organization} userId={userId} />

      {message && <div className="notice">{message}</div>}

      <section className="panel clients-toolbar">
        <div className="search-box"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, contato, cidade ou telefone" /></div>
        <div className="clients-count"><strong>{visibleClients.length}</strong><span>cliente{visibleClients.length === 1 ? '' : 's'}</span></div>
      </section>

      <section className="client-list">
        {visibleClients.length === 0 ? (
          <article className="panel empty-state"><CheckCircle2 size={34}/><h2>Nenhum cliente ainda</h2><p>Quando um lead for marcado como Ganho, ele aparecerá aqui automaticamente.</p></article>
        ) : visibleClients.map(client => {
          const metrics = clientMetrics(client.id)
          return (
            <button className="panel client-list-row" key={client.id} onClick={() => { setSelectedId(client.id); setMessage(''); resetSaleForm() }}>
              <div className="client-list-main">
                <strong>{client.business_name}</strong>
                <span>{client.contact_name || 'Contato não informado'}{client.city ? ` • ${client.city}${client.state ? `/${client.state}` : ''}` : ''}</span>
              </div>
              <div className="client-list-metric"><span>Telefone</span><strong>{client.phone || '—'}</strong></div>
              <div className="client-list-metric"><span>Última compra</span><strong>{metrics.lastSale?.sale_date ? new Date(`${metrics.lastSale.sale_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</strong></div>
              <div className="client-list-metric"><span>Total comprado</span><strong>{formatCurrency(metrics.total)}</strong></div>
              <div className="client-list-metric"><span>Próxima ação</span><strong className={client.next_contact_date && client.next_contact_date < currentBrazilDate() ? 'overdue-text' : ''}>{client.next_contact_date ? new Date(`${client.next_contact_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</strong></div>
              <ChevronRight size={18}/>
            </button>
          )
        })}
      </section>
    </>
  )
}

function Messages({ organization, userEmail }) {
  const [templates, setTemplates] = useState([])
  const [segments, setSegments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    name: '',
    target_segment_id: '',
    is_default_for_target: true,
    body: 'Olá, tudo bem? Encontrei a {empresa}, em {cidade}/{uf}. Gostaria de falar com o responsável pela área. Posso te explicar rapidamente?'
  })

  async function loadData() {
    const [{data:templateData},{data:segmentData}] = await Promise.all([
      supabase.from('message_templates').select('*,target_segments(name)').eq('organization_id',organization.id).order('created_at',{ascending:false}),
      supabase.from('target_segments').select('id,name').eq('organization_id',organization.id).is('deleted_at',null).eq('is_active',true).order('name')
    ])
    setTemplates(templateData || [])
    setSegments(segmentData || [])
    if (!form.target_segment_id && segmentData?.length) {
      setForm(old => ({...old,target_segment_id:segmentData[0].id}))
    }
  }

  useEffect(()=>{loadData()},[organization.id])

  function resetForm() {
    setEditingId(null)
    setForm({
      name:'',
      target_segment_id:segments[0]?.id || '',
      is_default_for_target: true,
      body:'Olá, tudo bem? Encontrei a {empresa}, em {cidade}/{uf}. Gostaria de falar com o responsável pela área. Posso te explicar rapidamente?'
    })
  }

  function editTemplate(t) {
    setEditingId(t.id)
    setForm({
      name:t.name,
      target_segment_id:t.target_segment_id || '',
      is_default_for_target:Boolean(t.is_default_for_target),
      body:t.body
    })
    setShowForm(true)
  }

  async function saveTemplate(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const target = segments.find(s=>s.id===form.target_segment_id)
    let error

    const payload = {
      name: form.name.trim(),
      target_segment_id: form.target_segment_id,
      segment: target?.name || 'Público personalizado',
      body: form.body.trim(),
      is_default_for_target: Boolean(form.is_default_for_target)
    }

    if (form.is_default_for_target && form.target_segment_id) {
      await supabase
        .from('message_templates')
        .update({ is_default_for_target: false })
        .eq('organization_id', organization.id)
        .eq('target_segment_id', form.target_segment_id)
    }

    if (editingId) {
      ({error}=await supabase.from('message_templates').update(payload).eq('id',editingId).eq('organization_id',organization.id))
    } else {
      ({error}=await supabase.from('message_templates').insert({...payload,organization_id:organization.id,is_active:true}))
    }

    if (error) setMessage(error.message)
    else {
      setMessage(editingId ? 'Modelo atualizado.' : 'Modelo criado.')
      setShowForm(false)
      resetForm()
      await loadData()
    }
    setLoading(false)
  }

  async function toggleActive(t) {
    const {error}=await supabase.from('message_templates').update({is_active:!t.is_active}).eq('id',t.id).eq('organization_id',organization.id)
    if(!error) await loadData()
  }

  async function deleteTemplate(t) {
    const { error } = await softDeleteRow('message_templates', t.id, organization.id, { is_active: false })
    if (error) setMessage(error.message)
    else {
      setMessage('Mensagem arquivada.')
      await loadData()
    }
  }

  const selectedTarget = segments.find(s=>s.id===form.target_segment_id)
  const preview = {
    business_name:'Empresa Exemplo',
    city:'Campinas',
    state:'SP',
    phone:'(19) 99999-9999',
    segment:selectedTarget?.name || 'Público-alvo'
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">ABORDAGEM</span>
          <h1>Mensagens</h1>
          <p className="muted">Crie mensagens específicas para cada público-alvo.</p>
        </div>
        <div className="topbar-actions">
          <div className="user-badge">{userEmail}</div>
          <button className="primary inline-btn" onClick={()=>{resetForm();setShowForm(!showForm)}} disabled={!segments.length}>
            <Plus size={17}/> Novo modelo
          </button>
        </div>
      </header>

      {!segments.length && <div className="notice">Crie um público-alvo antes de criar modelos de mensagem.</div>}

      {showForm && (
        <section className="panel campaign-form-panel">
          <span className="eyebrow">{editingId?'EDITAR MODELO':'NOVO MODELO'}</span>
          <h2>{editingId?'Atualizar mensagem':'Criar mensagem'}</h2>
          <form onSubmit={saveTemplate} className="campaign-form">
            <div className="field-grid">
              <label>Nome do modelo<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex.: Primeira abordagem" required/></label>
              <label>Público-alvo
                <select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})} required>
                  {segments.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={Boolean(form.is_default_for_target)}
                onChange={e=>setForm({...form,is_default_for_target:e.target.checked})}
              />
              Usar como mensagem padrão deste público-alvo
            </label>
            <label>Mensagem<textarea className="message-textarea" rows="7" value={form.body} onChange={e=>setForm({...form,body:e.target.value})} required/></label>
            <div className="variable-help">
              <strong>Variáveis:</strong>
              <span>{'{empresa}'}</span><span>{'{cidade}'}</span><span>{'{uf}'}</span><span>{'{telefone}'}</span><span>{'{segmento}'}</span>
            </div>
            <div className="message-preview"><span>Pré-visualização</span><p>{renderTemplate(form.body,preview)}</p></div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={()=>{setShowForm(false);resetForm()}}>Cancelar</button>
              <button className="primary" disabled={loading}>{loading?'Salvando...':'Salvar modelo'}</button>
            </div>
          </form>
        </section>
      )}

      {message && <div className="notice">{message}</div>}

      <section className="campaign-list">
        {templates.length===0 ? (
          <article className="panel empty-state"><MessageSquareText size={34}/><h2>Nenhum modelo criado</h2><p>Crie mensagens específicas para seus públicos-alvo.</p></article>
        ) : templates.map(t=>(
          <article className="panel message-card" key={t.id}>
            <div className="message-card-main">
              <span className="eyebrow">{t.target_segments?.name || t.segment}</span>
              <h2>{t.name} {t.is_default_for_target && <span className="inline-default-badge">Padrão</span>}</h2>
              <p>{t.body}</p>
            </div>
            <div className="message-card-actions">
              <span className={`template-status ${t.is_active?'active':'inactive'}`}>{t.is_active?'Ativo':'Inativo'}</span>
              <button className="secondary" onClick={()=>editTemplate(t)}>Editar</button>
              <button className="secondary" onClick={()=>toggleActive(t)}>{t.is_active?'Desativar':'Ativar'}</button>
              <button className="text-danger" onClick={()=>deleteTemplate(t)}><Trash2 size={14}/> Arquivar</button>
            </div>
          </article>
        ))}
      </section>
    </>
  )
}





function MessageSending({ organization, settings, userEmail }) {
  const [leads, setLeads] = useState([])
  const [templates, setTemplates] = useState([])
  const [queue, setQueue] = useState([])
  const [batches, setBatches] = useState([])
  const [whatsappNumbers, setWhatsappNumbers] = useState([])
  const disconnectAlertedRef = useRef(false)
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [showFailures, setShowFailures] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [scheduleClock, setScheduleClock] = useState(Date.now())
  const [sendConfig, setSendConfig] = useState({
    dailyLimit: Number(settings?.whatsapp_daily_send_limit || 20),
    intervalSeconds: Number(settings?.whatsapp_send_interval_seconds || 120),
    start: '08:00',
    end: '18:00',
    days: [1, 3, 5]
  })

  async function loadData() {
    const [leadResult, templateResult, queueResult, batchResult, settingsResult, whatsappResult] = await Promise.all([
      supabase
        .from('leads')
        .select('id,business_name,phone,status,target_segment_id,target_segments(name),campaigns(name),city,state')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .in('status', ['new','queued'])
        .order('created_at', { ascending: false }),
      supabase
        .from('message_templates')
        .select('id,target_segment_id,name,is_default_for_target')
        .eq('organization_id', organization.id)
        .eq('is_active', true),
      supabase
        .from('outbound_messages')
        .select('id,lead_id,batch_id,status,scheduled_for,queued_at,sent_at,error_message,created_at,leads(business_name)')
        .eq('organization_id', organization.id)
        .in('status', ['queued','ready','processing','failed'])
        .order('created_at', { ascending: false }),
      supabase
        .from('outbound_batches')
        .select('id,name,status,total_recipients,interval_seconds,created_at,paused_at,cancelled_at,sent_count,failed_count,whatsapp_number_id')
        .eq('organization_id', organization.id)
        .in('status', ['queued','paused','processing'])
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('organization_settings')
        .select('whatsapp_send_interval_seconds,whatsapp_daily_send_limit,allowed_send_start,allowed_send_end,default_cadence_days')
        .eq('organization_id', organization.id)
        .single(),
      supabase
        .from('whatsapp_numbers')
        .select('id,alias,connection_status,evolution_instance_name,is_active')
        .eq('organization_id', organization.id)
        .eq('is_active', true)
        .is('deleted_at', null)
    ])

    if (leadResult.error || templateResult.error || queueResult.error || batchResult.error || settingsResult.error || whatsappResult.error) {
      setMessage(
        leadResult.error?.message ||
        templateResult.error?.message ||
        queueResult.error?.message ||
        batchResult.error?.message ||
        settingsResult.error?.message ||
        whatsappResult.error?.message ||
        'Não foi possível carregar a página de envio.'
      )
      return
    }

    setLeads(leadResult.data || [])
    setTemplates(templateResult.data || [])
    setQueue(queueResult.data || [])
    setBatches(batchResult.data || [])
    setWhatsappNumbers(whatsappResult.data || [])
    const cfg = settingsResult.data || {}
    setSendConfig({
      dailyLimit: Number(cfg.whatsapp_daily_send_limit || 20),
      intervalSeconds: Number(cfg.whatsapp_send_interval_seconds || 120),
      start: String(cfg.allowed_send_start || '08:00').slice(0, 5),
      end: String(cfg.allowed_send_end || '18:00').slice(0, 5),
      days: Array.isArray(cfg.default_cadence_days) && cfg.default_cadence_days.length ? cfg.default_cadence_days.map(Number) : [1, 3, 5]
    })
  }

  useEffect(() => {
    let active = true
    async function refresh() {
      if (!active) return
      await loadData()
    }
    refresh()
    const timer = setInterval(refresh, 4000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [organization.id])

  useEffect(() => {
    const timer = setInterval(() => setScheduleClock(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const activeNumberIds = new Set(batches.map(batch => batch.whatsapp_number_id).filter(Boolean))
    const disconnected = whatsappNumbers.some(number =>
      activeNumberIds.has(number.id) &&
      ['disconnected','close','closed','logout'].includes(String(number.connection_status || '').toLowerCase())
    )

    if (disconnected && !disconnectAlertedRef.current) {
      disconnectAlertedRef.current = true
      window.alert('WhatsApp desconectado. Os envios foram pausados automaticamente. Reconecte o WhatsApp e clique em Reiniciar para continuar a campanha.')
    } else if (!disconnected) {
      disconnectAlertedRef.current = false
    }
  }, [batches, whatsappNumbers])

  const queuedLeadIds = new Set(
    queue
      .filter(item => ['queued','ready','processing'].includes(item.status))
      .map(item => item.lead_id)
  )

  const selectableLeads = leads.filter(lead =>
    !queuedLeadIds.has(lead.id) &&
    lead.status !== 'queued'
  )

  const allSelectableSelected = selectableLeads.length > 0 && selectableLeads.every(lead => selected.has(lead.id))

  function hhmmToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
    if (!match) return null
    return Number(match[1]) * 60 + Number(match[2])
  }

  const scheduleNow = new Date(scheduleClock)
  const weekdayToken = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short'
  }).format(scheduleNow)
  const weekdayNumber = ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[weekdayToken]
  const currentBrazilTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(scheduleNow)
  const currentMinutes = hhmmToMinutes(currentBrazilTime)
  const startMinutes = hhmmToMinutes(sendConfig.start)
  const endMinutes = hhmmToMinutes(sendConfig.end)
  const allowedToday = (sendConfig.days || []).map(Number).includes(weekdayNumber)
  const insideSendWindow = Boolean(
    allowedToday &&
    currentMinutes != null &&
    startMinutes != null &&
    endMinutes != null &&
    currentMinutes >= startMinutes &&
    currentMinutes <= endMinutes
  )
  const sendActionLabel = insideSendWindow ? 'Enviar mensagem' : 'Agendar mensagens'

  const sendDayNames = {
    0: 'Domingo',
    1: 'Segunda',
    2: 'Terça',
    3: 'Quarta',
    4: 'Quinta',
    5: 'Sexta',
    6: 'Sábado'
  }
  const sendDaysLabel = (sendConfig.days || [])
    .map(day => sendDayNames[Number(day)])
    .filter(Boolean)
    .join(', ') || 'Nenhum dia configurado'

  function toggleLead(id, checked) {
    setSelected(previous => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(checked) {
    setSelected(checked ? new Set(selectableLeads.map(lead => lead.id)) : new Set())
    setMessage('')
  }

  async function discardSelected() {
    if (!selected.size || loading) return

    const ids = leads
      .filter(lead => selected.has(lead.id) && !queuedLeadIds.has(lead.id) && lead.status !== 'queued')
      .map(lead => lead.id)

    if (!ids.length) {
      setMessage('Nenhum dos leads selecionados pode ser descartado enquanto estiver na fila de envio.')
      return
    }

    if (!window.confirm(`Descartar ${ids.length} captação(ões) selecionada(s)? Os registros serão preservados no banco e poderão ser recuperados em Leads sem interesse.`)) return

    setLoading(true)
    setMessage('')
    const { error } = await supabase
      .from('leads')
      .update({ status: 'discarded', updated_at: new Date().toISOString() })
      .eq('organization_id', organization.id)
      .is('deleted_at', null)
      .in('id', ids)

    if (error) {
      setMessage(error.message || 'Não foi possível descartar os leads selecionados.')
    } else {
      setMessage(`${ids.length} captação(ões) descartada(s). Os registros permanecem preservados no banco.`)
      setSelected(new Set())
      await loadData()
    }
    setLoading(false)
  }

  async function rescheduleBatchMessages(batchId, statuses) {
    const { data: pending, error } = await supabase
      .from('outbound_messages')
      .select('id,status,error_message')
      .eq('organization_id', organization.id)
      .eq('batch_id', batchId)
      .in('status', statuses)
      .order('created_at', { ascending: true })

    if (error) throw error

    const retryable = (pending || []).filter(item =>
      item.status !== 'failed' ||
      /connection closed|instance requires property "webhook"|whatsapp desconectado|envio pausado/i.test(String(item.error_message || ''))
    )
    const interval = Math.max(1, Number(batches.find(batch => batch.id === batchId)?.interval_seconds || sendConfig.intervalSeconds || 120))
    const now = Date.now()

    for (let index = 0; index < retryable.length; index += 1) {
      const item = retryable[index]
      const { error: updateError } = await supabase
        .from('outbound_messages')
        .update({
          status: 'queued',
          error_message: null,
          cancelled_at: null,
          scheduled_for: new Date(now + index * interval * 1000).toISOString()
        })
        .eq('organization_id', organization.id)
        .eq('id', item.id)

      if (updateError) throw updateError
    }
  }

  async function controlBatch(batch, action) {
    if (!batch?.id || loading) return

    if (action === 'cancel' && !window.confirm('Cancelar este envio? As mensagens que ainda não foram enviadas serão interrompidas. Uma mensagem que já esteja sendo processada pode ser concluída.')) {
      return
    }

    setLoading(true)
    setMessage('')

    const optimisticStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'queued' : 'cancelled'
    const optimisticPausedAt = action === 'pause' ? new Date().toISOString() : null

    setBatches(previous => previous.map(item =>
      item.id === batch.id
        ? { ...item, status: optimisticStatus, paused_at: optimisticPausedAt }
        : item
    ))

    try {
      const { data, error } = await supabase.rpc('control_whatsapp_batch', {
        p_batch_id: batch.id,
        p_action: action
      })

      if (error) throw error

      const persisted = Array.isArray(data) ? data[0] : data
      if (!persisted?.batch_status) throw new Error('O sistema não confirmou a alteração do envio.')

      setBatches(previous => previous.map(item =>
        item.id === batch.id
          ? { ...item, status: persisted.batch_status, paused_at: persisted.paused_at || null }
          : item
      ))

      setMessage(
        action === 'pause'
          ? 'Envio pausado. Clique em Reiniciar para continuar.'
          : action === 'resume'
            ? ''
            : 'Envio cancelado. As mensagens pendentes não serão enviadas.'
      )

      await loadData()
    } catch (error) {
      await loadData()
      setMessage(error?.message || 'Não foi possível atualizar o envio.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshSendingData() {
    if (refreshing) return
    setRefreshing(true)
    setMessage('')
    try {
      await loadData()
      setScheduleClock(Date.now())
    } finally {
      setRefreshing(false)
    }
  }

  async function send() {
    if (!selected.size || loading) return

    const selectedLeads = leads.filter(lead => selected.has(lead.id))
    const eligibleIds = selectedLeads
      .filter(lead =>
        !queuedLeadIds.has(lead.id) &&
        lead.status !== 'queued' &&
        Boolean(normalizeWhatsAppNumber(lead.phone)) &&
        templates.some(template => template.target_segment_id === lead.target_segment_id)
      )
      .map(lead => lead.id)

    const ignored = selected.size - eligibleIds.length
    if (!eligibleIds.length) {
      setMessage('Nenhum lead selecionado possui todos os dados necessários para o envio. Verifique telefone e mensagem cadastrada para o público-alvo.')
      return
    }

    setLoading(true)
    setMessage('')
    const { data, error } = await supabase.functions.invoke('enqueue_whatsapp_messages', {
      body: { organization_id: organization.id, lead_ids: eligibleIds }
    })

    if (error || data?.error) {
      setMessage(data?.error || error?.message || 'Não foi possível criar a fila de mensagens.')
    } else {
      const firstScheduled = data?.first_scheduled_for ? new Date(data.first_scheduled_for) : null
      const lastScheduled = data?.last_scheduled_for ? new Date(data.last_scheduled_for) : null
      const first = firstScheduled ? firstScheduled.toLocaleString('pt-BR') : '—'
      const last = lastScheduled ? lastScheduled.toLocaleString('pt-BR') : '—'
      const immediate = Boolean(
        insideSendWindow &&
        firstScheduled &&
        firstScheduled.getTime() <= Date.now() + 90000
      )
      const ignoredText = ignored > 0 ? ` ${ignored} lead(s) não foram incluídos por falta de telefone ou mensagem cadastrada para o público-alvo.` : ''
      setMessage(
        immediate
          ? `${data?.queued || 0} mensagem(ns) encaminhada(s) para envio. O processamento é automático.${ignoredText}`
          : `${data?.queued || 0} mensagem(ns) agendada(s). Primeiro envio: ${first}. Último envio: ${last}.${ignoredText}`
      )
      setSelected(new Set())
      await loadData()
    }
    setLoading(false)
  }

  const failedMessages = queue.filter(item => item.status === 'failed')
  const activeSentCount = batches.reduce((sum, batch) => sum + Number(batch.sent_count || 0), 0)

  if (showFailures) {
    return (
      <>
        <header className="topbar compact-subpage-header">
          <div>
            <button type="button" className="client-back" onClick={() => setShowFailures(false)}>
              ← Voltar para Enviar Mensagens
            </button>
            <span className="eyebrow">CAMPANHAS</span>
            <h1>Falhas de envio</h1>
            <p className="muted">Mensagens que não puderam ser enviadas e o erro apresentado pelo sistema.</p>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary inline-btn" onClick={refreshSendingData} disabled={refreshing}>
              <RefreshCw size={16}/>{refreshing ? 'Atualizando...' : 'Atualizar'}
            </button>
            <div className="user-badge">{userEmail}</div>
          </div>
        </header>

        <section className="panel">
          {failedMessages.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={30}/>
              <h2>Nenhuma falha de envio</h2>
              <p>Não há mensagens com erro no momento.</p>
            </div>
          ) : (
            <div className="admin-table">
              <div className="admin-table-row head">
                <span>Cliente</span>
                <span>Erro apresentado</span>
                <span>Data</span>
              </div>
              {failedMessages.map(item => (
                <div className="admin-table-row" key={item.id}>
                  <span><strong>{item.leads?.business_name || 'Cliente não identificado'}</strong></span>
                  <span>{item.error_message || 'Falha de envio sem detalhe informado pelo provedor.'}</span>
                  <span>{formatDateTime(item.created_at || item.scheduled_for)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </>
    )
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">CAMPANHAS</span>
          <h1>Envio</h1>
          <p className="muted">Selecione quantos leads quiser. O CRM distribui automaticamente os envios pelos dias e horários configurados.</p>
        </div>
        <div className="topbar-actions">
          <button type="button" className="secondary inline-btn" onClick={refreshSendingData} disabled={refreshing}>
            <RefreshCw size={16}/>{refreshing ? 'Atualizando...' : 'Atualizar'}
          </button>
          <div className="user-badge">{userEmail}</div>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="panel whatsapp-schedule-v43 schedule-readonly-v63">
        <div>
          <span className="eyebrow">PROGRAMAÇÃO AUTOMÁTICA</span>
          <h2>Janela de envio</h2>
          <p className="muted">{sendDaysLabel} • até {sendConfig.dailyLimit} mensagens por dia • intervalo de {sendConfig.intervalSeconds} segundos.</p>
        </div>
        <div className="schedule-readonly-fields-v63" aria-label="Horário definido pelo administrador">
          <div>
            <span>Início</span>
            <strong>{sendConfig.start}</strong>
          </div>
          <div>
            <span>Fim</span>
            <strong>{sendConfig.end}</strong>
          </div>
        </div>
      </section>

      <section className="panel sending-toolbar">
        <label className="select-all">
          <input type="checkbox" checked={allSelectableSelected} onChange={event => toggleAll(event.target.checked)} />
          Selecionar todos
        </label>
        <span>{selected.size} selecionado(s)</span>
        <div className="sending-bulk-actions-v52">
          <button type="button" className="secondary danger inline-btn" onClick={discardSelected} disabled={!selected.size || loading}>
            <Trash2 size={16}/>Descartar selecionados
          </button>
          <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}>
            <Send size={16}/>{loading ? 'Processando...' : sendActionLabel}
          </button>
        </div>
      </section>

      <section className="panel queue-summary-v32">
        <div><strong>{queue.filter(item => ['queued','ready','processing'].includes(item.status)).length}</strong><span>Na fila</span></div>
        <div><strong>{activeSentCount}</strong><span>Enviadas</span></div>
        <div><strong>{failedMessages.length}</strong><span>Falhas</span></div>
        <div>
          <button type="button" className="secondary inline-btn" onClick={() => setShowFailures(true)}>
            <XCircle size={16}/> Ver falhas
          </button>
        </div>
      </section>

      {batches.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">CONTROLE DE ENVIO</span>
              <h2>Envios em andamento</h2>
              <p className="muted">Pause temporariamente ou cancele as mensagens que ainda não foram enviadas.</p>
            </div>
          </div>
          <div className="admin-list">
            {batches.map(batch => {
              const pendingCount = queue.filter(item =>
                item.batch_id === batch.id && ['queued', 'ready', 'processing'].includes(item.status)
              ).length

              return (
                <div className="admin-list-row" key={batch.id}>
                  <div>
                    <strong>{batch.name || 'Envio de WhatsApp'}</strong>
                    <span>{pendingCount} mensagem(ns) pendente(s) • criado em {formatDateTime(batch.created_at)}</span>
                    <small>{batch.status === 'paused' ? 'Pausado' : 'Em andamento'}</small>
                  </div>
                  <div className="row-actions">
                    {batch.status === 'paused' ? (
                      <button type="button" className="secondary mini" onClick={() => controlBatch(batch, 'resume')} disabled={loading}>
                        <Play size={14}/> Reiniciar
                      </button>
                    ) : (
                      <button type="button" className="secondary mini" onClick={() => controlBatch(batch, 'pause')} disabled={loading}>
                        <Pause size={14}/> Pausar
                      </button>
                    )}
                    <button type="button" className="text-danger mini" onClick={() => controlBatch(batch, 'cancel')} disabled={loading}>
                      <XCircle size={14}/> Cancelar envio
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="sending-list">
        {leads.length === 0 ? (
          <article className="panel empty-state"><Send size={30}/><h2>Nenhum lead disponível para envio</h2></article>
        ) : leads.map(lead => {
          const hasPhone = Boolean(normalizeWhatsAppNumber(lead.phone))
          const hasTemplate = templates.some(template => template.target_segment_id === lead.target_segment_id)
          const isQueued = lead.status === 'queued' || queuedLeadIds.has(lead.id)
          const canSend = !isQueued && hasPhone && hasTemplate
          const canSelect = !isQueued
          return (
            <article className="panel sending-row" key={lead.id}>
              <input type="checkbox" checked={selected.has(lead.id)} onChange={event => toggleLead(lead.id, event.target.checked)} disabled={!canSelect} aria-label={`Selecionar ${lead.business_name}`} />
              <div><strong>{lead.business_name}</strong><span>{lead.campaigns?.name || lead.target_segments?.name || 'Sem campanha'}</span></div>
              <span>{lead.city || '—'}{lead.state ? `/${lead.state}` : ''}</span>
              <span>{lead.phone || 'Sem telefone'}</span>
              <span className={isQueued ? 'template-status queued' : canSend ? 'template-status active' : 'template-status inactive'}>
                {isQueued ? 'Na fila' : canSend ? 'Apto' : !hasPhone ? 'Sem telefone' : 'Sem mensagem'}
              </span>
            </article>
          )
        })}
      </section>
    </>
  )
}

function CampaignWorkspace({ organization, settings, userEmail }) {
  const [section, setSection] = useState('targets')
  const items = [
    ['targets','Público-alvo'],
    ['campaigns','Campanha'],
    ['capture','Captação'],
    ['messages','Mensagens'],
    ['sending','Enviar Mensagens'],
    ['email','E-mail marketing'],
    ['whatsapp','WhatsApp']
  ]

  return (
    <>
      <div className="workspace-tabs">
        {items.map(([key,label]) => (
          <button key={key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>
            {label}
          </button>
        ))}
      </div>
      {section === 'targets' && <TargetSegments organization={organization} userEmail={userEmail} />}
      {section === 'campaigns' && settings?.feature_flags?.campaigns !== false && <Campaigns organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'capture' && settings?.feature_flags?.capture !== false && <Capture organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'sending' && <MessageSending organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'messages' && settings?.feature_flags?.messages !== false && <Messages organization={organization} userEmail={userEmail} />}
      {section === 'email' && <EmailMarketing organization={organization} userEmail={userEmail} />}
      {section === 'whatsapp' && <AdminWhatsApp organizations={[organization]} userEmail={userEmail} userMode={true} />}
    </>
  )
}

function ManualLeadRegistration({ organization, settings, userEmail, userId }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [targetSegments, setTargetSegments] = useState([])
  const [capturerName, setCapturerName] = useState('')
  const [form, setForm] = useState({
    business_name: '',
    phone: '',
    website: '',
    email: '',
    address: '',
    city: settings?.default_city || 'Campinas',
    state: settings?.default_state || 'SP',
    contact_name: '',
    capture_notes: '',
    target_segment_id: '',
    customer_origin: ''
  })

  useEffect(() => {
    let active = true
    supabase
      .from('target_segments')
      .select('id,name')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (active) setTargetSegments(data || [])
      })
    return () => { active = false }
  }, [organization.id])

  useEffect(() => {
    let active = true
    if (!userId) return undefined
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setCapturerName(data?.full_name || '')
      })
    return () => { active = false }
  }, [userId])

  async function saveLead(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const selectedTarget = targetSegments.find(item => item.id === form.target_segment_id)

    const { error } = await supabase.from('leads').insert({
      organization_id: organization.id,
      segment: selectedTarget?.name || 'Cadastro manual',
      target_segment_id: form.target_segment_id || null,
      customer_origin: form.customer_origin || null,
      business_name: form.business_name.trim(),
      phone: form.phone.trim() || null,
      website: form.website.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state || null,
      contact_name: form.contact_name.trim() || null,
      capture_notes: form.capture_notes.trim() || null,
      captured_by: userId,
      status: 'new',
      source: 'manual'
    })

    if (error) setMessage(error.message)
    else {
      setMessage('Lead cadastrado com sucesso na etapa Novo.')
      setForm(old => ({
        ...old,
        business_name: '',
        phone: '',
        website: '',
        email: '',
        address: '',
        contact_name: '',
        capture_notes: '',
        target_segment_id: '',
        customer_origin: ''
      }))
    }
    setLoading(false)
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">FUNIL DE VENDAS</span>
          <h1>Cadastro novo lead</h1>
          <p className="muted">Cadastre o lead manualmente. O público-alvo é opcional e permite usar a mensagem automática correspondente.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="panel campaign-form-panel">
        <span className="eyebrow">NOVO LEAD</span>
        <h2>Cadastro manual</h2>
        <p className="muted capture-audit-note-v49">
          Captado por: <strong>{capturerName || userEmail}</strong> • entrada automática na etapa Novo.
        </p>

        <form onSubmit={saveLead} className="campaign-form">
          <div className="field-grid">
            <label>Empresa<input value={form.business_name} onChange={e=>setForm({...form,business_name:e.target.value})} required /></label>
            <label>Nome do contato<input value={form.contact_name} onChange={e=>setForm({...form,contact_name:e.target.value})} /></label>
          </div>
          <div className="field-grid">
            <label>Telefone / WhatsApp<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></label>
            <label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></label>
          </div>
          <div className="field-grid manual-target-origin-v68">
            <label>
              <span className="field-label-inline-v68">
                <span>Público-alvo</span>
                <span className="muted">(opcional)</span>
              </span>
              <select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})}>
                <option value="">Não informar</option>
                {targetSegments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
              </select>
            </label>
            <label>
              Origem
              <select value={form.customer_origin} onChange={e=>setForm({...form,customer_origin:e.target.value})}>
                <option value="">Não informado</option>
                <option value="CRM">CRM</option>
                <option value="Prospecção vendedor">Prospecção vendedor</option>
                <option value="WhatsApp">WhatsApp</option>
                <option value="E-mail marketing">E-mail marketing</option>
                <option value="Redes sociais">Redes sociais</option>
                <option value="Google">Google</option>
                <option value="Recomendação">Recomendação</option>
                <option value="Base">Base</option>
                <option value="Captação ativa">Captação ativa</option>
                <option value="Outro">Outro</option>
              </select>
            </label>
          </div>
          <label>Site<input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} /></label>
          <label>Endereço<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} /></label>
          <div className="field-grid">
            <label>Cidade<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} /></label>
            <label>UF<select value={form.state} onChange={e=>setForm({...form,state:e.target.value})}>{UF_OPTIONS.map(uf=><option key={uf} value={uf}>{uf}</option>)}</select></label>
          </div>
          <label>
            Observações da captação
            <textarea
              className="client-textarea"
              value={form.capture_notes}
              onChange={e=>setForm({...form,capture_notes:e.target.value})}
              placeholder="Ex.: produto de interesse, data/contexto da captação e outras informações relevantes."
            />
          </label>
          <div className="form-actions"><button className="primary" disabled={loading}>{loading?'Salvando...':'Salvar lead'}</button></div>
        </form>
      </section>
    </>
  )
}


function NotInterestedRepository({ organization, userEmail }) {
  const [leads, setLeads] = useState([])
  const [message, setMessage] = useState('')

  async function loadData() {
    const { data, error } = await supabase
      .from('leads')
      .select('id,business_name,phone,city,state,status,commercial_notes,campaigns(name)')
      .eq('organization_id', organization.id)
      .in('status', ['not_interested','discarded','lost'])
      .order('updated_at', { ascending: false })

    if (error) setMessage(error.message)
    else setLeads(data || [])
  }

  useEffect(() => { loadData() }, [organization.id])

  async function returnToFunnel(lead) {
    if (!window.confirm(`Retornar "${lead.business_name}" ao funil como Novo?`)) return

    const { error } = await supabase
      .from('leads')
      .update({ status: 'new', updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('organization_id', organization.id)

    if (error) setMessage(error.message)
    else {
      setMessage(`${lead.business_name} retornou ao funil como Novo.`)
      await loadData()
    }
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">FUNIL DE VENDAS</span>
          <h1>Leads sem interesse</h1>
          <p className="muted">Leads sem interesse, descartados e negócios perdidos ficam registrados nesta área e podem ser recuperados.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="repository-list-v33">
        {leads.length === 0 ? (
          <article className="panel empty-state">
            <Users size={34}/>
            <h2>Nenhum lead nesta área</h2>
            <p>Leads marcados como Sem interesse, Descartado ou Perdido aparecerão aqui.</p>
          </article>
        ) : leads.map(lead => (
          <article className="panel repository-row-v33" key={lead.id}>
            <div className="repository-main-v33">
              <div className="repository-title-v33">
                <strong>{lead.business_name}</strong>
                <span className={`repository-status-v33 ${lead.status === 'discarded' ? 'discarded' : lead.status === 'lost' ? 'lost' : 'not-interested'}`}>
                  {lead.status === 'discarded' ? 'Descartado' : lead.status === 'lost' ? 'Perdido' : 'Sem interesse'}
                </span>
              </div>
              <span>{lead.campaigns?.name || 'Sem campanha'} • {lead.city || '—'}{lead.state ? ` / ${lead.state}` : ''} • {lead.phone || 'Sem telefone'}</span>
              <div className="repository-note-v33">
                <span>Observações</span>
                <p>{lead.commercial_notes || 'Nenhuma observação registrada.'}</p>
              </div>
            </div>
            <button className="secondary" onClick={() => returnToFunnel(lead)}>Retornar ao funil</button>
          </article>
        ))}
      </section>
    </>
  )
}


function ClosedLeads({ organization, userEmail }) {
  const [rows, setRows] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [targetSegments, setTargetSegments] = useState([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(100)
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState({
    search: '',
    status: 'all',
    segment: 'all',
    campaign: 'all',
    from: '',
    to: ''
  })

  async function loadLookups() {
    const [{ data: campaignData }, { data: targetData }] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id,name')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('target_segments')
        .select('id,name')
        .eq('organization_id', organization.id)
        .order('name')
    ])

    setCampaigns(campaignData || [])
    setTargetSegments(targetData || [])
  }

  async function getVisibleTerminalIds() {
    const statuses = ['lost', 'not_interested']
    const groups = await Promise.all(statuses.map(async status => {
      const { data, error } = await supabase
        .from('leads')
        .select('id')
        .eq('organization_id', organization.id)
        .eq('status', status)
        .is('deleted_at', null)
        .order('status_changed_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50)

      if (error) throw error
      return data || []
    }))

    return groups.flat().map(item => item.id)
  }

  async function loadClosed(requestedLimit = limit, currentFilter = filter) {
    setMessage('')
    try {
      const visibleIds = await getVisibleTerminalIds()

      let query = supabase
        .from('leads')
        .select('id,business_name,phone,city,state,status,target_segment_id,campaign_id,contact_name,proposal_value,renegotiated_value,contract_value,status_changed_at,campaigns(name),target_segments(name)', { count: 'exact' })
        .eq('organization_id', organization.id)
        .in('status', ['lost', 'not_interested'])
        .is('deleted_at', null)

      if (visibleIds.length) {
        query = query.not('id', 'in', `(${visibleIds.join(',')})`)
      }

      if (currentFilter.status !== 'all') query = query.eq('status', currentFilter.status)
      if (currentFilter.segment !== 'all') query = query.eq('target_segment_id', currentFilter.segment)
      if (currentFilter.campaign !== 'all') query = query.eq('campaign_id', currentFilter.campaign)
      if (currentFilter.from) query = query.gte('status_changed_at', `${currentFilter.from}T00:00:00`)
      if (currentFilter.to) query = query.lte('status_changed_at', `${currentFilter.to}T23:59:59.999`)

      const safeSearch = currentFilter.search.trim().replace(/[,%()]/g, ' ')
      if (safeSearch) {
        query = query.or(`business_name.ilike.%${safeSearch}%,city.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`)
      }

      const { data, error, count } = await query
        .order('status_changed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(0, Math.max(requestedLimit - 1, 0))

      if (error) throw error
      setRows(data || [])
      setTotal(Number(count || 0))
    } catch (error) {
      setRows([])
      setTotal(0)
      setMessage(`Não foi possível carregar os encerrados: ${error.message}`)
    }
  }

  useEffect(() => {
    loadLookups()
  }, [organization.id])

  useEffect(() => {
    let active = true
    setLimit(100)
    const timer = setTimeout(async () => {
      if (!active) return
      await loadClosed(100, filter)
    }, 250)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [organization.id, filter.search, filter.status, filter.segment, filter.campaign, filter.from, filter.to])

  async function loadMore() {
    const next = limit + 100
    setLimit(next)
    await loadClosed(next, filter)
  }

  const statusName = status => status === 'lost' ? 'Perdido' : 'Sem interesse'

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">HISTÓRICO COMERCIAL</span>
          <h1>Encerrados</h1>
          <p className="muted">Negócios Perdidos e Sem interesse que ultrapassaram os 50 mais recentes de cada coluna do Kanban.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="panel leads-toolbar">
        <div className="search-box">
          <Search size={17}/>
          <input
            value={filter.search}
            onChange={e => setFilter({ ...filter, search: e.target.value })}
            placeholder="Buscar empresa, cidade ou telefone"
          />
        </div>
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="all">Todos os encerrados</option>
          <option value="lost">Perdido</option>
          <option value="not_interested">Sem interesse</option>
        </select>
        <select value={filter.segment} onChange={e => setFilter({ ...filter, segment: e.target.value })}>
          <option value="all">Todos os públicos</option>
          {targetSegments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </section>

      <section className="panel">
        <div className="field-grid three">
          <label>
            Campanha
            <select value={filter.campaign} onChange={e => setFilter({ ...filter, campaign: e.target.value })}>
              <option value="all">Todas as campanhas</option>
              {campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Encerrado a partir de
            <input type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} />
          </label>
          <label>
            Encerrado até
            <input type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="panel admin-search-panel compact-search-panel">
        <span className="admin-result-count"><strong>{total}</strong> registro{total === 1 ? '' : 's'} encerrado{total === 1 ? '' : 's'}</span>
      </section>

      <section className="compact-admin-list">
        {rows.length === 0 ? (
          <article className="panel empty-state compact-empty">
            <CheckCircle2 size={26}/>
            <h2>Nenhum registro encerrado</h2>
            <p>Enquanto houver até 50 Perdidos e 50 Sem interesse, eles permanecem somente no Kanban.</p>
          </article>
        ) : rows.map(item => {
          const value = item.contract_value ?? item.renegotiated_value ?? item.proposal_value
          return (
            <article className="panel compact-admin-row" key={item.id}>
              <div className="compact-admin-main">
                <div className="compact-admin-title-line">
                  <span className="compact-status inactive">{statusName(item.status)}</span>
                  <strong>{item.business_name}</strong>
                </div>
                <p>
                  {item.target_segments?.name || 'Sem público definido'}
                  {item.city ? ` • ${item.city}${item.state ? `/${item.state}` : ''}` : ''}
                  {item.contact_name ? ` • ${item.contact_name}` : ''}
                </p>
                <div className="compact-term-line">
                  {item.campaigns?.name && <span>{item.campaigns.name}</span>}
                  {item.phone && <span>{item.phone}</span>}
                  {value != null && <em>{formatCurrency(value)}</em>}
                  <em>Encerrado em {formatDateTime(item.status_changed_at)}</em>
                </div>
              </div>
            </article>
          )
        })}
      </section>

      {rows.length < total && (
        <div className="form-actions">
          <button className="secondary" onClick={loadMore}>Carregar mais 100</button>
        </div>
      )}
    </>
  )
}

function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {
  const [section, setSection] = useState('leads')
  const [leadSection, setLeadSection] = useState('funnel')

  return (
    <>
      <div className="workspace-tabs">
        <button className={section === 'leads' ? 'active' : ''} onClick={() => setSection('leads')}>Leads</button>
        <button className={section === 'clients' ? 'active' : ''} onClick={() => setSection('clients')}>Clientes</button>
        <button className={section === 'closed' ? 'active' : ''} onClick={() => setSection('closed')}>Encerrados</button>
      </div>

      {section === 'leads' && (
        <>
          <div className="workspace-tabs workspace-subtabs">
            <button className={leadSection === 'funnel' ? 'active' : ''} onClick={() => setLeadSection('funnel')}>Funil</button>
            <button className={leadSection === 'new-lead' ? 'active' : ''} onClick={() => setLeadSection('new-lead')}>Cadastro novo lead</button>
            <button className={leadSection === 'repository' ? 'active' : ''} onClick={() => setLeadSection('repository')}>Leads sem interesse</button>
          </div>
          {leadSection === 'funnel' && <Leads organization={organization} settings={settings} userEmail={userEmail} />}
          {leadSection === 'new-lead' && <ManualLeadRegistration organization={organization} settings={settings} userEmail={userEmail} userId={userId} />}
          {leadSection === 'repository' && <NotInterestedRepository organization={organization} userEmail={userEmail} />}
        </>
      )}

      {section === 'clients' && <Clients organization={organization} userEmail={userEmail} userId={userId} />}
      {section === 'closed' && <ClosedLeads organization={organization} userEmail={userEmail} />}
    </>
  )
}


function isOverdueReturn(lead) {
  const today = currentBrazilDate()
  if (!lead?.next_contact_date || lead.next_contact_date >= today) return false
  if (['won','lost','not_interested','discarded'].includes(lead.status)) return false
  if (lead.last_contact_date && lead.last_contact_date >= lead.next_contact_date) return false
  return true
}

function overdueDays(dateValue) {
  if (!dateValue) return 0
  const today = currentBrazilDate()
  const start = new Date(`${dateValue}T12:00:00`)
  const end = new Date(`${today}T12:00:00`)
  return Math.max(0, Math.floor((end - start) / 86400000))
}

function OverdueReturnsNavItem({ organization, active, onOpen }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let mounted = true
    async function refresh() {
      const { data } = await supabase
        .from('leads')
        .select('id,status,next_contact_date,last_contact_date')
        .eq('organization_id', organization.id)
        .lt('next_contact_date', currentBrazilDate())
      if (mounted) setCount((data || []).filter(isOverdueReturn).length)
    }
    refresh()
    const timer = setInterval(refresh, 30000)
    return () => { mounted = false; clearInterval(timer) }
  }, [organization.id])

  return (
    <button className={`nav-item overdue-nav-v45 ${active ? 'active' : ''}`} onClick={onOpen}>
      <span className="overdue-calendar-icon-v45">
        <CalendarDays size={18}/>
        {count > 0 && <strong>{count > 99 ? '99+' : count}</strong>}
      </span>
      Retornos atrasados
    </button>
  )
}

function OverdueReturnsAlert({ organization, onOpen, userId }) {
  const [count, setCount] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let mounted = true
    async function check() {
      if (!userId) return
      const key = `crm_overdue_login_alert_${userId}_${organization.id}`
      if (sessionStorage.getItem(key)) return
      const { data } = await supabase
        .from('leads')
        .select('id,status,next_contact_date,last_contact_date')
        .eq('organization_id', organization.id)
        .lt('next_contact_date', currentBrazilDate())
      const total = (data || []).filter(isOverdueReturn).length
      if (!mounted || !total) return
      sessionStorage.setItem(key, '1')
      setCount(total)
      setVisible(true)
    }
    check()
    return () => { mounted = false }
  }, [organization.id, userId])

  if (!visible) return null

  return (
    <aside className="overdue-alert-v45" role="status">
      <button className="overdue-alert-close-v45" onClick={() => setVisible(false)} aria-label="Fechar aviso">×</button>
      <div className="overdue-alert-icon-v45"><CalendarDays size={22}/><strong>{count > 99 ? '99+' : count}</strong></div>
      <div>
        <strong>{count === 1 ? '1 retorno atrasado' : `${count} retornos atrasados`}</strong>
        <span>Há contatos que precisam de acompanhamento.</span>
      </div>
      <button className="primary inline-btn" onClick={() => { setVisible(false); onOpen() }}>Ver retornos</button>
    </aside>
  )
}

function OverdueReturnsPage({ organization, userEmail, onOpenLead }) {
  const [leads, setLeads] = useState([])
  const [message, setMessage] = useState('')

  const statusNames = {
    new: 'Novo', qualified: 'Qualificado', queued: 'Na fila', contacted: 'Contatado',
    replied: 'Respondeu', interested: 'Interessado', proposal: 'Proposta'
  }

  async function loadData() {
    const { data, error } = await supabase
      .from('leads')
      .select('id,business_name,contact_name,phone,status,next_contact_date,last_contact_date,city,state,target_segments(name),campaigns(name)')
      .eq('organization_id', organization.id)
      .lt('next_contact_date', currentBrazilDate())
      .order('next_contact_date', { ascending: true })

    if (error) setMessage(error.message)
    else {
      setMessage('')
      setLeads((data || []).filter(isOverdueReturn))
    }
  }

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 15000)
    return () => clearInterval(timer)
  }, [organization.id])

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">ACOMPANHAMENTO</span>
          <h1>Retornos atrasados</h1>
          <p className="muted">Esta lista não retira o lead do funil. Ela funciona como uma fila de acompanhamento dos contatos vencidos.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="overdue-list-v45">
        {leads.length === 0 ? (
          <article className="panel empty-state">
            <CalendarDays size={34}/>
            <h2>Nenhum retorno atrasado</h2>
            <p>Quando um próximo contato vencer sem atendimento, ele aparecerá aqui automaticamente.</p>
          </article>
        ) : leads.map(lead => (
          <article className="panel overdue-row-v45" key={lead.id}>
            <div className="overdue-company-v45">
              <strong>{lead.business_name}</strong>
              <span>{lead.campaigns?.name || lead.target_segments?.name || 'Sem campanha'}</span>
            </div>
            <div><span>Contato</span><strong>{lead.contact_name || 'Não informado'}</strong></div>
            <div><span>Telefone / WhatsApp</span><strong>{lead.phone || 'Não informado'}</strong></div>
            <div><span>Retorno previsto</span><strong>{lead.next_contact_date ? new Date(`${lead.next_contact_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</strong></div>
            <div><span>Atraso</span><strong className="overdue-days-v45">{overdueDays(lead.next_contact_date)} dia(s)</strong></div>
            <div><span>Etapa do funil</span><strong>{statusNames[lead.status] || lead.status}</strong></div>
            <button className="secondary inline-btn" onClick={() => onOpenLead(lead)}>Abrir lead <ChevronRight size={16}/></button>
          </article>
        ))}
      </section>
    </>
  )
}

function PlatformSalesOverview({ userEmail }) {
  const [companies, setCompanies] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [team, setTeam] = useState([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const { data, error } = await supabase.rpc('get_platform_sales_overview')
      if (!active) return
      if (error) setMessage(error.message)
      else {
        setCompanies(data || [])
        setMessage('')
      }
    }
    load()
    const timer = setInterval(load, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setTeam([])
      return undefined
    }
    let active = true
    supabase.rpc('get_team_performance', { p_organization_id: selectedId }).then(({ data, error }) => {
      if (!active) return
      if (error) setMessage(error.message)
      else {
        setTeam(data || [])
        setMessage('')
      }
    })
    return () => { active = false }
  }, [selectedId])

  const totalValue = companies.reduce((sum, row) => sum + Number(row.won_value || 0), 0)
  const totalWon = companies.reduce((sum, row) => sum + Number(row.won_count || 0), 0)
  const totalActive = companies.reduce((sum, row) => sum + Number(row.active_leads || 0), 0)
  const selected = companies.find(row => row.organization_id === selectedId)

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO DO SISTEMA</span>
          <h1>Informações de vendas</h1>
          <p className="muted">Visão consolidada da plataforma, mantendo cada empresa separada.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="stats-grid dashboard-commercial-grid platform-sales-total-v49">
        <StatCard label="Leads em trabalho" value={totalActive} detail="Consolidado de todas as empresas" />
        <StatCard label="Negócios fechados" value={totalWon} detail="Consolidado de todas as empresas" />
        <StatCard label="Valor total fechado" value={formatCurrency(totalValue)} detail="Consolidado de todas as empresas" />
      </section>

      <section className="panel platform-company-list-v49">
        <div className="panel-head"><div><span className="eyebrow">EMPRESAS</span><h2>Resultados por empresa</h2></div></div>
        <div className="company-performance-list-v49">
          {companies.map(company => (
            <button
              key={company.organization_id}
              type="button"
              className={`company-performance-row-v49 ${selectedId === company.organization_id ? 'active' : ''}`}
              onClick={() => setSelectedId(company.organization_id)}
            >
              <strong>{company.organization_name}</strong>
              <span>{Number(company.active_leads || 0)} leads</span>
              <span>{Number(company.won_count || 0)} fechados</span>
              <span>{formatCurrency(company.won_value || 0)}</span>
              <ChevronRight size={17}/>
            </button>
          ))}
          {!companies.length && !message && <p className="muted">Nenhuma empresa cadastrada.</p>}
        </div>
      </section>

      {selected && (
        <section className="panel team-performance-v49 platform-company-detail-v49">
          <div className="panel-head"><div><span className="eyebrow">{selected.organization_name}</span><h2>Equipe da empresa</h2></div></div>
          <div className="team-performance-list-v49">
            <div className="team-performance-row-v49 team-performance-head-v49">
              <span>Usuário</span><span>Leads</span><span>Negócios fechados</span><span>Valor fechado</span>
            </div>
            {team.map(row => (
              <div className="team-performance-row-v49" key={row.user_id}>
                <span>
                  <strong>{row.full_name || 'Usuário'}</strong>
                  <small>{row.role === 'owner' ? 'Proprietário' : row.role === 'admin' ? 'Administrador' : 'Usuário'}</small>
                </span>
                <span>{Number(row.active_leads || 0)}</span>
                <span>{Number(row.won_count || 0)}</span>
                <span>{formatCurrency(row.won_value || 0)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}


function AdminOverview({ organizations }) {
  const [stats, setStats] = useState({
    organizations: 0,
    activeOrganizations: 0,
    leads: 0,
    campaigns: 0,
    queued: 0,
    failed: 0,
    sent: 0,
    whatsappNumbers: 0
  })

  useEffect(() => {
    async function load() {
      const productionOrgIds = organizations.filter(org => org.is_sandbox !== true).map(org => org.id)
      if (!productionOrgIds.length) {
        setStats({ organizations: 0, activeOrganizations: 0, leads: 0, campaigns: 0, queued: 0, failed: 0, sent: 0, whatsappNumbers: 0 })
        return
      }
      const [
        { count: leadsCount },
        { count: campaignsCount },
        { count: queuedCount },
        { count: failedCount },
        { count: sentCount },
        { count: numbersCount }
      ] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true }).in('organization_id', productionOrgIds),
        supabase.from('campaigns').select('id', { count: 'exact', head: true }).in('organization_id', productionOrgIds),
        supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).in('organization_id', productionOrgIds).in('status', ['queued', 'ready', 'pending']),
        supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).in('organization_id', productionOrgIds).eq('status', 'failed'),
        supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).in('organization_id', productionOrgIds).eq('status', 'sent'),
        supabase.from('whatsapp_numbers').select('id', { count: 'exact', head: true }).in('organization_id', productionOrgIds)
      ])

      setStats({
        organizations: organizations.length,
        activeOrganizations: organizations.filter(o => o.is_active).length,
        leads: leadsCount || 0,
        campaigns: campaignsCount || 0,
        queued: queuedCount || 0,
        failed: failedCount || 0,
        sent: sentCount || 0,
        whatsappNumbers: numbersCount || 0
      })
    }
    load()
  }, [organizations])

  return (
    <>
      <AdminSectionHeader
        title="Visão geral"
        description="Resumo operacional do ambiente administrativo."
      />

      <section className="admin-stat-grid">
        <StatCard label="Clientes" value={stats.organizations} detail={`${stats.activeOrganizations} ativos`} />
        <StatCard label="Leads" value={stats.leads} detail="Base total" />
        <StatCard label="Campanhas" value={stats.campaigns} detail="Todas as organizações" />
        <StatCard label="Na fila" value={stats.queued} detail="Mensagens aguardando" />
        <StatCard label="Enviadas" value={stats.sent} detail="Histórico registrado" />
        <StatCard label="Falhas" value={stats.failed} detail="Exigem revisão" />
        <StatCard label="Números WhatsApp" value={stats.whatsappNumbers} detail="Cadastrados no CRM" />
      </section>

      <section className="panel">
        <span className="eyebrow">ESTRUTURA</span>
        <h2>Painel administrativo central</h2>
        <p className="muted">
          Use o menu interno para administrar WhatsApp, fila, catálogo, clientes, Google Places,
          configurações padrão, mensagens e auditoria.
        </p>
      </section>
    </>
  )
}



function AdminWhatsApp({ organizations, userEmail, userMode = false }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '')
  const [settings, setSettings] = useState(null)
  const [numbers, setNumbers] = useState([])
  const [sentToday, setSentToday] = useState(0)
  const [message, setMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loadingEvolution, setLoadingEvolution] = useState(false)
  const [qrSession, setQrSession] = useState(null)
  const [form, setForm] = useState({ alias: '', phone_e164: '' })

  useEffect(() => {
    if (!organizationId && organizations[0]?.id) setOrganizationId(organizations[0].id)
  }, [organizations])

  async function evolutionAction(action, payload = {}) {
    const { data, error } = await supabase.functions.invoke('evolution_gateway', {
      body: { action, organization_id: organizationId, ...payload }
    })
    if (error) throw new Error(error.message || 'Falha na integração com WhatsApp.')
    if (data?.error) throw new Error(data.error)
    return data || {}
  }

  function extractQr(data) {
    const raw = data?.qrcode?.base64 || data?.qrcode?.base64Image || data?.base64 || data?.qrcode?.code || null
    if (!raw) return null
    if (String(raw).startsWith('data:image')) return raw
    if (/^[A-Za-z0-9+/=\s]+$/.test(String(raw)) && String(raw).length > 200) {
      return `data:image/png;base64,${String(raw).replace(/\s/g, '')}`
    }
    return null
  }

  async function load() {
    if (!organizationId) return
    setMessage('')

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      { data: settingsData },
      { data: numbersData },
      { count: sentCount }
    ] = await Promise.all([
      supabase.from('organization_settings').select('*').eq('organization_id', organizationId).single(),
      supabase.from('whatsapp_numbers').select('*').eq('organization_id', organizationId).order('created_at'),
      supabase.from('outbound_messages')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'sent')
        .gte('sent_at', today.toISOString())
    ])

    setSettings(settingsData || null)
    setNumbers(numbersData || [])
    setSentToday(sentCount || 0)
  }

  useEffect(() => {
    load()
  }, [organizationId])

  async function createEvolutionInstance(dbNumber, alias, phone) {
    setLoadingEvolution(true)
    setMessage('Criando conexão com o WhatsApp...')

    try {
      const result = await evolutionAction('create_instance', { number_id: dbNumber.id })
      const provider = result?.provider || {}
      const state = result?.state || provider?.instance?.status || provider?.instance?.state || 'connecting'
      const qr = extractQr(provider)
      setQrSession({ numberId: dbNumber.id, instanceName: result?.instance_name || '', qr, status: state })
      setMessage(state === 'open' ? 'WhatsApp conectado com sucesso.' : (qr ? 'Escaneie o QR Code com o WhatsApp.' : 'Instância criada. Solicitando QR Code...'))
      if (state === 'open') setQrSession(null)
      await load()
    } catch (error) {
      setMessage(`Não foi possível iniciar a conexão: ${error.message}`)
    } finally {
      setLoadingEvolution(false)
    }
  }

  async function addNumber(e) {
    e.preventDefault()
    const clean = String(form.phone_e164 || '').replace(/\D/g, '')
    if (!clean) return
    const phone = clean.startsWith('55') ? clean : `55${clean}`
    const alias = form.alias.trim() || 'WhatsApp'
    const first = numbers.length === 0

    if (first) {
      await supabase.from('whatsapp_numbers').update({ is_default: false }).eq('organization_id', organizationId)
    }

    const { data, error } = await supabase.from('whatsapp_numbers').insert({
      organization_id: organizationId,
      alias,
      phone_e164: phone,
      is_default: first,
      is_active: true,
      connection_status: 'not_configured',
      provider: 'evolution'
    }).select('*').single()

    if (error) {
      setMessage(error.message)
      return
    }

    setForm({ alias: '', phone_e164: '' })
    setShowForm(false)
    await load()
    await createEvolutionInstance(data, alias, phone)
  }

  async function connectExisting(number) {
    if (!number.evolution_instance_name) {
      await createEvolutionInstance(number, number.alias, number.phone_e164)
      return
    }

    setLoadingEvolution(true)
    setMessage('Gerando QR Code...')
    try {
      const result = await evolutionAction('connect_instance', { number_id: number.id })
      const state = result?.state || 'connecting'
      const qr = extractQr(result?.provider || {})
      if (state === 'open') {
        setQrSession(null)
        setMessage('WhatsApp já está conectado.')
      } else {
        setQrSession({ numberId: number.id, instanceName: number.evolution_instance_name, qr, status: state })
        setMessage(qr ? 'Escaneie o QR Code com o WhatsApp.' : 'Conexão iniciada. Aguarde alguns segundos e atualize o QR Code.')
      }
      await load()
    } catch (error) {
      setMessage(`Erro ao conectar: ${error.message}`)
    } finally {
      setLoadingEvolution(false)
    }
  }

  async function refreshQr() {
    if (!qrSession?.numberId) return
    setLoadingEvolution(true)
    try {
      const stateResult = await evolutionAction('connection_state', { number_id: qrSession.numberId })
      const state = stateResult?.state || ''
      if (state === 'open') {
        setQrSession(null)
        setMessage('WhatsApp conectado com sucesso.')
        await load()
        return
      }

      const result = await evolutionAction('connect_instance', { number_id: qrSession.numberId })
      const qr = extractQr(result?.provider || {})
      setQrSession(old => ({ ...old, qr: qr || old?.qr, status: result?.state || state || 'connecting' }))
      setMessage(qr ? 'QR Code atualizado.' : 'Aguardando QR Code da Evolution API.')
    } catch (error) {
      setMessage(`Não foi possível atualizar a conexão: ${error.message}`)
    } finally {
      setLoadingEvolution(false)
    }
  }

  useEffect(() => {
    if (!qrSession?.numberId) return
    const timer = setInterval(async () => {
      try {
        const result = await evolutionAction('connection_state', { number_id: qrSession.numberId })
        if (result?.state === 'open') {
          setQrSession(null)
          setMessage('WhatsApp conectado com sucesso.')
          await load()
        }
      } catch {
        // O botão Atualizar QR permite nova tentativa manual sem interromper a tela.
      }
    }, 3500)
    return () => clearInterval(timer)
  }, [qrSession?.numberId])

  async function syncStatus(number) {
    if (!number.evolution_instance_name) {
      setMessage('Esse número ainda não possui uma instância na Evolution API.')
      return
    }
    setLoadingEvolution(true)
    try {
      const result = await evolutionAction('connection_state', { number_id: number.id })
      const state = result?.state || 'unknown'
      setMessage(state === 'open' ? 'Número conectado.' : `Status atual: ${state}`)
      await load()
    } catch (error) {
      setMessage(`Erro ao consultar Evolution API: ${error.message}`)
    } finally {
      setLoadingEvolution(false)
    }
  }

  async function setDefault(numberId) {
    await supabase.from('whatsapp_numbers').update({ is_default: false }).eq('organization_id', organizationId)
    const { error } = await supabase.from('whatsapp_numbers').update({ is_default: true, is_active: true }).eq('id', numberId)
    if (error) setMessage(error.message)
    else await load()
  }

  async function toggleNumber(number) {
    const { error } = await supabase.from('whatsapp_numbers').update({ is_active: !number.is_active }).eq('id', number.id)
    if (error) setMessage(error.message)
    else await load()
  }

  async function removeNumber(number) {
    if (number.evolution_instance_name) {
      try {
        await evolutionAction('delete_instance', { number_id: number.id })
      } catch (error) {
        if (!window.confirm(`A Evolution API respondeu: ${error.message}. Deseja arquivar o cadastro do CRM mesmo assim?`)) return
      }
    }

    const { error } = await softDeleteRow('whatsapp_numbers', number.id, number.organization_id, {
      is_active: false,
      is_default: false
    })
    if (error) setMessage(error.message)
    else {
      setMessage('Número arquivado. O histórico do cadastro foi preservado.')
      const remaining = numbers.filter(n => n.id !== number.id)
      setNumbers(remaining)
      if (number.is_default && remaining.length) await setDefault(remaining[0].id)
    }
  }

  async function saveSettings() {
    if (!settings) return

    const allowedStart = String(settings.allowed_send_start || '08:00').slice(0, 5)
    const allowedEnd = String(settings.allowed_send_end || '18:00').slice(0, 5)
    const cadenceDays = (Array.isArray(settings.default_cadence_days) && settings.default_cadence_days.length
      ? settings.default_cadence_days
      : [1, 3, 5]
    ).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort((a, b) => a - b)

    if (!allowedStart || !allowedEnd || allowedStart >= allowedEnd) {
      setMessage('O horário inicial precisa ser anterior ao horário final.')
      return
    }
    if (!cadenceDays.length) {
      setMessage('Selecione pelo menos um dia de envio.')
      return
    }

    const payload = {
      whatsapp_send_interval_seconds: Math.max(1, Number(settings.whatsapp_send_interval_seconds || 120)),
      whatsapp_batch_limit: Math.max(1, Number(settings.whatsapp_batch_limit || 20)),
      whatsapp_daily_send_limit:
        settings.whatsapp_daily_send_limit === '' || settings.whatsapp_daily_send_limit == null
          ? null
          : Math.max(1, Number(settings.whatsapp_daily_send_limit)),
      whatsapp_sending_paused: Boolean(settings.whatsapp_sending_paused),
      allowed_send_start: allowedStart,
      allowed_send_end: allowedEnd,
      default_cadence_days: cadenceDays
    }

    const { error } = await supabase.from('organization_settings').update(payload).eq('organization_id', organizationId)
    if (error) setMessage(error.message)
    else {
      setMessage('Configurações do WhatsApp salvas.')
      await load()
    }
  }

  if (!organizations.length) return <div className="notice">Nenhuma organização cadastrada.</div>

  return (
    <>
      <AdminSectionHeader
        eyebrow={userMode ? 'CONFIGURAÇÕES' : 'ADMINISTRAÇÃO'}
        title="WhatsApp"
        description={userMode
          ? 'Cadastre e conecte os números de WhatsApp usados pela sua empresa.'
          : 'Cadastre o número, conecte pelo QR Code e gerencie as regras de envio.'}
        actions={
          <button className="primary inline-btn" onClick={() => setShowForm(!showForm)}>
            <Plus size={16}/> Adicionar número
          </button>
        }
      />

      {!userMode && (
        <label className="admin-org-select">
          Organização
          <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
            {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}

      {message && <div className="notice">{message}</div>}

      {showForm && (
        <section className="panel">
          <form onSubmit={addNumber} className="campaign-form">
            <div className="field-grid">
              <label>
                Nome/apelido
                <input value={form.alias} onChange={e => setForm({...form, alias: e.target.value})} placeholder="Ex.: Comercial Campinas" required />
              </label>
              <label>
                Número com DDI/DDD
                <input value={form.phone_e164} onChange={e => setForm({...form, phone_e164: e.target.value})} placeholder="5519999999999" required />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="primary" disabled={loadingEvolution}>{loadingEvolution ? 'Conectando...' : 'Adicionar e conectar'}</button>
            </div>
          </form>
        </section>
      )}

      {qrSession && (
        <section className="panel evolution-qr-panel">
          <div>
            <span className="eyebrow">CONECTAR WHATSAPP</span>
            <h2>Escaneie o QR Code</h2>
            <p className="muted">No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
            <p className="muted"><strong>Instância:</strong> {qrSession.instanceName}</p>
            <div className="form-actions">
              <button className="secondary inline-btn" onClick={refreshQr} disabled={loadingEvolution}>
                <RefreshCw size={16}/> Atualizar QR
              </button>
              <button className="secondary" onClick={() => setQrSession(null)}>Fechar</button>
            </div>
          </div>
          <div className="evolution-qr-box">
            {qrSession.qr
              ? <img src={qrSession.qr} alt="QR Code para conectar o WhatsApp" />
              : <div className="qr-placeholder">Aguardando QR Code...</div>}
          </div>
        </section>
      )}

      <section className={userMode ? "admin-one-column" : "admin-two-column"}>
        <div className="panel">
          <span className="eyebrow">NÚMEROS</span>
          <h2>Remetentes cadastrados</h2>

          <div className="admin-list">
            {numbers.length === 0 && <p className="muted">Nenhum número cadastrado.</p>}
            {numbers.map(number => (
              <div className="admin-list-row" key={number.id}>
                <div>
                  <strong>{number.alias}</strong>
                  <span>{number.phone_e164}</span>
                  <small>
                    {number.is_default ? 'Padrão' : 'Alternativo'} • {number.is_active ? 'Ativo' : 'Inativo'} • {number.connection_status}
                  </small>
                  {number.evolution_instance_name && <small>Evolution: {number.evolution_instance_name}</small>}
                </div>
                <div className="row-actions">
                  {number.connection_status !== 'connected' && (
                    <button className="primary mini" onClick={() => connectExisting(number)} disabled={loadingEvolution}>Conectar</button>
                  )}
                  {number.evolution_instance_name && (
                    <button className="secondary mini" onClick={() => syncStatus(number)} disabled={loadingEvolution}>Atualizar status</button>
                  )}
                  {!number.is_default && <button className="secondary mini" onClick={() => setDefault(number.id)}>Definir padrão</button>}
                  <button className="secondary mini" onClick={() => toggleNumber(number)}>
                    {number.is_active ? 'Desativar' : 'Ativar'}
                  </button>
                  <button className="text-danger mini" onClick={() => removeNumber(number)}>Excluir</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {!userMode && (
        <div className="panel">
          <span className="eyebrow">CONTROLE</span>
          <h2>Regras de envio</h2>

          {settings && (
            <div className="campaign-form">
              <div className="admin-send-window-v63">
                <span className="eyebrow">PROGRAMAÇÃO AUTOMÁTICA</span>
                <h3>Janela de envio</h3>

                <div className="field-grid">
                  <label>
                    Início
                    <input
                      type="time"
                      value={String(settings.allowed_send_start || '08:00').slice(0, 5)}
                      onChange={e => setSettings({...settings, allowed_send_start: e.target.value})}
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      type="time"
                      value={String(settings.allowed_send_end || '18:00').slice(0, 5)}
                      onChange={e => setSettings({...settings, allowed_send_end: e.target.value})}
                    />
                  </label>
                </div>

                <div>
                  <strong className="admin-days-title-v63">Dias de envio</strong>
                  <div className="admin-days-v63">
                    {[
                      [1, 'Segunda'],
                      [2, 'Terça'],
                      [3, 'Quarta'],
                      [4, 'Quinta'],
                      [5, 'Sexta'],
                      [6, 'Sábado'],
                      [0, 'Domingo']
                    ].map(([day, label]) => {
                      const currentDays = (Array.isArray(settings.default_cadence_days) && settings.default_cadence_days.length
                        ? settings.default_cadence_days
                        : [1, 3, 5]).map(Number)
                      return (
                        <label className="admin-day-option-v63" key={day}>
                          <input
                            type="checkbox"
                            checked={currentDays.includes(day)}
                            onChange={e => {
                              const nextDays = e.target.checked
                                ? [...new Set([...currentDays, day])].sort((a, b) => a - b)
                                : currentDays.filter(value => value !== day)
                              setSettings({...settings, default_cadence_days: nextDays})
                            }}
                          />
                          {label}
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="field-grid">
                <label>
                  Intervalo entre mensagens (s)
                  <input type="number" min="1" value={settings.whatsapp_send_interval_seconds ?? 120}
                    onChange={e => setSettings({...settings, whatsapp_send_interval_seconds: e.target.value})} />
                </label>
                <label>
                  Limite por lote
                  <input type="number" min="1" value={settings.whatsapp_batch_limit ?? 20}
                    onChange={e => setSettings({...settings, whatsapp_batch_limit: e.target.value})} />
                </label>
              </div>

              <label>
                Limite diário de mensagens
                <input type="number" min="1" value={settings.whatsapp_daily_send_limit ?? ''}
                  placeholder="Sem limite definido"
                  onChange={e => setSettings({...settings, whatsapp_daily_send_limit: e.target.value})} />
              </label>

              <label className="checkbox-line">
                <input type="checkbox" checked={Boolean(settings.whatsapp_sending_paused)}
                  onChange={e => setSettings({...settings, whatsapp_sending_paused: e.target.checked})} />
                Pausar todos os envios
              </label>

              <div className="notice compact-notice">
                <strong>Enviadas hoje:</strong> {sentToday}<br/>
                <strong>Janela:</strong> {String(settings.allowed_send_start || '08:00').slice(0, 5)} às {String(settings.allowed_send_end || '18:00').slice(0, 5)}<br/>
                <strong>Limite diário:</strong> {settings.whatsapp_daily_send_limit || 20}<br/>
                <strong>Intervalo padrão:</strong> {settings.whatsapp_send_interval_seconds || 120}s<br/>
                <strong>Máximo por lote:</strong> {settings.whatsapp_batch_limit || 20}
              </div>

              <button className="primary inline-btn" onClick={saveSettings}><Save size={16}/> Salvar</button>
            </div>
          )}
        </div>
        )}
      </section>
    </>
  )
}

function AdminQueue({ organizations }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '')
  const [batches, setBatches] = useState([])
  const [messages, setMessages] = useState([])
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!organizationId && organizations[0]?.id) setOrganizationId(organizations[0].id)
  }, [organizations])

  async function load() {
    if (!organizationId) return
    const [{ data: batchData }, { data: messageData }] = await Promise.all([
      supabase
        .from('outbound_batches')
        .select('*, whatsapp_numbers(alias,phone_e164)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('outbound_messages')
        .select('*, leads(business_name), whatsapp_numbers(alias,phone_e164)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(250)
    ])
    setBatches(batchData || [])
    setMessages(messageData || [])
  }

  useEffect(() => {
    let active = true

    async function refresh() {
      if (!active) return
      await load()
    }

    refresh()
    const timer = setInterval(refresh, 3000)

    function handleFocus() {
      refresh()
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
    }
  }, [organizationId])

  async function rescheduleBatchMessages(batchId, statuses) {
    const { data: pending } = await supabase
      .from('outbound_messages')
      .select('id')
      .eq('batch_id', batchId)
      .in('status', statuses)
      .order('created_at', { ascending: true })

    const interval = Math.max(1, Number(batches.find(b => b.id === batchId)?.interval_seconds || 120))
    const now = Date.now()

    for (let i = 0; i < (pending || []).length; i++) {
      await supabase
        .from('outbound_messages')
        .update({
          status: 'queued',
          error_message: null,
          cancelled_at: null,
          scheduled_for: new Date(now + i * interval * 1000).toISOString()
        })
        .eq('id', pending[i].id)
    }
  }

  async function updateBatch(batch, action) {
    let batchPatch = {}
    let messagePatch = null

    if (action === 'cancel') {
      batchPatch = { status: 'cancelled', cancelled_at: new Date().toISOString() }
      messagePatch = { status: 'cancelled', cancelled_at: new Date().toISOString() }
    }

    if (action === 'pause') {
      batchPatch = { status: 'paused', paused_at: new Date().toISOString() }
    }

    if (action === 'resume') {
      await rescheduleBatchMessages(batch.id, ['queued', 'ready'])
      batchPatch = { status: 'queued', paused_at: null }
    }

    if (action === 'retry') {
      await rescheduleBatchMessages(batch.id, ['failed'])
      batchPatch = { status: 'queued', paused_at: null }
    }

    const { error } = await supabase.from('outbound_batches').update(batchPatch).eq('id', batch.id)

    if (!error && messagePatch) {
      await supabase
        .from('outbound_messages')
        .update(messagePatch)
        .eq('batch_id', batch.id)
        .in('status', ['queued', 'ready', 'failed'])
    }

    setNotice(error ? error.message : 'Fila atualizada.')
    await load()
  }

  async function cancelMessage(message) {
    const { error } = await supabase
      .from('outbound_messages')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', message.id)
      .in('status', ['queued', 'ready', 'pending', 'failed'])

    setNotice(error ? error.message : 'Mensagem cancelada.')
    await load()
  }

  const filteredMessages = selectedBatchId
    ? messages.filter(m => m.batch_id === selectedBatchId)
    : messages

  return (
    <>
      <AdminSectionHeader
        title="Fila de mensagens"
        description="Aguardando, enviados, falhas, cancelamentos e horários previstos."
      />

      <div className="admin-filter-row">
        <label>
          Organização
          <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
            {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label>
          Lote
          <select value={selectedBatchId} onChange={e => setSelectedBatchId(e.target.value)}>
            <option value="">Todos</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>

      {notice && <div className="notice">{notice}</div>}

      <section className="panel">
        <span className="eyebrow">LOTES</span>
        <div className="admin-list">
          {batches.map(batch => (
            <div className="admin-list-row" key={batch.id}>
              <div>
                <strong>{batch.name}</strong>
                <span>{batch.total_recipients} destinatários • {batch.interval_seconds || 120}s</span>
                <small>
                  {batch.status} • {batch.whatsapp_numbers?.alias || 'Sem remetente'} • criado em {formatDateTime(batch.created_at)}
                </small>
              </div>
              <div className="row-actions">
                {!['cancelled', 'completed'].includes(batch.status) && (
                  <>
                    {batch.status === 'paused'
                      ? <button className="secondary mini" onClick={() => updateBatch(batch, 'resume')}><Play size={14}/> Retomar</button>
                      : <button className="secondary mini" onClick={() => updateBatch(batch, 'pause')}><Pause size={14}/> Pausar</button>
                    }
                    <button className="secondary mini" onClick={() => updateBatch(batch, 'retry')}><RefreshCw size={14}/> Repetir falhas</button>
                    <button className="text-danger mini" onClick={() => updateBatch(batch, 'cancel')}><XCircle size={14}/> Cancelar</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {batches.length === 0 && <p className="muted">Nenhum lote registrado.</p>}
        </div>
      </section>

      <section className="panel">
        <span className="eyebrow">MENSAGENS</span>
        <div className="admin-table">
          <div className="admin-table-row head">
            <span>Lead</span><span>Status</span><span>Remetente</span><span>Programada</span><span>Enviada</span><span>Ação</span>
          </div>
          {filteredMessages.map(item => (
            <div className="admin-table-row" key={item.id}>
              <span>{item.leads?.business_name || item.recipient}</span>
              <span>{item.status}</span>
              <span>{item.whatsapp_numbers?.alias || '—'}</span>
              <span>{formatDateTime(item.scheduled_for)}</span>
              <span>{formatDateTime(item.sent_at)}</span>
              <span>
                {['queued', 'ready', 'pending', 'failed'].includes(item.status) && (
                  <button className="text-danger mini" onClick={() => cancelMessage(item)}>Cancelar</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}


function AdminUsers({ organizations, userEmail }) {
  const [users, setUsers] = useState([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  async function loadUsers() {
    setLoading(true)
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', {
      body: { action: 'list_users' }
    })
    setLoading(false)

    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível carregar os usuários.')
      return
    }

    setUsers(data?.users || [])
  }

  useEffect(() => { loadUsers() }, [])

  async function runAction(body, successMessage) {
    setNotice('')
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', { body })
    if (error || data?.error) {
      setNotice(data?.error || error?.message || 'Não foi possível concluir.')
      return false
    }
    setNotice(successMessage)
    await loadUsers()
    return true
  }

  async function changePlatformRole(item, value) {
    const isAdmin = value === 'admin'
    await runAction(
      { action: 'set_platform_role', user_id: item.id, is_admin: isAdmin },
      isAdmin ? 'Usuário definido como administrador do sistema.' : 'Usuário definido como usuário comum.'
    )
  }

  async function changeStatus(item, status) {
    await runAction(
      { action: 'set_account_status', user_id: item.id, status },
      'Situação do usuário atualizada.'
    )
  }

  async function changeOrganization(item, organizationId) {
    if (!organizationId) {
      await runAction(
        { action: 'remove_user_organization', user_id: item.id },
        'Usuário desvinculado da organização.'
      )
      return
    }

    const currentRole = item.organizations?.[0]?.role || 'member'
    await runAction(
      {
        action: 'assign_user_organization',
        user_id: item.id,
        organization_id: organizationId,
        role: currentRole
      },
      'Organização do usuário atualizada.'
    )
  }

  async function changeOrganizationRole(item, role) {
    const organizationId = item.organizations?.[0]?.organization_id
    if (!organizationId) return

    await runAction(
      {
        action: 'assign_user_organization',
        user_id: item.id,
        organization_id: organizationId,
        role
      },
      'Papel do usuário na organização atualizado.'
    )
  }

  async function deleteUser(item) {
    setNotice('')
    const { error } = await supabase.rpc('archive_user_soft', { target_user: item.id })
    if (error) {
      setNotice(error.message || 'Não foi possível arquivar o usuário.')
      return
    }
    setNotice('Usuário arquivado. Ele não poderá acessar o CRM até ser reativado.')
    await loadData()
  }

  async function sendPasswordReset(item) {
    setNotice('')
    const { error } = await supabase.auth.resetPasswordForEmail(item.email, {
      redirectTo: window.location.origin
    })
    setNotice(error ? (error.message || 'Não foi possível enviar o link.') : `Link de redefinição enviado para ${item.email}.`)
  }

  const filtered = users.filter(item => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return true
    const orgName = item.organizations?.[0]?.organizations?.name || ''
    return [
      item.email,
      item.full_name,
      orgName
    ].some(value => String(value || '').toLowerCase().includes(term))
  })

  function statusLabel(status) {
    if (status === 'suspended') return 'Suspenso'
    if (status === 'inactive') return 'Inativo'
    return 'Ativo'
  }

  return (
    <>
      <AdminSectionHeader
        title="Usuários"
        description="Todos os acessos do CRM, perfil do sistema, organização vinculada e situação da conta."
        actions={
          <button className="secondary inline-btn" onClick={loadUsers} disabled={loading}>
            <RefreshCw size={16}/> {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        }
      />

      {notice && <div className="notice">{notice}</div>}

      <section className="panel">
        <div className="admin-user-toolbar">
          <label>
            Buscar usuário
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Nome, e-mail ou empresa"
            />
          </label>
          <div className="admin-user-summary">
            <strong>{users.length}</strong>
            <span>usuários cadastrados</span>
          </div>
        </div>

        <div className="admin-table admin-users-table">
          <div className="admin-table-row head">
            <span>Usuário</span>
            <span>Empresa</span>
            <span>Perfil do sistema</span>
            <span>Papel na empresa</span>
            <span>Situação</span>
            <span>Último acesso</span>
            <span>Ação</span>
          </div>

          {filtered.map(item => {
            const membership = item.organizations?.[0] || null
            const org = membership?.organizations || null
            const isSelf = String(item.email || '').toLowerCase() === String(userEmail || '').toLowerCase()

            return (
              <div className="admin-table-row" key={item.id}>
                <span className="admin-user-identity">
                  <strong>{item.full_name || 'Sem nome'}</strong>
                  <small>{item.email}</small>
                  {!item.email_confirmed_at && <em>E-mail não confirmado</em>}
                </span>

                <span>
                  {item.is_platform_admin ? (
                    <span className="system-role-label">Administração</span>
                  ) : (
                    <select
                      value={org?.id || ''}
                      onChange={e => changeOrganization(item, e.target.value)}
                    >
                      <option value="">Sem empresa</option>
                      {organizations.filter(o => o.is_active).map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  )}
                </span>

                <span>
                  <select
                    value={item.is_platform_admin ? 'admin' : 'common'}
                    onChange={e => changePlatformRole(item, e.target.value)}
                    disabled={isSelf}
                    title={isSelf ? 'Seu próprio perfil administrativo é protegido.' : ''}
                  >
                    <option value="common">Usuário comum</option>
                    <option value="admin">Administrador</option>
                  </select>
                </span>

                <span>
                  {!item.is_platform_admin && membership ? (
                    <select
                      value={membership.role || 'member'}
                      onChange={e => changeOrganizationRole(item, e.target.value)}
                    >
                      <option value="member">Usuário</option>
                      <option value="admin">Administrador da empresa</option>
                      <option value="owner">Proprietário</option>
                    </select>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </span>

                <span>
                  <select
                    value={item.account_status || 'active'}
                    onChange={e => changeStatus(item, e.target.value)}
                    disabled={isSelf}
                    className={`user-status-select status-${item.account_status || 'active'}`}
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                    <option value="suspended">Suspenso</option>
                  </select>
                  {!item.is_platform_admin && !membership && item.account_status === 'active' && (
                    <small className="waiting-link-label">Aguardando vínculo</small>
                  )}
                </span>

                <span>{formatDateTime(item.last_sign_in_at)}</span>

                <span className="row-actions">
                  <button className="secondary mini" onClick={() => sendPasswordReset(item)}>Redefinir senha</button>
                  {!isSelf && (
                    <button className="text-danger mini" onClick={() => deleteUser(item)}>
                      Excluir
                    </button>
                  )}
                </span>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="empty-admin-row">Nenhum usuário encontrado.</div>
          )}
        </div>
      </section>
    </>
  )
}

function AdminClients({ organizations, reloadOrganizations }) {
  const [selectedOrgId, setSelectedOrgId] = useState(organizations[0]?.id || '')
  const [members, setMembers] = useState([])
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', city: '', state: 'SP', radius: 30 })
  const [memberForm, setMemberForm] = useState({ email: '', role: 'member' })
  const [counts, setCounts] = useState({})
  const [organizationSearch, setOrganizationSearch] = useState('')

  useEffect(() => {
    if (!selectedOrgId && organizations[0]?.id) setSelectedOrgId(organizations[0].id)
  }, [organizations])

  async function loadMembers() {
    if (!selectedOrgId) return
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', {
      body: { action: 'list_members', organization_id: selectedOrgId }
    })
    if (error || data?.error) setNotice(data?.error || error?.message)
    else setMembers(data?.members || [])
  }

  async function loadCounts() {
    const result = {}
    for (const org of organizations) {
      const [
        { count: leads },
        { count: campaigns },
        { count: messages }
      ] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
        supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
        supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).eq('organization_id', org.id)
      ])
      result[org.id] = { leads: leads || 0, campaigns: campaigns || 0, messages: messages || 0 }
    }
    setCounts(result)
  }

  useEffect(() => { loadMembers() }, [selectedOrgId])
  useEffect(() => { loadCounts() }, [organizations])

  async function createOrganization(e) {
    e.preventDefault()
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData?.session?.user?.id
    if (!userId) return

    const { data: org, error } = await supabase
      .from('organizations')
      .insert({ name: createForm.name.trim(), created_by: userId, is_active: true })
      .select('id,name')
      .single()

    if (error) {
      setNotice(error.message)
      return
    }

    await supabase.from('organization_settings').insert({
      organization_id: org.id,
      default_city: createForm.city.trim() || null,
      default_state: createForm.state,
      default_radius_km: Number(createForm.radius || 30),
      default_daily_contact_limit: 20,
      default_cadence_days: [1,3,5],
      google_places_monthly_quota: 900,
      whatsapp_send_interval_seconds: 120,
      whatsapp_batch_limit: 20
    })

    setShowCreate(false)
    setCreateForm({ name: '', city: '', state: 'SP', radius: 30 })
    setNotice('Organização criada.')
    await reloadOrganizations()
  }

  async function toggleOrganization(org) {
    const { error } = await supabase.from('organizations').update({ is_active: !org.is_active }).eq('id', org.id)
    setNotice(error ? error.message : (org.is_active ? 'Organização desativada.' : 'Organização reativada.'))
    await reloadOrganizations()
  }

  async function renameOrganization(org) {
    const name = window.prompt('Novo nome da organização:', org.name)
    if (!name?.trim()) return
    const { error } = await supabase.from('organizations').update({ name: name.trim() }).eq('id', org.id)
    setNotice(error ? error.message : 'Nome atualizado.')
    await reloadOrganizations()
  }

  async function addMember(e) {
    e.preventDefault()
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', {
      body: {
        action: 'add_member',
        organization_id: selectedOrgId,
        email: memberForm.email,
        role: memberForm.role
      }
    })
    setNotice(data?.error || error?.message || 'Usuário vinculado.')
    if (!data?.error && !error) {
      setMemberForm({ email: '', role: 'member' })
      await loadMembers()
    }
  }

  async function updateMember(member, patch) {
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', {
      body: {
        action: 'update_member',
        organization_id: selectedOrgId,
        user_id: member.user_id,
        ...patch
      }
    })
    setNotice(data?.error || error?.message || 'Usuário atualizado.')
    if (!data?.error && !error) await loadMembers()
  }

  async function removeMember(member) {
    if (!window.confirm(`Remover ${member.email || member.user_id} desta organização?`)) return
    const { data, error } = await supabase.functions.invoke('admin_manage_organizations', {
      body: {
        action: 'remove_member',
        organization_id: selectedOrgId,
        user_id: member.user_id
      }
    })
    setNotice(data?.error || error?.message || 'Usuário removido.')
    if (!data?.error && !error) await loadMembers()
  }

  const filteredOrganizations = organizations.filter(org => {
    const q = organizationSearch.trim().toLowerCase()
    return !q || (org.name || '').toLowerCase().includes(q)
  })

  return (
    <>
      <AdminSectionHeader
        title="Organizações"
        description="Empresas usuárias do CRM, acessos vinculados e visão de uso."
        actions={
          <button className="primary inline-btn" onClick={() => setShowCreate(!showCreate)}>
            <Plus size={16}/> Nova organização
          </button>
        }
      />

      {notice && <div className="notice">{notice}</div>}

      {showCreate && (
        <section className="panel">
          <form onSubmit={createOrganization} className="campaign-form">
            <label>
              Nome
              <input value={createForm.name} onChange={e => setCreateForm({...createForm, name: e.target.value})} required />
            </label>
            <div className="field-grid three">
              <label>
                Cidade
                <input value={createForm.city} onChange={e => setCreateForm({...createForm, city: e.target.value})} />
              </label>
              <label>
                UF
                <select value={createForm.state} onChange={e => setCreateForm({...createForm, state: e.target.value})}>
                  {UF_OPTIONS.map(uf => <option key={uf}>{uf}</option>)}
                </select>
              </label>
              <label>
                Raio padrão
                <input type="number" min="1" value={createForm.radius} onChange={e => setCreateForm({...createForm, radius: e.target.value})} />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => setShowCreate(false)}>Cancelar</button>
              <button className="primary">Criar organização</button>
            </div>
          </form>
        </section>
      )}

      <section className="panel admin-search-panel compact-search-panel">
        <div className="search-box">
          <Search size={17}/>
          <input
            value={organizationSearch}
            onChange={e => setOrganizationSearch(e.target.value)}
            placeholder="Buscar organização por nome"
          />
        </div>
        <span className="admin-result-count">{filteredOrganizations.length} de {organizations.length} organizações</span>
      </section>

      <section className="campaign-list organization-compact-list">
        {filteredOrganizations.length === 0 ? (
          <article className="panel empty-state compact-empty"><Search size={26}/><h2>Nenhuma organização encontrada</h2></article>
        ) : filteredOrganizations.map(org => (
          <article className="panel campaign-card organization-compact-card" key={org.id}>
            <div>
              <span className="eyebrow">{org.is_active ? 'ATIVO' : 'INATIVO'}</span>
              <h2>{org.name}</h2>
              <p>
                {counts[org.id]?.leads ?? 0} leads • {counts[org.id]?.campaigns ?? 0} campanhas • {counts[org.id]?.messages ?? 0} mensagens
              </p>
            </div>
            <div className="row-actions">
              <button className="secondary mini" onClick={() => { setSelectedOrgId(org.id); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) }}>Usuários</button>
              <button className="secondary mini" onClick={() => renameOrganization(org)}>Editar nome</button>
              <button className="secondary mini" onClick={() => toggleOrganization(org)}>
                {org.is_active ? 'Desativar' : 'Ativar'}
              </button>
            </div>
          </article>
        ))}
      </section>

      {selectedOrgId && (
        <section className="panel">
          <span className="eyebrow">USUÁRIOS</span>
          <h2>{organizations.find(o => o.id === selectedOrgId)?.name}</h2>

          <form onSubmit={addMember} className="admin-member-form">
            <input
              type="email"
              value={memberForm.email}
              onChange={e => setMemberForm({...memberForm, email: e.target.value})}
              placeholder="usuario@empresa.com.br"
              required
            />
            <select value={memberForm.role} onChange={e => setMemberForm({...memberForm, role: e.target.value})}>
              <option value="member">Usuário</option>
              <option value="admin">Administrador</option>
              <option value="owner">Proprietário</option>
            </select>
            <button className="primary inline-btn"><UserPlus size={16}/> Adicionar</button>
          </form>

          <div className="admin-list">
            {members.map(member => (
              <div className="admin-list-row" key={member.user_id}>
                <div>
                  <strong>{member.email || member.user_id}</strong>
                  <span>{member.role} • {member.is_active ? 'Ativo' : 'Suspenso'}</span>
                  <small>Último acesso: {formatDateTime(member.last_sign_in_at)}</small>
                </div>
                <div className="row-actions">
                  <select value={member.role} onChange={e => updateMember(member, { role: e.target.value })}>
                    <option value="member">Usuário</option>
                    <option value="admin">Administrador</option>
                    <option value="owner">Proprietário</option>
                  </select>
                  <button className="secondary mini" onClick={() => updateMember(member, { is_active: !member.is_active })}>
                    {member.is_active ? 'Suspender' : 'Reativar'}
                  </button>
                  <button className="text-danger mini" onClick={() => removeMember(member)}>Remover</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function AdminGooglePlaces({ organizations }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '')
  const [settings, setSettings] = useState(null)
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!organizationId && organizations[0]?.id) setOrganizationId(organizations[0].id)
  }, [organizations])

  async function load() {
    if (!organizationId) return
    const { data, error } = await supabase.from('organization_settings').select('*').eq('organization_id', organizationId).single()
    if (error) setNotice(error.message)
    else setSettings(data)
  }

  useEffect(() => { load() }, [organizationId])

  async function save() {
    const { error } = await supabase
      .from('organization_settings')
      .update({
        google_places_monthly_quota: Number(settings.google_places_monthly_quota || 0),
        google_places_pro_monthly_quota: Number(settings.google_places_pro_monthly_quota || 0)
      })
      .eq('organization_id', organizationId)
    setNotice(error ? error.message : 'Limites salvos.')
    if (!error) await load()
  }

  async function testConnection() {
    setTesting(true)
    setNotice('')
    const { data, error } = await supabase.functions.invoke('admin_test_google_places', {
      body: { organization_id: organizationId }
    })
    setNotice(data?.message || data?.error || error?.message || 'Teste concluído.')
    setTesting(false)
    await load()
  }

  return (
    <>
      <AdminSectionHeader
        title="Google Places"
        description="Limites internos, consumo e teste da integração."
      />

      <label className="admin-org-select">
        Organização
        <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>

      {notice && <div className="notice">{notice}</div>}

      {settings && (
        <section className="admin-two-column">
          <div className="panel">
            <span className="eyebrow">CAPTAÇÃO</span>
            <h2>Enterprise</h2>
            <div className="campaign-form">
              <label>
                Limite mensal interno
                <input
                  type="number"
                  min="0"
                  value={settings.google_places_monthly_quota}
                  onChange={e => setSettings({...settings, google_places_monthly_quota: e.target.value})}
                />
              </label>
              <div className="settings-preview">
                <div><strong>Consumo:</strong> {settings.google_places_usage_month}</div>
                <div><strong>Restante:</strong> {Math.max(Number(settings.google_places_monthly_quota || 0) - Number(settings.google_places_usage_month || 0), 0)}</div>
              </div>
            </div>
          </div>

          <div className="panel">
            <span className="eyebrow">LOCALIZAÇÃO</span>
            <h2>Pro</h2>
            <div className="campaign-form">
              <label>
                Limite mensal interno
                <input
                  type="number"
                  min="0"
                  value={settings.google_places_pro_monthly_quota}
                  onChange={e => setSettings({...settings, google_places_pro_monthly_quota: e.target.value})}
                />
              </label>
              <div className="settings-preview">
                <div><strong>Consumo:</strong> {settings.google_places_pro_usage_month}</div>
                <div><strong>Restante:</strong> {Math.max(Number(settings.google_places_pro_monthly_quota || 0) - Number(settings.google_places_pro_usage_month || 0), 0)}</div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <span className="eyebrow">SITUAÇÃO DA API</span>
        <h2>{settings?.google_places_last_test_ok === true ? 'Conexão OK' : settings?.google_places_last_test_ok === false ? 'Falha no último teste' : 'Ainda não testada'}</h2>
        <p className="muted">
          Último teste: {formatDateTime(settings?.google_places_last_test_at)}.
          {settings?.google_places_last_test_message ? ` ${settings.google_places_last_test_message}` : ''}
        </p>
        <div className="form-actions">
          <button className="secondary" onClick={save}><Save size={16}/> Salvar limites</button>
          <button className="primary inline-btn" onClick={testConnection} disabled={testing}>
            <Activity size={16}/> {testing ? 'Testando...' : 'Testar conexão'}
          </button>
        </div>
        <small className="muted">O teste realiza uma chamada de verificação ao Google Places.</small>
      </section>
    </>
  )
}

function AdminDefaults({ organizations }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '')
  const [settings, setSettings] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!organizationId && organizations[0]?.id) setOrganizationId(organizations[0].id)
  }, [organizations])

  async function load() {
    if (!organizationId) return
    const { data, error } = await supabase.from('organization_settings').select('*').eq('organization_id', organizationId).single()
    if (error) setNotice(error.message)
    else setSettings(data)
  }

  useEffect(() => { load() }, [organizationId])

  async function save() {
    const { error } = await supabase
      .from('organization_settings')
      .update({
        default_city: settings.default_city || null,
        default_state: settings.default_state || null,
        default_radius_km: Number(settings.default_radius_km || 30),
        default_daily_contact_limit: Number(settings.default_daily_contact_limit || 20),
        whatsapp_batch_limit: Number(settings.whatsapp_batch_limit || 20),
        whatsapp_send_interval_seconds: Number(settings.whatsapp_send_interval_seconds || 120),
        allowed_send_start: settings.allowed_send_start || null,
        allowed_send_end: settings.allowed_send_end || null
      })
      .eq('organization_id', organizationId)

    setNotice(error ? error.message : 'Configurações padrão salvas.')
    if (!error) await load()
  }

  return (
    <>
      <AdminSectionHeader
        title="Configurações padrão"
        description="Padrões operacionais por organização."
      />

      <label className="admin-org-select">
        Organização
        <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>

      {notice && <div className="notice">{notice}</div>}

      {settings && (
        <>
          <section className="panel">
            <div className="field-grid three">
              <label>
                Cidade padrão
                <input value={settings.default_city || ''} onChange={e => setSettings({...settings, default_city: e.target.value})} />
              </label>
              <label>
                UF padrão
                <select value={settings.default_state || 'SP'} onChange={e => setSettings({...settings, default_state: e.target.value})}>
                  {UF_OPTIONS.map(uf => <option key={uf}>{uf}</option>)}
                </select>
              </label>
              <label>
                Raio padrão (km)
                <input type="number" min="1" value={settings.default_radius_km || 30} onChange={e => setSettings({...settings, default_radius_km: e.target.value})} />
              </label>
            </div>

            <div className="field-grid">
              <label>
                Contatos/dia padrão
                <input type="number" min="1" value={settings.default_daily_contact_limit || 20} onChange={e => setSettings({...settings, default_daily_contact_limit: e.target.value})} />
              </label>
              <label>
                Máximo de leads por lote
                <input type="number" min="1" value={settings.whatsapp_batch_limit || 20} onChange={e => setSettings({...settings, whatsapp_batch_limit: e.target.value})} />
              </label>
            </div>

            <label>
              Intervalo padrão entre mensagens (s)
              <input type="number" min="1" value={settings.whatsapp_send_interval_seconds || 120} onChange={e => setSettings({...settings, whatsapp_send_interval_seconds: e.target.value})} />
            </label>

            <div className="field-grid">
              <label>
                Horário permitido — início
                <input type="time" value={settings.allowed_send_start || ''} onChange={e => setSettings({...settings, allowed_send_start:e.target.value})} />
              </label>
              <label>
                Horário permitido — fim
                <input type="time" value={settings.allowed_send_end || ''} onChange={e => setSettings({...settings, allowed_send_end:e.target.value})} />
              </label>
            </div>

            <div className="form-actions">
              <button className="primary inline-btn" onClick={save}><Save size={16}/> Salvar configurações</button>
            </div>
          </section>
        </>
      )}
    </>
  )
}

function AdminMessages({ organizations, userEmail }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '')

  useEffect(() => {
    if (!organizationId && organizations[0]?.id) setOrganizationId(organizations[0].id)
  }, [organizations])

  const organization = organizations.find(o => o.id === organizationId)

  return (
    <>
      <AdminSectionHeader
        title="Mensagens"
        description="Modelos por cliente, público-alvo e mensagem padrão."
      />

      <label className="admin-org-select">
        Organização
        <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>

      {organization && (
        <div className="admin-nested-module">
          <Messages organization={organization} userEmail={userEmail} />
        </div>
      )}
    </>
  )
}

const INTEGRATION_CATEGORY_LABELS = {
  erp: 'ERP',
  ecommerce: 'E-commerce',
  finance: 'Financeiro',
  invoicing: 'Emissão fiscal',
  custom: 'Outro sistema'
}

const INTEGRATION_DIRECTION_LABELS = {
  outbound: 'AXIVA → plataforma',
  inbound: 'Plataforma → AXIVA',
  bidirectional: 'Bidirecional'
}

function AdminIntegrations({ organizations }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '')
  const [connections, setConnections] = useState([])
  const [queueStats, setQueueStats] = useState({ pending: 0, failed: 0 })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    display_name: '',
    category: 'erp',
    sync_direction: 'outbound'
  })

  useEffect(() => {
    if (!organizationId && organizations[0]?.id) setOrganizationId(organizations[0].id)
  }, [organizations, organizationId])

  async function load() {
    if (!organizationId) {
      setConnections([])
      setQueueStats({ pending: 0, failed: 0 })
      return
    }

    setLoading(true)
    const [connectionsResult, pendingResult, failedResult] = await Promise.all([
      supabase
        .from('integration_connections')
        .select('id,organization_id,category,provider_key,display_name,sync_direction,status,api_version,credentials_configured,last_sync_at,last_success_at,last_error_summary,created_at')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('integration_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .in('status', ['pending', 'processing']),
      supabase
        .from('integration_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .in('status', ['failed', 'dead_letter'])
    ])

    if (connectionsResult.error) {
      setMessage(`Não foi possível carregar as integrações: ${connectionsResult.error.message}`)
      setConnections([])
    } else {
      setConnections(connectionsResult.data || [])
      setQueueStats({ pending: pendingResult.count || 0, failed: failedResult.count || 0 })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [organizationId])

  async function savePreparation(e) {
    e.preventDefault()
    const displayName = form.display_name.trim()
    const providerKey = slugify(displayName).slice(0, 50)

    if (displayName.length < 2 || providerKey.length < 2) {
      setMessage('Informe o nome da plataforma com pelo menos dois caracteres.')
      return
    }

    setLoading(true)
    setMessage('')
    const { error } = await supabase.from('integration_connections').insert({
      organization_id: organizationId,
      category: form.category,
      provider_key: providerKey,
      display_name: displayName,
      sync_direction: form.sync_direction
    })

    if (error) {
      setMessage(`Não foi possível preparar a integração: ${error.message}`)
    } else {
      setForm({ display_name: '', category: 'erp', sync_direction: 'outbound' })
      setMessage('Integração preparada. Nenhuma conexão externa foi ativada.')
      await load()
    }
    setLoading(false)
  }

  async function togglePreparation(connection) {
    const nextStatus = connection.status === 'inactive' ? 'draft' : 'inactive'
    setLoading(true)
    setMessage('')
    const { error } = await supabase
      .from('integration_connections')
      .update({ status: nextStatus })
      .eq('id', connection.id)
      .eq('organization_id', organizationId)

    if (error) setMessage(`Não foi possível atualizar a preparação: ${error.message}`)
    else await load()
    setLoading(false)
  }

  return (
    <>
      <AdminSectionHeader
        title="Integrações"
        description="Prepare conexões com ERP e outras plataformas sem expor credenciais no navegador."
        actions={<button className="secondary inline-btn" onClick={load} disabled={loading}><RefreshCw size={15}/> Atualizar</button>}
      />

      <label className="admin-org-select">
        Organização
        <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>

      {message && <div className="notice">{message}</div>}

      <section className="panel integration-security-note">
        <div>
          <span className="eyebrow">PREPARAÇÃO SEGURA</span>
          <h2>Cadastre a intenção de integração</h2>
          <p className="muted">
            Esta etapa não envia dados. Credenciais, testes e ativação serão feitos no servidor quando o primeiro conector for escolhido.
          </p>
        </div>
        <div className="integration-queue-summary" aria-label="Situação da fila de integrações">
          <span><strong>{queueStats.pending}</strong> aguardando</span>
          <span className={queueStats.failed ? 'has-error' : ''}><strong>{queueStats.failed}</strong> com falha</span>
        </div>
      </section>

      <section className="panel">
        <form onSubmit={savePreparation} className="campaign-form">
          <div className="field-grid three">
            <label>
              Tipo de plataforma
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {Object.entries(INTEGRATION_CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label>
              Plataforma
              <input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} placeholder="Ex.: ERP atual ou sistema próprio" maxLength={80} required />
            </label>
            <label>
              Fluxo previsto
              <select value={form.sync_direction} onChange={e => setForm({ ...form, sync_direction: e.target.value })}>
                {Object.entries(INTEGRATION_DIRECTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          </div>
          <button className="primary inline-btn" disabled={loading || !organizationId}><Link2 size={16}/> Preparar integração</button>
        </form>
      </section>

      <section className="compact-admin-list integration-list">
        {connections.length === 0 ? (
          <div className="panel compact-empty">
            <h2>Nenhuma integração preparada</h2>
            <p className="muted">O CRM continua funcionando normalmente sem conexão externa.</p>
          </div>
        ) : connections.map(connection => (
          <article className="panel compact-admin-row integration-row" key={connection.id}>
            <div className="compact-admin-main">
              <div className="compact-admin-title-line">
                <strong>{connection.display_name}</strong>
                <span className={`compact-status ${connection.status === 'active' ? 'active' : 'inactive'}`}>
                  {connection.status === 'active' ? 'Ativa' : connection.status === 'error' ? 'Com falha' : connection.status === 'inactive' ? 'Pausada' : 'Preparação'}
                </span>
              </div>
              <p>{INTEGRATION_CATEGORY_LABELS[connection.category] || connection.category} • {INTEGRATION_DIRECTION_LABELS[connection.sync_direction] || connection.sync_direction}</p>
              <div className="compact-term-line">
                <span>{connection.credentials_configured ? 'Credenciais protegidas no servidor' : 'Sem credenciais cadastradas'}</span>
                {connection.last_success_at && <em>Último sucesso: {formatDateTime(connection.last_success_at)}</em>}
                {connection.last_error_summary && <em className="integration-error-text">Requer revisão</em>}
              </div>
            </div>
            {['draft', 'inactive'].includes(connection.status) && (
              <div className="row-actions compact-row-actions">
                <button type="button" className="secondary mini" disabled={loading} onClick={() => togglePreparation(connection)}>
                  {connection.status === 'inactive' ? 'Retomar preparação' : 'Pausar preparação'}
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
    </>
  )
}

function AdminAudit({ organizations, userEmail }) {
  const [organizationId, setOrganizationId] = useState('')
  const [logs, setLogs] = useState([])
  const [userMap, setUserMap] = useState({})
  const [auditPage, setAuditPage] = useState(0)
  const [auditTotal, setAuditTotal] = useState(0)
  const AUDIT_PAGE_SIZE = 20

  async function load(targetPage = auditPage) {
    const from = targetPage * AUDIT_PAGE_SIZE
    const to = from + AUDIT_PAGE_SIZE - 1

    let query = supabase
      .from('audit_logs')
      .select('id,organization_id,actor_user_id,action,entity_type,entity_id,metadata,created_at,organizations(name)', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (organizationId) query = query.eq('organization_id', organizationId)
    query = query.range(from, to)

    const { data, count, error } = await query
    if (error) {
      setLogs([])
      setAuditTotal(0)
      return
    }

    const rows = data || []
    setLogs(rows)
    setAuditTotal(count || 0)

    const userIds = [...new Set(rows.map(x => x.actor_user_id).filter(Boolean))]
    if (userIds.length) {
      const { data: resolved } = await supabase.functions.invoke('admin_resolve_users', {
        body: { user_ids: userIds }
      })
      setUserMap(resolved?.users || {})
    } else {
      setUserMap({})
    }
  }

  useEffect(() => {
    setAuditPage(0)
    load(0)
  }, [organizationId])

  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE))

  async function goToAuditPage(nextPage) {
    const safePage = Math.min(Math.max(nextPage, 0), auditTotalPages - 1)
    if (safePage === auditPage) return
    setAuditPage(safePage)
    await load(safePage)
  }

  return (
    <>
      <AdminSectionHeader
        title="Auditoria"
        description="Alterações administrativas, filas, números e integrações."
        actions={<button className="secondary inline-btn" onClick={() => load(auditPage)}><RefreshCw size={15}/> Atualizar</button>}
      />

      <label className="admin-org-select">
        Organização
        <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
          <option value="">Todas</option>
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>

      <section className="panel">
        <div className="admin-table audit-table">
          <div className="admin-table-row head">
            <span>Data</span><span>Organização</span><span>Quem</span><span>Ação</span><span>Entidade</span>
          </div>
          {logs.map(log => (
            <div className="admin-table-row" key={log.id}>
              <span>{formatDateTime(log.created_at)}</span>
              <span>{log.organizations?.name || 'Sistema'}</span>
              <span>{log.actor_user_id ? (userMap[log.actor_user_id]?.email || log.actor_user_id.slice(0,8)) : 'Servidor'}</span>
              <span>{log.action}</span>
              <span>{log.entity_type}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="admin-pagination-v64">
        <span>
          Página <strong>{auditPage + 1}</strong> de <strong>{auditTotalPages}</strong>
          {' • '}{auditTotal} registro{auditTotal === 1 ? '' : 's'}
        </span>
        <div>
          <button
            type="button"
            className="secondary mini"
            onClick={() => goToAuditPage(auditPage - 1)}
            disabled={auditPage <= 0}
          >
            Anterior
          </button>
          <button
            type="button"
            className="secondary mini"
            onClick={() => goToAuditPage(auditPage + 1)}
            disabled={auditPage >= auditTotalPages - 1}
          >
            Próxima
          </button>
        </div>
      </div>
    </>
  )
}

function SalesPage({ organization, userEmail }) {
  const [period, setPeriod] = useState('month')
  const [customStart, setCustomStart] = useState(currentBrazilDate())
  const [customEnd, setCustomEnd] = useState(currentBrazilDate())
  const [sellerFilter, setSellerFilter] = useState('')
  const [salesRows, setSalesRows] = useState([])
  const [loadingSales, setLoadingSales] = useState(false)
  const [message, setMessage] = useState('')

  function shiftIsoDate(isoDate, days) {
    const [year, month, day] = String(isoDate).split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  }

  function resolveRange() {
    const today = currentBrazilDate()
    if (period === 'today') return { start: today, end: today }
    if (period === 'yesterday') {
      const yesterday = shiftIsoDate(today, -1)
      return { start: yesterday, end: yesterday }
    }
    if (period === 'week') {
      const [year, month, day] = today.split('-').map(Number)
      const current = new Date(Date.UTC(year, month - 1, day))
      const weekday = current.getUTCDay()
      const daysFromMonday = weekday === 0 ? 6 : weekday - 1
      return { start: shiftIsoDate(today, -daysFromMonday), end: today }
    }
    if (period === 'month') return { start: `${today.slice(0, 7)}-01`, end: today }
    if (period === 'year') return { start: `${today.slice(0, 4)}-01-01`, end: today }
    return { start: customStart, end: customEnd }
  }

  async function loadSales() {
    const { start, end } = resolveRange()
    if (!start || !end) {
      setSalesRows([])
      setMessage('Informe a data inicial e a data final do período personalizado.')
      return
    }
    if (start > end) {
      setSalesRows([])
      setMessage('A data inicial não pode ser posterior à data final.')
      return
    }

    setLoadingSales(true)
    setMessage('')
    const { data, error } = await supabase.rpc('get_sales_page', {
      p_organization_id: organization.id,
      p_start: start,
      p_end: end
    })

    if (error) {
      setSalesRows([])
      setMessage(`Não foi possível carregar as vendas: ${error.message}`)
    } else {
      setSalesRows(data || [])
    }
    setLoadingSales(false)
  }

  useEffect(() => {
    setSellerFilter('')
    loadSales()
  }, [organization.id, period, customStart, customEnd])

  const sellerOptions = Array.from(
    new Map(
      salesRows.map(row => [row.seller_id || '__unassigned__', row.seller_name || 'Não identificado'])
    ).entries()
  ).map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  const visibleSales = sellerFilter
    ? salesRows.filter(row => (row.seller_id || '__unassigned__') === sellerFilter)
    : salesRows

  const totalValue = visibleSales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)
  const averageTicket = visibleSales.length ? totalValue / visibleSales.length : 0
  const { start: rangeStart, end: rangeEnd } = resolveRange()

  function formatSaleDate(value) {
    if (!value) return '—'
    return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')
  }

  function periodLabel() {
    const labels = {
      today: 'Hoje',
      yesterday: 'Ontem',
      week: 'Semana',
      month: 'Mês',
      year: 'Ano',
      custom: 'Personalizado'
    }
    return labels[period] || 'Período'
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">COMERCIAL</span>
          <h1>Vendas</h1>
          <p className="muted">Consulte as vendas registradas por período e vendedor.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <section className="panel sales-period-panel-v62">
        <div className="sales-period-main-v62 sales-filters-v67">
          <label>
            Período das vendas
            <select value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="today">Hoje</option>
              <option value="yesterday">Ontem</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
              <option value="year">Ano</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>

          <label>
            Vendedor
            <select value={sellerFilter} onChange={e => setSellerFilter(e.target.value)}>
              <option value="">Todos os vendedores</option>
              {sellerOptions.map(seller => (
                <option key={seller.id} value={seller.id}>{seller.name}</option>
              ))}
            </select>
          </label>

          {period === 'custom' && (
            <div className="sales-custom-range-v62">
              <label>
                De
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              </label>
              <span className="sales-range-separator-v62">até</span>
              <label>
                Até
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </label>
            </div>
          )}
        </div>

        <div className="sales-period-current-v62">
          <span>{periodLabel()}</span>
          <strong>{rangeStart && rangeEnd ? `${formatSaleDate(rangeStart)} até ${formatSaleDate(rangeEnd)}` : 'Defina o período'}</strong>
        </div>
      </section>

      {message && <div className="notice error">{message}</div>}

      <section className="sales-summary-grid-v62">
        <StatCard label="Total vendido" value={formatCurrency(totalValue)} detail="Soma das vendas filtradas" />
        <StatCard label="Quantidade de vendas" value={visibleSales.length} detail="Registros filtrados" />
        <StatCard label="Ticket médio" value={formatCurrency(averageTicket)} detail="Média por venda" />
      </section>

      <section className="panel sales-list-panel-v62">
        <div className="panel-head">
          <div>
            <span className="eyebrow">VENDAS DO PERÍODO</span>
            <h2>Movimentações</h2>
          </div>
          <button type="button" className="secondary inline-btn" onClick={loadSales} disabled={loadingSales}>
            <RefreshCw size={15}/>{loadingSales ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>

        {loadingSales && !salesRows.length ? (
          <p className="muted">Carregando vendas...</p>
        ) : visibleSales.length === 0 ? (
          <div className="sales-empty-v62">
            <strong>Nenhuma venda neste filtro</strong>
            <span>Altere o período ou o vendedor para consultar outros registros.</span>
          </div>
        ) : (
          <div className="sales-table-v62 sales-table-v67">
            <div className="sales-table-row-v62 sales-table-row-v67 sales-table-head-v62">
              <span>Data</span>
              <span>Cliente</span>
              <span>Vendedor</span>
              <span>Produto / serviço</span>
              <span>Origem</span>
              <span>Valor</span>
            </div>
            {visibleSales.map(sale => (
              <div className="sales-table-row-v62 sales-table-row-v67" key={sale.id}>
                <span>{formatSaleDate(sale.sale_date)}</span>
                <span className="sales-client-v62">
                  <strong>{sale.business_name || 'Cliente'}</strong>
                  {sale.contact_name && <small>{sale.contact_name}</small>}
                </span>
                <span>{sale.seller_name || 'Não identificado'}</span>
                <span>{sale.product_service || '—'}</span>
                <span>{sale.source_label || '—'}</span>
                <strong className="sales-value-v62">{formatCurrency(sale.amount)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}


function AdminCommercialArea({ organizations, userEmail, userId }) {
  const [workspacePage, setWorkspacePage] = useState('dashboard')
  const [settings, setSettings] = useState(null)
  const [notice, setNotice] = useState('')

  const sandboxOrganization = organizations.find(
    org => org.is_sandbox === true && org.is_active
  )

  useEffect(() => {
    let active = true
    setSettings(null)
    setNotice('')

    async function loadSandboxSettings() {
      if (!sandboxOrganization?.id) return
      const { data, error } = await supabase
        .from('organization_settings')
        .select('*')
        .eq('organization_id', sandboxOrganization.id)
        .single()

      if (!active) return
      if (error) {
        setNotice(error.message || 'Não foi possível carregar a área comercial.')
        return
      }
      setSettings(data)
    }

    loadSandboxSettings()
    return () => { active = false }
  }, [sandboxOrganization?.id])

  if (!sandboxOrganization) {
    return (
      <>
        <AdminSectionHeader
          title="Área comercial"
          description="Ambiente isolado para testes e apresentações do AXIVA CRM."
        />
        <div className="notice error">
          A organização reservada para testes não foi encontrada. Nenhum dado de cliente foi acessado.
        </div>
      </>
    )
  }

  return (
    <>
      <AdminSectionHeader
        title="Área comercial"
        description="Ambiente isolado para testes e apresentações do AXIVA CRM. Tudo criado aqui pertence somente à área de testes."
      />

      <div className="notice">
        <strong>Ambiente de testes:</strong> dados criados nesta área não aparecem em Deloc, AXIVA ou em organizações de clientes.
        O WhatsApp desta organização inicia pausado por segurança.
      </div>

      <section className="panel">
        <div className="row-actions">
          <button
            className={workspacePage === 'dashboard' ? 'primary mini' : 'secondary mini'}
            onClick={() => setWorkspacePage('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={workspacePage === 'campaign-workspace' ? 'primary mini' : 'secondary mini'}
            onClick={() => setWorkspacePage('campaign-workspace')}
          >
            Campanhas
          </button>
          <button
            className={workspacePage === 'sales-funnel' ? 'primary mini' : 'secondary mini'}
            onClick={() => setWorkspacePage('sales-funnel')}
          >
            Funil de vendas
          </button>
        </div>
      </section>

      {notice && <div className="notice error">{notice}</div>}

      {!settings && !notice && <div className="notice">Carregando ambiente de testes...</div>}

      {settings && workspacePage === 'dashboard' && (
        <Dashboard
          organization={sandboxOrganization}
          settings={settings}
          userEmail={userEmail}
          onGoCampaigns={() => setWorkspacePage('campaign-workspace')}
        />
      )}

      {settings && workspacePage === 'campaign-workspace' && (
        <CampaignWorkspace
          organization={sandboxOrganization}
          settings={settings}
          userEmail={userEmail}
        />
      )}

      {settings && workspacePage === 'sales-funnel' && settings?.feature_flags?.leads !== false && (
        <SalesFunnelWorkspace
          organization={sandboxOrganization}
          settings={settings}
          userEmail={userEmail}
          userId={userId}
        />
      )}
    </>
  )
}


function AdminTestSettings({ organization, userEmail, userId }) {
  const [tab, setTab] = useState('whatsapp')
  const onlyTest = useMemo(() => organization?.is_sandbox === true ? [organization] : [], [organization?.id, organization?.is_sandbox])
  if (!onlyTest.length) return <div className="notice error">Ambiente Teste indisponível.</div>

  const tabs = [
    ['whatsapp', 'WhatsApp'], ['queue', 'Fila'], ['users', 'Usuários'],
    ['capture', 'Captação'], ['defaults', 'Padrões'], ['messages', 'Mensagens'],
    ['email', 'E-mail'], ['integrations', 'Integrações']
  ]
  return <>
    <AdminSectionHeader title="Teste · Administração" description="Gerencie apenas a organização de teste. Os parâmetros das empresas reais permanecem independentes." />
    <div className="notice">As alterações realizadas aqui se aplicam somente à empresa Teste. Enviar WhatsApp ou captar leads de verdade ainda consome os serviços e as franquias correspondentes.</div>
    <section className="panel"><div className="row-actions">
      {tabs.map(([key, label]) => <button key={key} type="button"
        className={tab === key ? 'primary mini' : 'secondary mini'}
        onClick={() => setTab(key)}>{label}</button>)}
    </div></section>
    {tab === 'whatsapp' && <AdminWhatsApp organizations={onlyTest} userEmail={userEmail} />}
    {tab === 'queue' && <AdminQueue organizations={onlyTest} />}
    {tab === 'users' && <AdminTestUsers organization={organization} adminUserId={userId} />}
    {tab === 'capture' && <><AdminTestLimits organization={organization} /><AdminGooglePlaces organizations={onlyTest} /></>}
    {tab === 'defaults' && <AdminDefaults organizations={onlyTest} />}
    {tab === 'messages' && <AdminMessages organizations={onlyTest} userEmail={userEmail} />}
    {tab === 'email' && <AdminEmailMarketing organizations={onlyTest} userEmail={userEmail} />}
    {tab === 'integrations' && <AdminIntegrations organizations={onlyTest} />}
  </>
}


function Administration({ organizations, reloadOrganizations, userEmail, userId }) {
  const [section, setSection] = useState('overview')
  const productionOrganizations = useMemo(
    () => organizations.filter(org => org.is_sandbox !== true),
    [organizations]
  )

  const items = [
    ['overview', 'Visão geral', Shield],
    ['users', 'Usuários', Users],
    ['whatsapp', 'WhatsApp', Phone],
    ['email', 'E-mail', Send],
    ['queue', 'Fila', ListChecks],
    ['catalog', 'Catálogo CRM', Tags],
    ['clients', 'Organizações', Building2],
    ['google', 'Google Places', Database],
    ['integrations', 'Integrações', Link2],
    ['defaults', 'Padrões', SlidersHorizontal],
    ['messages', 'Mensagens', MessageSquareText],
    ['audit', 'Auditoria', History]
  ]

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO DO SISTEMA</span>
          <h1>Administração</h1>
          <p className="muted">Configurações globais e gestão das organizações.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <div className="admin-shell">
        <aside className="admin-subnav">
          {items.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`admin-subnav-item ${section === key ? 'active' : ''}`}
              onClick={() => setSection(key)}
            >
              <Icon size={16}/>
              {label}
            </button>
          ))}
        </aside>

        <div className="admin-content">
          {section === 'overview' && <AdminOverview organizations={productionOrganizations} />}
          {section === 'users' && <AdminUsers organizations={productionOrganizations} userEmail={userEmail} />}
          {section === 'whatsapp' && <AdminWhatsApp organizations={organizations} userEmail={userEmail} />}
          {section === 'email' && <AdminEmailMarketing organizations={organizations} userEmail={userEmail} />}
          {section === 'queue' && <AdminQueue organizations={organizations} />}
          {section === 'catalog' && <CatalogAdmin userEmail={userEmail} />}
          {section === 'clients' && <AdminClients organizations={productionOrganizations} reloadOrganizations={reloadOrganizations} />}
          {section === 'google' && <AdminGooglePlaces organizations={organizations} />}
          {section === 'integrations' && <AdminIntegrations organizations={organizations} />}
          {section === 'defaults' && <AdminDefaults organizations={organizations} />}
          {section === 'messages' && <AdminMessages organizations={organizations} userEmail={userEmail} />}
          {section === 'audit' && <AdminAudit organizations={productionOrganizations} userEmail={userEmail} />}
        </div>
      </div>
    </>
  )
}



export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [accessLoading, setAccessLoading] = useState(true)
  const [organization, setOrganization] = useState(null)
  const [settings, setSettings] = useState(null)
  const [accountStatus, setAccountStatus] = useState('active')
  const [userDisplayName, setUserDisplayName] = useState('')
  const [isSystemAdmin, setIsSystemAdmin] = useState(false)
  const [adminOrganizations, setAdminOrganizations] = useState([])
  const [page, setPage] = useState('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [systemAdminView, setSystemAdminView] = useState('administration')
  const [adminCommercialPage, setAdminCommercialPage] = useState('dashboard')
  const [adminSandboxSettings, setAdminSandboxSettings] = useState(null)

  const sandboxOrganization = useMemo(
    () => adminOrganizations.find(org => org.is_sandbox === true && org.is_active),
    [adminOrganizations]
  )
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') resetOverdueLoginAlerts()
      setSession(newSession)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setOrganization(null)
      setSettings(null)
      setAccountStatus('active')
      setUserDisplayName('')
      setIsSystemAdmin(false)
      setAccessLoading(false)
      return
    }

    let cancelled = false

    async function loadAccess() {
      setAccessLoading(true)

      const [profileResult, membershipResult, adminResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('account_status,full_name')
          .eq('id', session.user.id)
          .maybeSingle(),
        supabase
          .from('organization_members')
          .select('organization_id,role,is_active,organizations(id,name,is_active)')
          .eq('user_id', session.user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('system_admins')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle()
      ])

      if (cancelled) return

      const status = profileResult.data?.account_status || 'active'
      const displayName = profileResult.data?.full_name?.trim() || session.user.user_metadata?.full_name?.trim() || ''
      const platformAdmin = Boolean(adminResult.data)

      setAccountStatus(status)
      setUserDisplayName(displayName)
      setIsSystemAdmin(platformAdmin)

      if (platformAdmin) {
        // Administradores do sistema permanecem na área administrativa mesmo
        // quando também são membros da organização isolada de testes.
        setOrganization(null)
        setSettings(null)
      } else if (!membershipResult.error && membershipResult.data?.organizations?.is_active) {
        setOrganization(membershipResult.data.organizations)
      } else {
        setOrganization(null)
        setSettings(null)
      }

      setAccessLoading(false)
    }

    loadAccess()

    return () => {
      cancelled = true
    }
  }, [session?.user?.id])

  async function loadAdminOrganizations() {
    if (!isSystemAdmin || accountStatus !== 'active') {
      setAdminOrganizations([])
      return
    }

    const { data } = await supabase
      .from('organizations')
      .select('id,name,is_active,is_sandbox,created_at,created_by')
      .order('created_at', { ascending: true })

    setAdminOrganizations(data || [])
  }

  useEffect(() => {
    loadAdminOrganizations()
  }, [isSystemAdmin, accountStatus])

  useEffect(() => {
    let active = true

    if (!isSystemAdmin || accountStatus !== 'active' || !sandboxOrganization?.id) {
      setAdminSandboxSettings(null)
      return () => { active = false }
    }

    setAdminSandboxSettings(null)
    supabase
      .from('organization_settings')
      .select('*')
      .eq('organization_id', sandboxOrganization.id)
      .single()
      .then(({ data, error }) => {
        if (!active) return
        setAdminSandboxSettings(error ? null : data)
      })

    return () => { active = false }
  }, [isSystemAdmin, accountStatus, sandboxOrganization?.id, adminCommercialPage])

  useEffect(() => {
    if (!organization?.id || accountStatus !== 'active') {
      setSettings(null)
      return
    }

    supabase
      .from('organization_settings')
      .select('*')
      .eq('organization_id', organization.id)
      .single()
      .then(({ data }) => setSettings(data))
  }, [organization?.id, accountStatus])

  async function logout() {
    await supabase.auth.signOut()
  }

  if (loading || (session && accessLoading && !passwordRecovery)) {
    return <div className="loading-screen">Carregando...</div>
  }

  if (passwordRecovery && session) {
    return <ResetPasswordScreen onDone={() => setPasswordRecovery(false)} />
  }

  if (!session) return <AuthScreen />

  const userEmail = session.user.email
  const userLabel = userDisplayName || userEmail

  if (accountStatus !== 'active') {
    return (
      <BlockedAccessScreen
        status={accountStatus}
        email={userEmail}
        onLogout={logout}
      />
    )
  }

  if (isSystemAdmin && !organization) {
    const commercialMode = systemAdminView === 'commercial'

    return (
      <div className={`app-shell ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
        <button
          className="mobile-menu-button"
          type="button"
          aria-label="Abrir menu"
          onClick={() => setMobileMenuOpen(true)}
        >
          <Menu size={22} />
        </button>

        {mobileMenuOpen && (
          <button
            className="mobile-menu-backdrop"
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          <button
            className="mobile-menu-close"
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X size={22} />
          </button>

          <div className="sidebar-brand">
            <div className="brand-mark small">CP</div>
            <div>
              <strong>CRM Prospecção</strong>
              <span>{commercialMode ? (sandboxOrganization?.name || 'Área comercial') : 'Administração'}</span>
            </div>
          </div>

          <nav>
            {commercialMode ? (
              <>
                <button
                  className={`nav-item ${adminCommercialPage === 'dashboard' ? 'active' : ''}`}
                  onClick={() => { setAdminCommercialPage('dashboard'); setMobileMenuOpen(false) }}
                >
                  <Building2 size={18}/> Dashboard
                </button>
                <button
                  className={`nav-item ${adminCommercialPage === 'campaign-workspace' ? 'active' : ''}`}
                  onClick={() => { setAdminCommercialPage('campaign-workspace'); setMobileMenuOpen(false) }}
                >
                  <Target size={18}/> Campanhas
                </button>
                <button
                  className={`nav-item ${adminCommercialPage === 'sales-funnel' ? 'active' : ''}`}
                  onClick={() => { setAdminCommercialPage('sales-funnel'); setMobileMenuOpen(false) }}
                >
                  <Users size={18}/> Funil de vendas
                </button>
                <button
                  className={`nav-item ${adminCommercialPage === 'sales' ? 'active' : ''}`}
                  onClick={() => { setAdminCommercialPage('sales'); setMobileMenuOpen(false) }}
                ><Activity size={18}/> Vendas</button>
                {sandboxOrganization && <OverdueReturnsNavItem
                  organization={sandboxOrganization}
                  active={adminCommercialPage === 'overdue-returns'}
                  onOpen={() => { setAdminCommercialPage('overdue-returns'); setMobileMenuOpen(false) }}
                />}
                <button
                  className={`nav-item ${adminCommercialPage === 'test-settings' ? 'active' : ''}`}
                  onClick={() => { setAdminCommercialPage('test-settings'); setMobileMenuOpen(false) }}
                ><Settings size={18}/> Configurações do Teste</button>
                <button
                  className="nav-item"
                  onClick={() => { setSystemAdminView('administration'); setMobileMenuOpen(false) }}
                >
                  <Shield size={18}/> Administração
                </button>
              </>
            ) : (
              <>
                <button
                  className="nav-item"
                  onClick={() => { setSystemAdminView('commercial'); setAdminCommercialPage('dashboard'); setMobileMenuOpen(false) }}
                >
                  <Building2 size={18}/> Teste
                </button>
                <button className="nav-item active">
                  <Shield size={18}/> Administração
                </button>
              </>
            )}
          </nav>

          <button className="nav-item logout" onClick={() => { setMobileMenuOpen(false); logout() }}>
            <LogOut size={18}/> Sair
          </button>
        </aside>

        <main className="content">
          {commercialMode && sandboxOrganization && adminSandboxSettings && (
            <OverdueReturnsAlert
              organization={sandboxOrganization}
              userId={session.user.id}
              onOpen={() => { setAdminCommercialPage('overdue-returns'); setMobileMenuOpen(false) }}
            />
          )}
          {!commercialMode && (
            <Administration
              organizations={adminOrganizations}
              reloadOrganizations={loadAdminOrganizations}
              userEmail={userEmail}
              userId={session.user.id}
            />
          )}

          {commercialMode && !sandboxOrganization && (
            <>
              <header className="topbar">
                <div>
                  <span className="eyebrow">ÁREA COMERCIAL</span>
                  <h1>Ambiente de testes indisponível</h1>
                  <p className="muted">A organização sandbox não foi encontrada.</p>
                </div>
              </header>
              <div className="notice error">Nenhum dado de cliente foi acessado.</div>
            </>
          )}

          {commercialMode && sandboxOrganization && !adminSandboxSettings && (
            <div className="loading-screen">Carregando área comercial...</div>
          )}

          {commercialMode && sandboxOrganization && adminSandboxSettings && adminCommercialPage === 'dashboard' && (
            <Dashboard
              organization={sandboxOrganization}
              settings={adminSandboxSettings}
              userEmail={userEmail}
              onGoCampaigns={() => setAdminCommercialPage('campaign-workspace')}
            />
          )}

          {commercialMode && sandboxOrganization && adminSandboxSettings && adminCommercialPage === 'campaign-workspace' && (
            <CampaignWorkspace
              organization={sandboxOrganization}
              settings={adminSandboxSettings}
              userEmail={userEmail}
            />
          )}

          {commercialMode && sandboxOrganization && adminSandboxSettings && adminCommercialPage === 'sales-funnel' && adminSandboxSettings?.feature_flags?.leads !== false && (
            <SalesFunnelWorkspace
              organization={sandboxOrganization}
              settings={adminSandboxSettings}
              userEmail={userEmail}
              userId={session.user.id}
            />
          )}
          {commercialMode && sandboxOrganization && adminSandboxSettings && adminCommercialPage === 'sales' && (
            <SalesPage organization={sandboxOrganization} userEmail={userEmail} />
          )}
          {commercialMode && sandboxOrganization && adminSandboxSettings && adminCommercialPage === 'overdue-returns' && (
            <OverdueReturnsPage organization={sandboxOrganization} userEmail={userEmail}
              onOpenLead={lead => {
                sessionStorage.setItem('crm_focus_lead', JSON.stringify({ id: lead.id, business_name: lead.business_name }))
                setAdminCommercialPage('sales-funnel')
              }} />
          )}
          {commercialMode && sandboxOrganization && adminSandboxSettings && adminCommercialPage === 'test-settings' && (
            <AdminTestSettings organization={sandboxOrganization} userEmail={userEmail} userId={session.user.id} />
          )}
        </main>
      </div>
    )
  }

  if (!organization) {
    return (
      <WaitingAccessScreen
        email={userEmail}
        onLogout={logout}
      />
    )
  }

  return (
    <div className={`app-shell ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>

      <button
        className="mobile-menu-button"
        type="button"
        aria-label="Abrir menu"
        onClick={() => setMobileMenuOpen(true)}
      >
        <Menu size={22} />
      </button>

      {mobileMenuOpen && (
        <button
          className="mobile-menu-backdrop"
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <button
          className="mobile-menu-close"
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMobileMenuOpen(false)}
        >
          <X size={22} />
        </button>
        <div className="sidebar-brand">
          <div className="brand-mark small">CP</div>
          <div>
            <strong>CRM Prospecção</strong>
            <span>{organization.name}</span>
          </div>
        </div>

        <nav>
          <button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => { setPage('dashboard'); setMobileMenuOpen(false) }}>
            <Building2 size={18}/> Dashboard
          </button>
          <button className={`nav-item ${page === 'campaign-workspace' ? 'active' : ''}`} onClick={() => { setPage('campaign-workspace'); setMobileMenuOpen(false) }}>
            <Target size={18}/> Campanhas
          </button>
          <button className={`nav-item ${page === 'sales-funnel' ? 'active' : ''}`} onClick={() => { setPage('sales-funnel'); setMobileMenuOpen(false) }}>
            <Users size={18}/> Funil de vendas
          </button>
          <button className={`nav-item ${page === 'sales' ? 'active' : ''}`} onClick={() => { setPage('sales'); setMobileMenuOpen(false) }}>
            <Activity size={18}/> Vendas
          </button>
          <OverdueReturnsNavItem
            organization={organization}
            active={page === 'overdue-returns'}
            onOpen={() => { setPage('overdue-returns'); setMobileMenuOpen(false) }}
          />

          {isSystemAdmin && (
            <>
              <button className={`nav-item ${page === 'platform-sales' ? 'active' : ''}`} onClick={() => { setPage('platform-sales'); setMobileMenuOpen(false) }}>
                <Activity size={18}/> Vendas
              </button>
              <button className={`nav-item ${page === 'administration' ? 'active' : ''}`} onClick={() => { setPage('administration'); setMobileMenuOpen(false) }}>
                <Shield size={18}/> Administração
              </button>
            </>
          )}
        </nav>

        <button className="nav-item logout" onClick={() => { setMobileMenuOpen(false); logout() }}>
          <LogOut size={18}/> Sair
        </button>
      </aside>

      <main className="content">
        <OverdueReturnsAlert organization={organization} userId={session.user.id} onOpen={() => setPage('overdue-returns')} />
        {page === 'dashboard' && (
          <Dashboard
            organization={organization}
            settings={settings}
            userEmail={userLabel}
            onGoCampaigns={() => setPage('campaign-workspace')}
          />
        )}
        {page === 'campaign-workspace' && (
          <CampaignWorkspace organization={organization} settings={settings} userEmail={userLabel} />
        )}
        {page === 'sales' && (
          <SalesPage organization={organization} userEmail={userLabel} />
        )}
        {page === 'sales-funnel' && settings?.feature_flags?.leads !== false && (
          <SalesFunnelWorkspace
            organization={organization}
            settings={settings}
            userEmail={userLabel}
            userId={session.user.id}
          />
        )}
        {page === 'overdue-returns' && (
          <OverdueReturnsPage
            organization={organization}
            userEmail={userLabel}
            onOpenLead={(lead) => {
              sessionStorage.setItem('crm_focus_lead', JSON.stringify({ id: lead.id, business_name: lead.business_name }))
              setPage('sales-funnel')
            }}
          />
        )}
        {page === 'platform-sales' && isSystemAdmin && (
          <PlatformSalesOverview userEmail={userEmail} />
        )}
        {page === 'administration' && isSystemAdmin && (
          <Administration
            organizations={adminOrganizations}
            reloadOrganizations={loadAdminOrganizations}
            userEmail={userEmail}
            userId={session.user.id}
          />
        )}
      </main>
    </div>
  )
}
