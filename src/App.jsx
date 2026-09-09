import React, { useEffect, useMemo, useState } from 'react'
import {
  LogOut, Building2, Users, Search, MessageSquareText, Settings,
  ChevronRight, Plus, Target, Trash2, ClipboardCopy, Tags, Send,
  Phone, ListChecks, Shield, Database, SlidersHorizontal, History,
  Pause, Play, RefreshCw, XCircle, CheckCircle2, Activity, UserPlus,
  Save, ChevronDown, Menu, X
} from 'lucide-react'
import { supabase } from './lib/supabase'

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

function formatPhone(value) {
  if (!value) return '—'
  return String(value)
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
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.fullName } }
        })
        if (error) throw error
        setMessage('Cadastro criado. Se a confirmação de e-mail estiver ativa, confirme pelo link recebido.')
      } else {
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
        <p className="muted">Encontre e acompanhe potenciais clientes.</p>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Entrar</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Criar conta</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              Nome
              <input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Seu nome" required />
            </label>
          )}
          <label>
            E-mail
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="voce@empresa.com.br" required />
          </label>
          <label>
            Senha
            <input type="password" minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mínimo de 6 caracteres" required />
          </label>
          <button className="primary full" disabled={loading}>
            {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
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

function Dashboard({ organization, settings, userEmail, onGoCampaigns }) {
  const [stats, setStats] = useState({ total: 0, qualified: 0, queue: 0, replied: 0 })

  useEffect(() => {
    async function loadStats() {
      const { data, error } = await supabase
        .from('leads')
        .select('status')
        .eq('organization_id', organization.id)

      if (error) return

      const rows = data || []
      setStats({
        total: rows.length,
        qualified: rows.filter(x => !['discarded','lost'].includes(x.status)).length,
        queue: rows.filter(x => ['qualified', 'queued'].includes(x.status)).length,
        replied: rows.filter(x => ['replied', 'interested'].includes(x.status)).length
      })
    }
    loadStats()
  }, [organization.id])

  const cadence = useMemo(() => {
    if (!settings?.default_cadence_days) return 'Seg • Qua • Sex'
    const names = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' }
    return settings.default_cadence_days.map(d => names[d] ?? d).join(' • ')
  }, [settings])

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">PAINEL</span>
          <h1>Dashboard</h1>
          <p className="muted">Visão geral da operação de prospecção.</p>
        </div>
        <div className="topbar-actions">
          <div className="user-badge">{userEmail}</div>
        </div>
      </header>

      <section className="stats-grid">
        <StatCard label="Leads encontrados" value={stats.total} detail="Total na base" />
        <StatCard label="Leads válidos" value={stats.qualified} detail="Dentro dos critérios objetivos" />
        <StatCard label="Na fila" value={stats.queue} detail="Prontos para prospecção" />
        <StatCard label="Responderam" value={stats.replied} detail="Leads com retorno" />
      </section>

      <section className="panel-grid">
        <article className="panel clickable" onClick={onGoCampaigns}>
          <div className="panel-head">
            <div>
              <span className="eyebrow">PROSPECÇÃO</span>
              <h2>Campanhas</h2>
            </div>
            <ChevronRight />
          </div>
          <p>Defina o público-alvo e a região de cada operação de busca.</p>
          <div className="tag-row"><span>Públicos personalizados</span><span>Raio geográfico</span><span>Busca automática</span></div>
        </article>

        <article className="panel">
          <span className="eyebrow">CONFIGURAÇÃO ATUAL</span>
          <h2>Operação</h2>
          <dl className="summary-list">
            <div><dt>Região</dt><dd>{settings?.default_city || '—'} / {settings?.default_state || '—'}</dd></div>
            <div><dt>Raio</dt><dd>{settings?.default_radius_km ?? '—'} km</dd></div>
            <div><dt>Cadência</dt><dd>{cadence}</dd></div>
            <div><dt>Limite diário</dt><dd>{settings?.default_daily_contact_limit ?? 20}</dd></div>
            <div><dt>Cota Places</dt><dd>{settings?.google_places_monthly_quota ?? 900}/mês</dd></div>
          </dl>
        </article>
      </section>
    </>
  )
}



