"""V91: expose the existing sandbox as an independently managed Teste tenant.

Only changes existing UI routing and admin metrics. Any missing/changed anchor aborts
before writing App.jsx. Never changes the data access policy or production tenants.
"""
from pathlib import Path

app = Path('src/App.jsx')
text = app.read_text(encoding='utf-8')


def once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, found {count}; no file changed')
    text = text.replace(old, new, 1)


once(
    "import CustomerImportPanel from './customer-import'\n",
    "import CustomerImportPanel from './customer-import'\nimport AdminTestUsers from './admin-test-users'\nimport AdminTestLimits from './admin-test-limits'\n",
    'scoped test components'
)

# The administration summary MUST aggregate production tenants only. Filtering
# the number of organizations alone does not filter database count queries.
start = text.index('function AdminOverview({ organizations }) {')
end = text.index('function AdminWhatsApp(', start)
section = text[start:end]
old_start = """  useEffect(() => {
    async function load() {
      const ["""
new_start = """  useEffect(() => {
    async function load() {
      const productionOrgIds = organizations.filter(org => org.is_sandbox !== true).map(org => org.id)
      if (!productionOrgIds.length) {
        setStats({ organizations: 0, activeOrganizations: 0, leads: 0, campaigns: 0, queued: 0, failed: 0, sent: 0, whatsappNumbers: 0 })
        return
      }
      const ["""
if section.count(old_start) != 1:
    raise SystemExit('admin overview load anchor changed; no file changed')
section = section.replace(old_start, new_start, 1)
for table in ('leads', 'campaigns', 'whatsapp_numbers'):
    old = f"supabase.from('{table}').select('id', {{ count: 'exact', head: true }})"
    if section.count(old) != 1:
        raise SystemExit(f'admin overview {table} count anchor changed; no file changed')
    section = section.replace(old, old + ".in('organization_id', productionOrgIds)", 1)
old = "supabase.from('outbound_messages').select('id', { count: 'exact', head: true })"
if section.count(old) != 3:
    raise SystemExit('admin overview message counts changed; no file changed')
section = section.replace(old, old + ".in('organization_id', productionOrgIds)")
text = text[:start] + section + text[end:]

# Keep every module tied to the sandbox organization. The production admin
# navigation still receives only productionOrganizations, as before.
anchor = 'function Administration({ organizations, reloadOrganizations, userEmail, userId }) {'
component = '''function AdminTestSettings({ organization, userEmail, userId }) {
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


'''
once(anchor, component + anchor, 'test administration view')

once(
    "<Building2 size={18}/> Área comercial",
    "<Building2 size={18}/> Teste",
    'sandbox navigation label'
)

nav_anchor = '''                <button
                  className="nav-item"
                  onClick={() => { setSystemAdminView('administration'); setMobileMenuOpen(false) }}
                >
                  <Shield size={18}/> Administração
                </button>'''
nav_new = '''                <button
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
''' + nav_anchor
once(nav_anchor, nav_new, 'sandbox full navigation')

render_anchor = '''          {commercialMode && sandboxOrganization && adminSandboxSettings && adminCommercialPage === 'sales-funnel' && adminSandboxSettings?.feature_flags?.leads !== false && (
            <SalesFunnelWorkspace
              organization={sandboxOrganization}
              settings={adminSandboxSettings}
              userEmail={userEmail}
              userId={session.user.id}
            />
          )}'''
render_new = render_anchor + '''
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
          )}'''
once(render_anchor, render_new, 'sandbox sales, overdue returns and settings routes')

# Reload sandbox settings on navigation so updates to the sending window take
# effect in campaign forms without asking the administrator to log out.
old = "  }, [isSystemAdmin, accountStatus, sandboxOrganization?.id])"
new = "  }, [isSystemAdmin, accountStatus, sandboxOrganization?.id, adminCommercialPage])"
once(old, new, 'sandbox settings refresh on navigation')

assert text.count(".in('organization_id', productionOrgIds)") == 6
assert text.count('<AdminTestSettings organization={sandboxOrganization}') == 1
assert text.count('<AdminTestUsers organization={organization}') == 1
assert text.count('<AdminTestLimits organization={organization}') == 1
app.write_text(text, encoding='utf-8')
print('V91: sandbox Teste UI + scoped administration + production-only overview applied.')
