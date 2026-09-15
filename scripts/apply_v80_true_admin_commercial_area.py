from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: esperado 1 trecho, encontrado {count}')
    text = text.replace(old, new, 1)

# A Área comercial não deve ser uma subpágina da Administração.
replace_once(
"""    ['overview', 'Visão geral', Shield],
    ['commercial', 'Área comercial', Building2],
    ['users', 'Usuários', Users],""",
"""    ['overview', 'Visão geral', Shield],
    ['users', 'Usuários', Users],""",
'remover Área comercial do submenu administrativo'
)

replace_once(
"""          {section === 'overview' && <AdminOverview organizations={productionOrganizations} />}
          {section === 'commercial' && (
            <AdminCommercialArea
              organizations={organizations}
              userEmail={userEmail}
              userId={userId}
            />
          )}
          {section === 'users' && <AdminUsers organizations={productionOrganizations} userEmail={userEmail} />}""",
"""          {section === 'overview' && <AdminOverview organizations={productionOrganizations} />}
          {section === 'users' && <AdminUsers organizations={productionOrganizations} userEmail={userEmail} />}""",
'remover renderização comercial aninhada'
)

# Estados exclusivos do administrador para alternar entre administração e o ambiente comercial sandbox.
replace_once(
"""  const [adminOrganizations, setAdminOrganizations] = useState([])
  const [page, setPage] = useState('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)""",
"""  const [adminOrganizations, setAdminOrganizations] = useState([])
  const [page, setPage] = useState('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [systemAdminView, setSystemAdminView] = useState('administration')
  const [adminCommercialPage, setAdminCommercialPage] = useState('dashboard')
  const [adminSandboxSettings, setAdminSandboxSettings] = useState(null)

  const sandboxOrganization = useMemo(
    () => adminOrganizations.find(org => org.is_sandbox === true && org.is_active),
    [adminOrganizations]
  )""",
'estados da Área comercial do administrador'
)

# Carrega apenas as configurações da organização sandbox. Não altera membership nem organização ativa do usuário.
marker = """  useEffect(() => {
    loadAdminOrganizations()
  }, [isSystemAdmin, accountStatus])

  useEffect(() => {
    if (!organization?.id || accountStatus !== 'active') {"""
replacement = """  useEffect(() => {
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
  }, [isSystemAdmin, accountStatus, sandboxOrganization?.id])

  useEffect(() => {
    if (!organization?.id || accountStatus !== 'active') {"""
replace_once(marker, replacement, 'carregamento das configurações sandbox')

# Substitui o shell exclusivo do system admin. Agora Área comercial é um ambiente paralelo,
# com o mesmo menu Dashboard/Campanhas/Funil usado pelos clientes e botão para voltar à Administração.
start = text.index("  if (isSystemAdmin && !organization) {")
end = text.index("\n\n  if (!organization) {", start)
old_block = text[start:end]

new_block = r'''  if (isSystemAdmin && !organization) {
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
                  <Building2 size={18}/> Área comercial
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
        </main>
      </div>
    )
  }'''

text = text[:start] + new_block + text[end:]

APP.write_text(text, encoding='utf-8')
print('V80 aplicada: Área comercial do administrador virou ambiente cliente completo e isolado.')