function CatalogAdmin({ userEmail }) {
  const [segments, setSegments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
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

      <section className="campaign-list">
        {segments.map(segment => {
          const terms = (segment.catalog_segment_terms || [])
            .filter(t => t.is_active)
            .sort((a,b) => a.sort_order - b.sort_order)

          return (
            <article className="panel catalog-card" key={segment.id}>
              <div>
                <span className="eyebrow">{segment.is_active ? 'ATIVO' : 'INATIVO'}</span>
                <h2>{segment.name}</h2>
                <p>{segment.description || 'Sem descrição'}</p>

                <div className="catalog-term-groups">
                  <div>
                    <strong>Recomendados</strong>
                    <div className="tag-row">
                      {terms.filter(t => t.is_recommended).map(t => (
                        <span key={t.id}>{t.term}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <strong>Outros</strong>
                    <div className="tag-row">
                      {terms.filter(t => !t.is_recommended).map(t => (
                        <span key={t.id}>{t.term}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="message-card-actions">
                <button className="secondary" onClick={() => startEdit(segment)}>Editar</button>
                <button className="secondary" onClick={() => toggleCatalogSegment(segment)}>
                  {segment.is_active ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            </article>
          )
        })}
      </section>
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
                <span className="eyebrow">{segment.is_active ? 'ATIVO' : 'INATIVO'}</span>
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
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    name: '',
    target_segment_id: '',
    city: settings?.default_city || 'Campinas',
    state: settings?.default_state || 'SP',
    radius_km: settings?.default_radius_km || 30,
    daily_contact_limit: settings?.default_daily_contact_limit || 20
  })

  async function loadData() {
    const [{data: campaignData}, {data: segmentData}] = await Promise.all([
      supabase
        .from('campaigns')
        .select('*, target_segments(name)')
        .eq('organization_id', organization.id)
        .order('created_at', {ascending:false}),
      supabase
        .from('target_segments')
        .select('id,name,is_active')
        .eq('organization_id', organization.id)
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

  async function saveCampaign(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const selected = segments.find(s => s.id === form.target_segment_id)

    const { error } = await supabase.from('campaigns').insert({
      organization_id: organization.id,
      name: form.name.trim(),
      target_segment_id: form.target_segment_id,
      segment: selected?.name || 'Público personalizado',
      city: form.city.trim(),
      state: form.state,
      radius_km: Number(form.radius_km),
      daily_contact_limit: Number(form.daily_contact_limit),
      cadence_days: [1,3,5],
      status: 'draft',
      search_term_cursor: 0
    })

    if (error) setMessage(error.message)
    else {
      setMessage('Campanha criada com sucesso.')
      setForm(old => ({...old, name:''}))
      setShowForm(false)
      await loadData()
    }
    setLoading(false)
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
          <button className="primary inline-btn" onClick={() => setShowForm(!showForm)} disabled={!segments.length}>
            <Plus size={17}/> Nova campanha
          </button>
        </div>
      </header>

      {!segments.length && (
        <div className="notice">Crie pelo menos um público-alvo antes de criar uma campanha.</div>
      )}

      {showForm && (
        <section className="panel campaign-form-panel">
          <span className="eyebrow">NOVA CAMPANHA</span>
          <h2>Configurar prospecção</h2>
          <form onSubmit={saveCampaign} className="campaign-form">
            <label>Nome da campanha
              <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}
                placeholder="Ex.: Clínicas Campinas" required />
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
              <label>Raio (km)
                <input type="number" min="1" max="50" value={form.radius_km}
                  onChange={e=>setForm({...form,radius_km:e.target.value})} required />
              </label>
            </div>
            <label>Limite de contatos/dia
              <input type="number" min="1" max="100" value={form.daily_contact_limit}
                onChange={e=>setForm({...form,daily_contact_limit:e.target.value})} required />
            </label>
            <div className="settings-preview">
              <div><strong>Filtro:</strong> público + raio + empresa operacional + duplicidade</div>
              <div><strong>Cadência:</strong> segunda, quarta e sexta</div>
              <div><strong>Busca:</strong> termos do público alternados automaticamente</div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={()=>setShowForm(false)}>Cancelar</button>
              <button className="primary" disabled={loading}>{loading?'Salvando...':'Salvar campanha'}</button>
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
              <h2>{c.name}</h2>
              <p>{c.city} / {c.state} • raio de {c.radius_km} km</p>
            </div>
            <div className="campaign-meta">
              <span>{c.daily_contact_limit}/dia</span>
              <span className="status-draft">Rascunho</span>
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

function Leads({ organization, settings, userEmail }) {
  const [leads, setLeads] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [targetSegments, setTargetSegments] = useState([])
  const [templates, setTemplates] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState({ search: '', segment: 'all', status: 'all' })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
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
    status: 'new'
  })

  async function loadData() {
    const [
      { data: leadData, error: leadError },
      { data: campaignData },
      { data: targetData },
      { data: templateData }
    ] = await Promise.all([
      supabase.from('leads').select('*, campaigns(name), target_segments(name)').eq('organization_id',organization.id).order('created_at',{ascending:false}),
      supabase.from('campaigns').select('id,name,target_segment_id,target_segments(name)').eq('organization_id',organization.id).order('created_at',{ascending:false}),
      supabase.from('target_segments').select('id,name').eq('organization_id',organization.id).eq('is_active',true).order('name'),
      supabase.from('message_templates').select('*').eq('organization_id',organization.id).eq('is_active',true).order('created_at',{ascending:false})
    ])

    if (!leadError) setLeads(leadData || [])
    setCampaigns(campaignData || [])
    setTargetSegments(targetData || [])
    setTemplates(templateData || [])
    if (!form.segment && targetData?.length) {
      setForm(old => ({ ...old, segment: targetData[0].id }))
    }
  }

  useEffect(() => {
    let active = true

    loadData()

    async function refreshLeadStatuses() {
      const { data, error } = await supabase
        .from('leads')
        .select('id,status,last_contact_date,commercial_notes')
        .eq('organization_id', organization.id)

      if (error || !active) return

      const leadUpdates = new Map((data || []).map(item => [item.id, item]))

      setLeads(old =>
        old.map(lead => {
          const next = leadUpdates.get(lead.id)
          if (!next) return lead

          return {
            ...lead,
            status: next.status ?? lead.status,
            last_contact_date: next.last_contact_date ?? lead.last_contact_date,
            commercial_notes: next.commercial_notes ?? lead.commercial_notes
          }
        })
      )
    }

    const timer = setInterval(refreshLeadStatuses, 3000)

    function handleFocus() {
      refreshLeadStatuses()
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
    }
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
        next_contact_date:''
      }))
      await loadData()
    }
    setLoading(false)
  }

  async function updateStatus(id, status) {
    const { error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', id)
      .eq('organization_id', organization.id)
    if (!error) setLeads(old => old.map(l => l.id === id ? { ...l, status } : l))
  }


  async function updateLeadContactField(id, field, value) {
    const allowed = ['contact_name', 'last_contact_date', 'next_contact_date', 'commercial_notes']
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
    const confirmed = window.confirm(
      `Excluir definitivamente "${businessName}"?\n\nAo excluir, esse lead poderá ser encontrado novamente em uma futura captação automática.`
    )
    if (!confirmed) return

    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', id)
      .eq('organization_id', organization.id)

    if (!error) {
      setLeads(old => old.filter(l => l.id !== id))
      setSelected(old => {
        const next = new Set(old)
        next.delete(id)
        return next
      })
    }
  }


  const visibleLeads = leads.filter(l => {
    const q = filter.search.trim().toLowerCase()
    const matchSearch = !q ||
      (l.business_name || '').toLowerCase().includes(q) ||
      (l.city || '').toLowerCase().includes(q) ||
      (l.phone || '').toLowerCase().includes(q)
    const matchSegment = filter.segment === 'all' || l.target_segment_id === filter.segment
    const matchStatus = filter.status === 'all' || l.status === filter.status
    return matchSearch && matchSegment && matchStatus
  })

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

  function toggleAllVisible() {
    const allSelected = eligibleVisibleLeads.length > 0 && eligibleVisibleLeads.every(l => selected.has(l.id))
    setSelected(old => {
      const next = new Set(old)
      if (allSelected) {
        eligibleVisibleLeads.forEach(l => next.delete(l.id))
      } else {
        const available = Math.max(batchLimit - next.size, 0)
        eligibleVisibleLeads
          .filter(l => !next.has(l.id))
          .slice(0, available)
          .forEach(l => next.add(l.id))
        if (eligibleVisibleLeads.length > available) {
          setMessage(`Foram selecionados até ${batchLimit} leads, conforme o limite atual do lote.`)
        }
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


  const statusLabel = {
    new: 'Novo',
    qualified: 'Qualificado',
    queued: 'Na fila',
    contacted: 'Contatado',
    replied: 'Respondeu',
    interested: 'Interessado',
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
          <button className="primary inline-btn" onClick={() => setShowForm(!showForm)}><Plus size={17}/> Novo lead</button>
        </div>
      </header>

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
          {Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
      </section>

      <section className="bulk-toolbar">
        <label className="select-all">
          <input
            type="checkbox"
            checked={eligibleVisibleLeads.length > 0 && eligibleVisibleLeads.every(l => selected.has(l.id))}
            onChange={toggleAllVisible}
          />
          Selecionar todos os filtrados
        </label>
        <div className="bulk-actions">
          <span>{selected.size} selecionado{selected.size === 1 ? '' : 's'}</span>
          <button className="primary inline-btn" onClick={sendSelectedMessages} disabled={!selected.size}>
            <Send size={16}/> {loading ? 'Enviando...' : 'Enviar mensagem'}
          </button>
        </div>
      </section>

      <section className="lead-list">
        {visibleLeads.length===0 ? (
          <article className="panel empty-state"><Users size={34}/><h2>Nenhum lead encontrado</h2><p>Use a captação automática ou cadastre um lead manualmente.</p></article>
        ) : visibleLeads.map(l=>(
          <article className="panel lead-card selectable-lead" key={l.id}>
            <div className="lead-select-box">
              <input
                type="checkbox"
                checked={selected.has(l.id)}
                onChange={()=>toggleSelected(l.id)}
                disabled={l.status === 'discarded'}
                aria-label={`Selecionar ${l.business_name}`}
              />
            </div>

            <div className="lead-main">
              <div className="lead-title-row">
                <div>
                  <span className="eyebrow">{l.target_segments?.name || l.segment}</span>
                  <h2>{l.business_name}</h2>
                </div>
              </div>

              <div className="lead-info-grid">
                <div><span>Cidade</span><strong>{l.city || '—'}{l.state ? ` / ${l.state}` : ''}</strong></div>
                <div><span>Telefone</span><strong>{l.phone || '—'}</strong></div>
                <div><span>Campanha</span><strong>{l.campaigns?.name || 'Sem campanha'}</strong></div>
                <div>
                  <span>Site</span>
                  {l.website ? <a className="lead-site-link" href={l.website} target="_blank" rel="noreferrer">Abrir site</a> : <strong>—</strong>}
                </div>
              </div>

              <div className="lead-contact-fields">
                <label>
                  <span>Nome do contato</span>
                  <input
                    value={l.contact_name || ''}
                    onChange={e => setLeads(old => old.map(item =>
                      item.id === l.id ? { ...item, contact_name: e.target.value } : item
                    ))}
                    onBlur={e => updateLeadContactField(l.id, 'contact_name', e.target.value.trim())}
                    placeholder="Nome do responsável"
                  />
                </label>

                <label>
                  <span>Último contato</span>
                  <input
                    type="date"
                    value={l.last_contact_date || ''}
                    onChange={e => {
                      const value = e.target.value
                      setLeads(old => old.map(item =>
                        item.id === l.id ? { ...item, last_contact_date: value } : item
                      ))
                      updateLeadContactField(l.id, 'last_contact_date', value)
                    }}
                  />
                </label>

                <label className={l.next_contact_date && l.next_contact_date < currentBrazilDate() ? 'next-contact-overdue' : ''}>
                  <span>
                    Próximo contato previsto
                    {l.next_contact_date && l.next_contact_date < currentBrazilDate() && (
                      <strong className="overdue-badge">Atrasado</strong>
                    )}
                  </span>
                  <input
                    type="date"
                    value={l.next_contact_date || ''}
                    onChange={e => {
                      const value = e.target.value
                      setLeads(old => old.map(item =>
                        item.id === l.id ? { ...item, next_contact_date: value } : item
                      ))
                      updateLeadContactField(l.id, 'next_contact_date', value)
                    }}
                  />
                </label>
              </div>

              {(l.status === 'interested' || (l.commercial_notes || '').trim()) && (
                <div className="lead-commercial-notes">
                  <label>
                    <span>Anotações comerciais</span>
                    <textarea
                      className="lead-notes-textarea"
                      value={l.commercial_notes || ''}
                      onChange={e => setLeads(old => old.map(item =>
                        item.id === l.id ? { ...item, commercial_notes: e.target.value } : item
                      ))}
                      onBlur={e => updateLeadContactField(l.id, 'commercial_notes', e.target.value.trim())}
                      placeholder="Registre necessidades, objeções, decisores, orçamento, próximos passos ou outras informações relevantes."
                    />
                  </label>
                  <p className="field-help">Esta anotação permanece mesmo se o status mudar e continuará disponível quando o lead se tornar cliente.</p>
                </div>
              )}
            </div>

            <div className="lead-status-box">
              <label>Status
                <select value={l.status} onChange={e=>updateStatus(l.id,e.target.value)}>
                  {Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <div className="lead-actions-secondary">
                <button type="button" className="text-danger" onClick={()=>deleteLead(l.id,l.business_name)} title="Remove o registro definitivamente">
                  <Trash2 size={14}/> Excluir definitivamente
                </button>
              </div>
            </div>
          </article>
        ))}
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
      amount: String(sale.amount || ''),
      product_service: sale.product_service || '',
      notes: sale.notes || ''
    })
  }

  async function saveSale(e) {
    e.preventDefault()
    if (!selectedClient) return
    const amount = Number(String(saleForm.amount).replace(',', '.'))
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
    if (!window.confirm(`Excluir a venda de ${formatCurrency(sale.amount)} registrada em ${sale.sale_date}?`)) return
    const { error } = await supabase
      .from('sales')
      .delete()
      .eq('id', sale.id)
      .eq('lead_id', sale.lead_id)
      .eq('organization_id', organization.id)

    if (error) setMessage(`Não foi possível excluir a venda: ${error.message}`)
    else {
      if (saleForm.id === sale.id) resetSaleForm()
      setMessage('Venda excluída do histórico.')
      await loadData(selectedClient?.id || null)
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
            <p className="muted">Cadastro, relacionamento e histórico comercial em um único lugar.</p>
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
            <p className="field-help">Estas anotações acompanham o mesmo registro do lead e não são perdidas na conversão para cliente.</p>
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
                <label>Valor (R$)<input type="number" min="0.01" step="0.01" value={saleForm.amount} onChange={e => setSaleForm({...saleForm,amount:e.target.value})} required /></label>
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
                    <button type="button" className="text-danger" onClick={() => deleteSale(sale)}><Trash2 size={14}/> Excluir</button>
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
          <p className="muted">Leads marcados como Ganho aparecem aqui automaticamente.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

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
                <span className="eyebrow">{client.segment || 'Cliente'}</span>
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
      supabase.from('target_segments').select('id,name').eq('organization_id',organization.id).eq('is_active',true).order('name')
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
            </div>
          </article>
        ))}
      </section>
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
      const [
        { count: leadsCount },
        { count: campaignsCount },
        { count: queuedCount },
        { count: failedCount },
        { count: sentCount },
        { count: numbersCount }
      ] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true }),
        supabase.from('campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).in('status', ['queued', 'ready', 'pending']),
        supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
        supabase.from('whatsapp_numbers').select('id', { count: 'exact', head: true })
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
    if (!window.confirm(`Excluir o número ${number.alias} (${number.phone_e164})?`)) return

    if (number.evolution_instance_name) {
      try {
        await evolutionAction('delete_instance', { number_id: number.id })
      } catch (error) {
        if (!window.confirm(`A Evolution API respondeu: ${error.message}. Deseja excluir o cadastro do CRM mesmo assim?`)) return
      }
    }

    const { error } = await supabase.from('whatsapp_numbers').delete().eq('id', number.id)
    if (error) setMessage(error.message)
    else {
      setMessage('Número excluído.')
      const remaining = numbers.filter(n => n.id !== number.id)
      if (number.is_default && remaining.length) await setDefault(remaining[0].id)
      else await load()
    }
  }

  async function saveSettings() {
    if (!settings) return
    const payload = {
      whatsapp_send_interval_seconds: Math.max(1, Number(settings.whatsapp_send_interval_seconds || 120)),
      whatsapp_batch_limit: Math.max(1, Number(settings.whatsapp_batch_limit || 20)),
      whatsapp_daily_send_limit:
        settings.whatsapp_daily_send_limit === '' || settings.whatsapp_daily_send_limit == null
          ? null
          : Math.max(1, Number(settings.whatsapp_daily_send_limit)),
      whatsapp_sending_paused: Boolean(settings.whatsapp_sending_paused)
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
    if (!window.confirm(`Excluir definitivamente o usuário ${item.email}?`)) return
    await runAction(
      { action: 'delete_user', user_id: item.id },
      'Usuário excluído.'
    )
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

                <span>
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

      <section className="campaign-list">
        {organizations.map(org => (
          <article className="panel campaign-card" key={org.id}>
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
    const flags = settings.feature_flags || {}
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
        allowed_send_end: settings.allowed_send_end || null,
        feature_flags: flags
      })
      .eq('organization_id', organizationId)

    setNotice(error ? error.message : 'Configurações padrão salvas.')
    if (!error) await load()
  }

  function toggleFeature(key) {
    setSettings(old => ({
      ...old,
      feature_flags: {
        ...(old.feature_flags || {}),
        [key]: !(old.feature_flags || {})[key]
      }
    }))
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
                <input type="time" value={settings.allowed_send_start || ''} onChange={e => setSettings({...settings, allowed_send_start: e.target.value})} />
              </label>
              <label>
                Horário permitido — fim
                <input type="time" value={settings.allowed_send_end || ''} onChange={e => setSettings({...settings, allowed_send_end: e.target.value})} />
              </label>
            </div>
          </section>

          <section className="panel">
            <span className="eyebrow">FUNCIONALIDADES</span>
            <h2>Liberadas para o cliente</h2>
            <div className="feature-grid">
              {[
                ['capture', 'Captação'],
                ['campaigns', 'Campanhas'],
                ['leads', 'Leads'],
                ['messages', 'Mensagens'],
                ['whatsapp', 'WhatsApp']
              ].map(([key, label]) => (
                <label className="toggle-card" key={key}>
                  <input
                    type="checkbox"
                    checked={(settings.feature_flags || {})[key] !== false}
                    onChange={() => toggleFeature(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <button className="primary inline-btn" onClick={save}><Save size={16}/> Salvar configurações</button>
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

function AdminAudit({ organizations, userEmail }) {
  const [organizationId, setOrganizationId] = useState('')
  const [logs, setLogs] = useState([])
  const [userMap, setUserMap] = useState({})

  async function load() {
    let query = supabase
      .from('audit_logs')
      .select('id,organization_id,actor_user_id,action,entity_type,entity_id,metadata,created_at,organizations(name)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (organizationId) query = query.eq('organization_id', organizationId)

    const { data } = await query
    const rows = data || []
    setLogs(rows)

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

  useEffect(() => { load() }, [organizationId])

  return (
    <>
      <AdminSectionHeader
        title="Auditoria"
        description="Alterações administrativas, filas, números e integrações."
        actions={<button className="secondary inline-btn" onClick={load}><RefreshCw size={15}/> Atualizar</button>}
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
    </>
  )
}

function Administration({ organizations, reloadOrganizations, userEmail }) {
  const [section, setSection] = useState('overview')

  const items = [
    ['overview', 'Visão geral', Shield],
    ['users', 'Usuários', Users],
    ['whatsapp', 'WhatsApp', Phone],
    ['queue', 'Fila', ListChecks],
    ['catalog', 'Catálogo CRM', Tags],
    ['clients', 'Organizações', Building2],
    ['google', 'Google Places', Database],
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
          {section === 'overview' && <AdminOverview organizations={organizations} />}
          {section === 'users' && <AdminUsers organizations={organizations} userEmail={userEmail} />}
          {section === 'whatsapp' && <AdminWhatsApp organizations={organizations} userEmail={userEmail} />}
          {section === 'queue' && <AdminQueue organizations={organizations} />}
          {section === 'catalog' && <CatalogAdmin userEmail={userEmail} />}
          {section === 'clients' && <AdminClients organizations={organizations} reloadOrganizations={reloadOrganizations} />}
          {section === 'google' && <AdminGooglePlaces organizations={organizations} />}
          {section === 'defaults' && <AdminDefaults organizations={organizations} />}
          {section === 'messages' && <AdminMessages organizations={organizations} userEmail={userEmail} />}
          {section === 'audit' && <AdminAudit organizations={organizations} userEmail={userEmail} />}
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
  const [isSystemAdmin, setIsSystemAdmin] = useState(false)
  const [adminOrganizations, setAdminOrganizations] = useState([])
  const [page, setPage] = useState('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setOrganization(null)
      setSettings(null)
      setAccountStatus('active')
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
          .select('account_status')
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
      const platformAdmin = Boolean(adminResult.data)

      setAccountStatus(status)
      setIsSystemAdmin(platformAdmin)

      if (!membershipResult.error && membershipResult.data?.organizations?.is_active) {
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
      .select('id,name,is_active,created_at,created_by')
      .order('created_at', { ascending: true })

    setAdminOrganizations(data || [])
  }

  useEffect(() => {
    loadAdminOrganizations()
  }, [isSystemAdmin, accountStatus])

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

  if (loading || (session && accessLoading)) {
    return <div className="loading-screen">Carregando...</div>
  }

  if (!session) return <AuthScreen />

  const userEmail = session.user.email

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
              <span>Administração</span>
            </div>
          </div>

          <nav>
            <button className="nav-item active">
              <Shield size={18}/> Administração
            </button>
          </nav>

          <button className="nav-item logout" onClick={() => { setMobileMenuOpen(false); logout() }}>
            <LogOut size={18}/> Sair
          </button>
        </aside>

        <main className="content">
          <Administration
            organizations={adminOrganizations}
            reloadOrganizations={loadAdminOrganizations}
            userEmail={userEmail}
          />
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
          <button className={`nav-item ${page === 'targets' ? 'active' : ''}`} onClick={() => { setPage('targets'); setMobileMenuOpen(false) }}>
            <Tags size={18}/> Públicos-alvo
          </button>
          {(settings?.feature_flags?.campaigns !== false) && (
            <button className={`nav-item ${page === 'campaigns' ? 'active' : ''}`} onClick={() => { setPage('campaigns'); setMobileMenuOpen(false) }}>
              <Target size={18}/> Campanhas
            </button>
          )}
          {(settings?.feature_flags?.capture !== false) && (
            <button className={`nav-item ${page === 'capture' ? 'active' : ''}`} onClick={() => { setPage('capture'); setMobileMenuOpen(false) }}>
              <Search size={18}/> Captação
            </button>
          )}
          {(settings?.feature_flags?.leads !== false) && (
            <button className={`nav-item ${page === 'leads' ? 'active' : ''}`} onClick={() => { setPage('leads'); setMobileMenuOpen(false) }}>
              <Users size={18}/> Leads
            </button>
          )}
          {(settings?.feature_flags?.leads !== false) && (
            <button className={`nav-item ${page === 'clients' ? 'active' : ''}`} onClick={() => { setPage('clients'); setMobileMenuOpen(false) }}>
              <CheckCircle2 size={18}/> Clientes
            </button>
          )}
          {(settings?.feature_flags?.messages !== false) && (
            <button className={`nav-item ${page === 'messages' ? 'active' : ''}`} onClick={() => { setPage('messages'); setMobileMenuOpen(false) }}>
              <MessageSquareText size={18}/> Mensagens
            </button>
          )}
          <button className={`nav-item ${page === 'whatsapp' ? 'active' : ''}`} onClick={() => { setPage('whatsapp'); setMobileMenuOpen(false) }}>
            <Phone size={18}/> WhatsApp
          </button>

          {isSystemAdmin && (
            <button className={`nav-item ${page === 'administration' ? 'active' : ''}`} onClick={() => { setPage('administration'); setMobileMenuOpen(false) }}>
              <Shield size={18}/> Administração
            </button>
          )}
        </nav>

        <button className="nav-item logout" onClick={() => { setMobileMenuOpen(false); logout() }}>
          <LogOut size={18}/> Sair
        </button>
      </aside>

      <main className="content">
        {page === 'dashboard' && (
          <Dashboard
            organization={organization}
            settings={settings}
            userEmail={userEmail}
            onGoCampaigns={() => setPage('campaigns')}
          />
        )}
        {page === 'targets' && (
          <TargetSegments organization={organization} userEmail={userEmail} />
        )}
        {page === 'campaigns' && settings?.feature_flags?.campaigns !== false && (
          <Campaigns organization={organization} settings={settings} userEmail={userEmail} />
        )}
        {page === 'capture' && settings?.feature_flags?.capture !== false && (
          <Capture organization={organization} settings={settings} userEmail={userEmail} />
        )}
        {page === 'leads' && settings?.feature_flags?.leads !== false && (
          <Leads organization={organization} settings={settings} userEmail={userEmail} />
        )}
        {page === 'clients' && settings?.feature_flags?.leads !== false && (
          <Clients organization={organization} userEmail={userEmail} userId={session.user.id} />
        )}
        {page === 'messages' && settings?.feature_flags?.messages !== false && (
          <Messages organization={organization} userEmail={userEmail} />
        )}
        {page === 'whatsapp' && (
          <AdminWhatsApp
            organizations={[organization]}
            userEmail={userEmail}
            userMode={true}
          />
        )}
        {page === 'administration' && isSystemAdmin && (
          <Administration
            organizations={adminOrganizations}
            reloadOrganizations={loadAdminOrganizations}
            userEmail={userEmail}
          />
        )}
      </main>
    </div>
  )
}
