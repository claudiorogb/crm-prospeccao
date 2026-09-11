from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V49: componente não encontrado: {label}')
    return start, end


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f'V49: marcador não encontrado: {label}')
    text = text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# 1) Dashboard da empresa: mantém indicadores atuais, remove Campanhas e inclui
#    desempenho automático de todos os usuários ativos da própria organização.
# -----------------------------------------------------------------------------
team_and_dashboard = r'''function TeamPerformance({ organization }) {
  const [rows, setRows] = useState([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const { data, error } = await supabase.rpc('get_team_performance', { p_organization_id: organization.id })
      if (!active) return
      if (error) setMessage(error.message)
      else {
        setRows(data || [])
        setMessage('')
      }
    }
    load()
    const timer = setInterval(load, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [organization.id])

  return (
    <section className="panel team-performance-v49">
      <div className="panel-head">
        <div>
          <span className="eyebrow">EQUIPE</span>
          <h2>Usuários</h2>
          <p className="muted">Leads em trabalho e negócios fechados por usuário desta empresa.</p>
        </div>
      </div>
      {message && <div className="notice error">{message}</div>}
      <div className="team-performance-list-v49">
        <div className="team-performance-row-v49 team-performance-head-v49">
          <span>Usuário</span><span>Leads</span><span>Negócios fechados</span><span>Valor fechado</span>
        </div>
        {rows.map(row => (
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
        {!rows.length && !message && <p className="muted">Nenhum usuário ativo encontrado nesta empresa.</p>}
      </div>
    </section>
  )
}

function Dashboard({ organization, userEmail, onGoCampaigns }) {
  const [stats, setStats] = useState({
    leadsFound: 0,
    contacted: 0,
    ongoing: 0,
    won: 0,
    wonValue: 0,
    ongoingValue: 0,
    lost: 0,
    lostValue: 0
  })

  useEffect(() => {
    let active = true
    async function loadStats() {
      const [{ data: leadsData, error: leadsError }, { data: salesData, error: salesError }] = await Promise.all([
        supabase
          .from('leads')
          .select('id,status,last_contact_date,last_contacted_at,proposal_value,proposal_sent_at')
          .eq('organization_id', organization.id),
        supabase
          .from('sales')
          .select('amount,lead_id')
          .eq('organization_id', organization.id)
      ])

      if (!active || leadsError || salesError) return
      const leads = leadsData || []
      const sales = salesData || []
      const contactedStatuses = new Set(['contacted','replied','interested','proposal','not_interested','won','lost'])
      const wonIds = new Set(leads.filter(l => l.status === 'won').map(l => l.id))
      const lostLeads = leads.filter(l => l.status === 'lost')

      setStats({
        leadsFound: leads.length,
        contacted: leads.filter(l => l.last_contact_date || l.last_contacted_at || contactedStatuses.has(l.status)).length,
        ongoing: leads.filter(l => ['interested','proposal'].includes(l.status)).length,
        won: wonIds.size,
        wonValue: sales.filter(s => wonIds.has(s.lead_id)).reduce((sum, s) => sum + Number(s.amount || 0), 0),
        ongoingValue: leads
          .filter(l => ['interested','proposal'].includes(l.status) && l.proposal_sent_at)
          .reduce((sum, l) => sum + Number(l.proposal_value || 0), 0),
        lost: lostLeads.length,
        lostValue: lostLeads.reduce((sum, l) => sum + Number(l.proposal_value || 0), 0)
      })
    }

    loadStats()
    const timer = setInterval(loadStats, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [organization.id])

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">PAINEL</span>
          <h1>Dashboard</h1>
          <p className="muted">Resumo da prospecção e do funil comercial.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <section className="stats-grid dashboard-commercial-grid">
        <StatCard label="Leads encontrados" value={stats.leadsFound} detail="Total captado ou cadastrado" />
        <StatCard label="Leads contatados" value={stats.contacted} detail="Leads que já receberam contato" />
        <StatCard label="Negócios em andamento" value={stats.ongoing} detail="Interessados e propostas em andamento" />
        <StatCard label="Negócios fechados" value={stats.won} detail={`Valor total: ${formatCurrency(stats.wonValue)}`} />
        <StatCard label="Propostas em andamento" value={formatCurrency(stats.ongoingValue)} detail="Somente propostas enviadas ainda abertas" />
        <StatCard label="Negócios perdidos" value={stats.lost} detail={`Valor total das propostas: ${formatCurrency(stats.lostValue)}`} />
      </section>

      <TeamPerformance organization={organization} />
    </>
  )
}


'''
start, end = bounds('function Dashboard({ organization, userEmail, onGoCampaigns }) {', 'function CatalogAdmin', 'Dashboard')
text = text[:start] + team_and_dashboard + text[end:]


