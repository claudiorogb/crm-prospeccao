from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: esperado 1 trecho, encontrado {count}')
    text = text.replace(old, new, 1)


component_anchor = "function Administration({ organizations, reloadOrganizations, userEmail }) {"
if text.count(component_anchor) != 1:
    raise SystemExit('Âncora de Administration não encontrada de forma única')

commercial_component = r'''function AdminCommercialArea({ organizations, userEmail, userId }) {
  const [workspacePage, setWorkspacePage] = useState('dashboard')
  const [settings, setSettings] = useState(null)
  const [notice, setNotice] = useState('')

  const sandboxOrganization = organizations.find(
    org => org.name === 'Área Comercial - Testes e Apresentações' && org.is_active
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


'''
text = text.replace(component_anchor, commercial_component + "function Administration({ organizations, reloadOrganizations, userEmail, userId }) {", 1)

replace_once(
"""  const items = [
    ['overview', 'Visão geral', Shield],
    ['users', 'Usuários', Users],""",
"""  const items = [
    ['overview', 'Visão geral', Shield],
    ['commercial', 'Área comercial', Building2],
    ['users', 'Usuários', Users],""",
'item Área comercial'
)

replace_once(
"""          {section === 'overview' && <AdminOverview organizations={organizations} />}
          {section === 'users' && <AdminUsers organizations={organizations} userEmail={userEmail} />}""",
"""          {section === 'overview' && <AdminOverview organizations={organizations} />}
          {section === 'commercial' && (
            <AdminCommercialArea
              organizations={organizations}
              userEmail={userEmail}
              userId={userId}
            />
          )}
          {section === 'users' && <AdminUsers organizations={organizations} userEmail={userEmail} />}""",
'render Área comercial'
)

replace_once(
"""      if (!membershipResult.error && membershipResult.data?.organizations?.is_active) {
        setOrganization(membershipResult.data.organizations)
      } else {
        setOrganization(null)
        setSettings(null)
      }""",
"""      if (platformAdmin) {
        // Administradores do sistema permanecem na área administrativa mesmo
        // quando também são membros da organização isolada de testes.
        setOrganization(null)
        setSettings(null)
      } else if (!membershipResult.error && membershipResult.data?.organizations?.is_active) {
        setOrganization(membershipResult.data.organizations)
      } else {
        setOrganization(null)
        setSettings(null)
      }""",
'acesso do administrador do sistema'
)

admin_call_old = """          <Administration
            organizations={adminOrganizations}
            reloadOrganizations={loadAdminOrganizations}
            userEmail={userEmail}
          />"""
admin_call_new = """          <Administration
            organizations={adminOrganizations}
            reloadOrganizations={loadAdminOrganizations}
            userEmail={userEmail}
            userId={session.user.id}
          />"""
count = text.count(admin_call_old)
if count != 2:
    raise SystemExit(f'chamadas de Administration: esperado 2, encontrado {count}')
text = text.replace(admin_call_old, admin_call_new)

APP.write_text(text, encoding='utf-8')
print('V78 aplicada: Área Comercial isolada adicionada à administração.')
