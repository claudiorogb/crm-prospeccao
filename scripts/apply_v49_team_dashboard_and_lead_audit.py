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


# -----------------------------------------------------------------------------
# 1) Dashboard da empresa: mantém os indicadores atuais, remove o atalho de
#    Campanhas e acrescenta desempenho automático de TODOS os usuários da empresa.
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
            <span><strong>{row.full_name || 'Usuário'}</strong><small>{row.role === 'owner' ? 'Proprietário' : row.role === 'admin' ? 'Administrador' : 'Usuário'}</small></span>
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
        supabase.from('leads').select('id,status,last_contact_date,last_contacted_at,proposal_value,proposal_sent_at').eq('organization_id', organization.id),
        supabase.from('sales').select('amount,lead_id').eq('organization_id', organization.id)
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
        ongoingValue: leads.filter(l => ['interested','proposal'].includes(l.status) && l.proposal_sent_at).reduce((sum, l) => sum + Number(l.proposal_value || 0), 0),
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
# 2) Cadastro manual: sempre entra em NOVO, registra usuário captador e observações.
# -----------------------------------------------------------------------------
start, end = bounds('function Leads({ organization, settings, userEmail }) {', 'function Clients({ organization, userEmail, userId }) {', 'Leads')
leads = text[start:end]
leads = leads.replace('function Leads({ organization, settings, userEmail }) {', 'function Leads({ organization, settings, userEmail, userId }) {', 1)

state_marker = "    proposal_sent_at: '',\n    status: 'new'"
if state_marker not in leads:
    raise SystemExit('V49: estado do formulário de lead não encontrado.')
leads = leads.replace(state_marker, "    proposal_sent_at: '',\n    capture_notes: '',\n    status: 'new'")

payload_marker = "      status: form.status,\n      source: 'manual'"
if payload_marker not in leads:
    raise SystemExit('V49: payload do cadastro manual não encontrado.')
leads = leads.replace(payload_marker, "      status: 'new',\n      source: 'manual',\n      captured_by: userId,\n      capture_notes: form.capture_notes?.trim() || null", 1)

heading = "          <h2>Cadastro manual</h2>"
if heading not in leads:
    raise SystemExit('V49: cabeçalho do cadastro manual não encontrado.')
leads = leads.replace(heading, heading + "\n          <p className=\"muted capture-audit-note-v49\">Captado por: <strong>{userEmail}</strong> • o lead será criado automaticamente na etapa Novo.</p>", 1)

form_actions = '''            <div className="form-actions">\n              <button type="button" className="secondary" onClick={()=>setShowForm(false)}>Cancelar</button>\n              <button className="primary" disabled={loading}>{loading?'Salvando...':'Salvar lead'}</button>\n            </div>'''
if form_actions not in leads:
    raise SystemExit('V49: ações do formulário de lead não encontradas.')
notes_field = '''            <label>\n              Observações da captação\n              <textarea\n                className="client-textarea"\n                value={form.capture_notes || ''}\n                onChange={e=>setForm({...form,capture_notes:e.target.value})}\n                placeholder="Ex.: produto de interesse, contexto da captação, informações relevantes..."\n              />\n            </label>\n\n'''
leads = leads.replace(form_actions, notes_field + form_actions, 1)
text = text[:start] + leads + text[end:]

# Passa o ID autenticado para o cadastro manual.
old_leads_call = "{section === 'leads' && <Leads organization={organization} settings={settings} userEmail={userEmail} />}"
new_leads_call = "{section === 'leads' && <Leads organization={organization} settings={settings} userEmail={userEmail} userId={userId} />}"
if old_leads_call not in text:
    raise SystemExit('V49: chamada de Leads no funil não encontrada.')
text = text.replace(old_leads_call, new_leads_call, 1)


# -----------------------------------------------------------------------------
# 3) Visão comercial exclusiva do System Admin, consolidada e separada por empresa.
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
      else { setCompanies(data || []); setMessage('') }
    }
    load()
    const timer = setInterval(load, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!selectedId) { setTeam([]); return }
    let active = true
    supabase.rpc('get_team_performance', { p_organization_id: selectedId }).then(({ data, error }) => {
      if (!active) return
      if (error) setMessage(error.message)
      else { setTeam(data || []); setMessage('') }
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
            <button key={company.organization_id} type="button" className={`company-performance-row-v49 ${selectedId === company.organization_id ? 'active' : ''}`} onClick={() => setSelectedId(company.organization_id)}>
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
            <div className="team-performance-row-v49 team-performance-head-v49"><span>Usuário</span><span>Leads</span><span>Negócios fechados</span><span>Valor fechado</span></div>
            {team.map(row => (
              <div className="team-performance-row-v49" key={row.user_id}>
                <span><strong>{row.full_name || 'Usuário'}</strong><small>{row.role === 'owner' ? 'Proprietário' : row.role === 'admin' ? 'Administrador' : 'Usuário'}</small></span>
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

# Menu especial do System Admin (sem organização vinculada): Vendas + Administração.
old_admin_nav = '''          <nav>\n            <button className="nav-item active">\n              <Shield size={18}/> Administração\n            </button>\n          </nav>'''
new_admin_nav = '''          <nav>\n            <button className={`nav-item ${page !== 'administration' ? 'active' : ''}`} onClick={() => { setPage('platform-sales'); setMobileMenuOpen(false) }}>\n              <Activity size={18}/> Vendas\n            </button>\n            <button className={`nav-item ${page === 'administration' ? 'active' : ''}`} onClick={() => { setPage('administration'); setMobileMenuOpen(false) }}>\n              <Shield size={18}/> Administração\n            </button>\n          </nav>'''
if old_admin_nav not in text:
    raise SystemExit('V49: menu especial do System Admin não encontrado.')
text = text.replace(old_admin_nav, new_admin_nav, 1)

old_admin_main = '''        <main className="content">\n          <Administration\n            organizations={adminOrganizations}\n            reloadOrganizations={loadAdminOrganizations}\n            userEmail={userEmail}\n          />\n        </main>'''
new_admin_main = '''        <main className="content">\n          {page === 'administration' ? (\n            <Administration\n              organizations={adminOrganizations}\n              reloadOrganizations={loadAdminOrganizations}\n              userEmail={userEmail}\n            />\n          ) : (\n            <PlatformSalesOverview userEmail={userEmail} />\n          )}\n        </main>'''
if old_admin_main not in text:
    raise SystemExit('V49: conteúdo especial do System Admin não encontrado.')
text = text.replace(old_admin_main, new_admin_main, 1)


# -----------------------------------------------------------------------------
# 4) CSS: cabeçalho do funil congelado, sidebar fecha ao retirar o mouse e tabelas.
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
  /* focus-within não pode manter o menu aberto depois que o mouse sair */
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
# 5) Validação forte: falhar o build se algum requisito da rodada desaparecer.
# -----------------------------------------------------------------------------
checks = [
    ('dashboard sem atalho Campanhas', 'dashboard-shortcut clickable' not in text[text.find('function Dashboard'):text.find('function CatalogAdmin')]),
    ('dashboard por usuário', 'get_team_performance' in text and 'TeamPerformance' in text),
    ('cadastro manual sempre Novo', "status: 'new',\n      source: 'manual'" in text),
    ('captador registrado', 'captured_by: userId' in text),
    ('observações da captação', 'Observações da captação' in text and 'capture_notes' in text),
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