# -----------------------------------------------------------------------------
# 2) Cadastro manual separado: preserva a estrutura atual, sempre cria em NOVO,
#    grava captador e observações e mostra discretamente quem está cadastrando.
# -----------------------------------------------------------------------------
manual_component = r'''function ManualLeadRegistration({ organization, settings, userEmail, userId }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
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
    capture_notes: ''
  })

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

    const { error } = await supabase.from('leads').insert({
      organization_id: organization.id,
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
        capture_notes: ''
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
          <p className="muted">Cadastro manual independente de público-alvo ou campanha.</p>
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


'''
start, end = bounds(
    'function ManualLeadRegistration({ organization, settings, userEmail }) {',
    'function NotInterestedRepository({ organization, userEmail }) {',
    'Cadastro manual'
)
text = text[:start] + manual_component + text[end:]

# A estrutura V32.1 mantém Cadastro novo lead dentro da aba Leads.
replace_once(
    "{leadSection === 'new-lead' && <ManualLeadRegistration organization={organization} settings={settings} userEmail={userEmail} />}",
    "{leadSection === 'new-lead' && <ManualLeadRegistration organization={organization} settings={settings} userEmail={userEmail} userId={userId} />}",
    'passagem de userId ao cadastro manual'
)


# -----------------------------------------------------------------------------
# 3) Visão comercial exclusiva do System Admin: consolidado geral + lista por
#    empresa + detalhamento automático da equipe da empresa selecionada.
# -----------------------------------------------------------------------------
platform_component = r'''function PlatformSalesOverview({ userEmail }) {
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


'''
admin_marker = 'function AdminOverview({ organizations }) {'
if admin_marker not in text:
    raise SystemExit('V49: AdminOverview não encontrado.')
text = text.replace(admin_marker, platform_component + admin_marker, 1)

# System Admin sem organização vinculada: Vendas vira a página inicial e Administração continua separada.
old_admin_nav = '''          <nav>
            <button className="nav-item active">
              <Shield size={18}/> Administração
            </button>
          </nav>'''
new_admin_nav = '''          <nav>
            <button className={`nav-item ${page !== 'administration' ? 'active' : ''}`} onClick={() => { setPage('platform-sales'); setMobileMenuOpen(false) }}>
              <Activity size={18}/> Vendas
            </button>
            <button className={`nav-item ${page === 'administration' ? 'active' : ''}`} onClick={() => { setPage('administration'); setMobileMenuOpen(false) }}>
              <Shield size={18}/> Administração
            </button>
          </nav>'''
replace_once(old_admin_nav, new_admin_nav, 'menu especial do System Admin')

old_admin_main = '''        <main className="content">
          <Administration
            organizations={adminOrganizations}
            reloadOrganizations={loadAdminOrganizations}
            userEmail={userEmail}
          />
        </main>'''
new_admin_main = '''        <main className="content">
          {page === 'administration' ? (
            <Administration
              organizations={adminOrganizations}
              reloadOrganizations={loadAdminOrganizations}
              userEmail={userEmail}
            />
          ) : (
            <PlatformSalesOverview userEmail={userEmail} />
          )}
        </main>'''
replace_once(old_admin_main, new_admin_main, 'conteúdo especial do System Admin')

# Se um System Admin também estiver vinculado a uma empresa, mantém acesso à visão consolidada.
normal_admin_nav = '''          {isSystemAdmin && (
            <button className={`nav-item ${page === 'administration' ? 'active' : ''}`} onClick={() => { setPage('administration'); setMobileMenuOpen(false) }}>
              <Shield size={18}/> Administração
            </button>
          )}'''
normal_admin_nav_new = '''          {isSystemAdmin && (
            <>
              <button className={`nav-item ${page === 'platform-sales' ? 'active' : ''}`} onClick={() => { setPage('platform-sales'); setMobileMenuOpen(false) }}>
                <Activity size={18}/> Vendas
              </button>
              <button className={`nav-item ${page === 'administration' ? 'active' : ''}`} onClick={() => { setPage('administration'); setMobileMenuOpen(false) }}>
                <Shield size={18}/> Administração
              </button>
            </>
          )}'''
replace_once(normal_admin_nav, normal_admin_nav_new, 'menu normal do System Admin')

admin_route = '''        {page === 'administration' && isSystemAdmin && (
          <Administration'''
admin_route_new = '''        {page === 'platform-sales' && isSystemAdmin && (
          <PlatformSalesOverview userEmail={userEmail} />
        )}
        {page === 'administration' && isSystemAdmin && (
          <Administration'''
replace_once(admin_route, admin_route_new, 'rota consolidada do System Admin')


# -----------------------------------------------------------------------------
# 4) CSS: cabeçalho do funil acompanha a rolagem, sidebar fecha ao retirar o
#    mouse e os indicadores por usuário permanecem compactos.
# -----------------------------------------------------------------------------
css += r'''

/* V49 - funil fixo, menu hover e indicadores por usuário */
.sales-kanban-always-scroll .kanban-column-head {
  position: sticky !important;
  top: 0 !important;
  z-index: 30 !important;
  background: #ffffff !important;
  border-bottom: 1px solid #e2e8f0;
  box-shadow: 0 4px 10px rgba(15, 23, 42, .05);
}

@media (min-width: 901px) {
  /* O clique não mantém mais a sidebar aberta quando o mouse sai dela. */
  .sidebar:not(:hover) {
    width: 64px !important;
    box-shadow: none !important;
  }
  .sidebar:not(:hover) .sidebar-brand > div:last-child {
    opacity: 0 !important;
    visibility: hidden !important;
    transform: translateX(-6px) !important;
  }
  .sidebar:not(:hover) .nav-item {
    font-size: 0 !important;
  }
}

.capture-audit-note-v49 { margin: -4px 0 14px; font-size: 12px; }
.team-performance-v49 { margin-top: 16px; }
.team-performance-list-v49 { display: grid; gap: 0; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.team-performance-row-v49 { display: grid; grid-template-columns: minmax(180px, 2fr) repeat(3, minmax(110px, 1fr)); gap: 12px; align-items: center; padding: 11px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
.team-performance-row-v49:last-child { border-bottom: 0; }
.team-performance-row-v49 > span:first-child { display: grid; gap: 2px; }
.team-performance-row-v49 small { color: #94a3b8; font-size: 11px; }
.team-performance-head-v49 { background: #f8fafc; color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; }
.platform-company-list-v49 { margin-top: 16px; }
.company-performance-list-v49 { display: grid; gap: 8px; }
.company-performance-row-v49 { width: 100%; display: grid; grid-template-columns: minmax(180px,2fr) repeat(3,minmax(100px,1fr)) 24px; gap: 12px; align-items: center; padding: 13px 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; text-align: left; cursor: pointer; color: inherit; }
.company-performance-row-v49:hover, .company-performance-row-v49.active { border-color: #94a3b8; background: #f8fafc; }
.platform-company-detail-v49 { margin-top: 16px; }

@media (max-width: 760px) {
  .team-performance-row-v49 { grid-template-columns: 1.6fr repeat(3, .8fr); gap: 7px; padding: 9px; font-size: 11px; }
  .company-performance-row-v49 { grid-template-columns: 1fr; gap: 4px; }
  .company-performance-row-v49 svg { display: none; }
}
'''


# -----------------------------------------------------------------------------
# 5) Validação forte. O build só segue para Vite se todos os requisitos existirem.
# -----------------------------------------------------------------------------
dashboard_part = text[text.find('function Dashboard'):text.find('function CatalogAdmin')]
manual_part = text[text.find('function ManualLeadRegistration'):text.find('function NotInterestedRepository')]
checks = [
    ('dashboard sem Campanhas', 'dashboard-shortcut clickable' not in dashboard_part),
    ('dashboard por usuário', 'get_team_performance' in text and 'TeamPerformance' in text),
    ('cadastro manual sempre Novo', "status: 'new'" in manual_part and "source: 'manual'" in manual_part),
    ('captador registrado', 'captured_by: userId' in manual_part),
    ('observações da captação', 'Observações da captação' in manual_part and 'capture_notes' in manual_part),
    ('userId passado ao cadastro manual', 'ManualLeadRegistration organization={organization} settings={settings} userEmail={userEmail} userId={userId}' in text),
    ('visão consolidada System Admin', 'get_platform_sales_overview' in text and 'Informações de vendas' in text),
    ('cabeçalho do funil sticky', '.sales-kanban-always-scroll .kanban-column-head' in css and 'position: sticky !important' in css),
    ('sidebar fecha fora do hover', '.sidebar:not(:hover)' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('V49 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V49 aplicada: funil fixo, captação em Novo, auditoria de leads, sidebar automática e dashboards por usuário/empresa.')
