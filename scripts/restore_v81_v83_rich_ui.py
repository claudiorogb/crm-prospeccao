from pathlib import Path
import ast
import re

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

# Work only inside the complete historical Leads component.
leads_start = text.index("function Leads({ organization, settings, userEmail }) {")
leads_end = text.index("\nfunction Clients({ organization, userEmail, userId }) {", leads_start)
block = text[leads_start:leads_end]

# Remove the old 50-row page state. The funnel will be continuous.
block, n = re.subn(
    r"\n  const LEADS_PAGE_SIZE = 50\n  const \[page, setPage\] = useState\(0\)",
    "",
    block,
    count=1,
)
if n != 1:
    raise SystemExit(f'pagination state: expected 1, found {n}')

# Replace the page loader with a server-efficient continuous loader. Active stages are
# loaded fully; terminal stages show only the 50 most recent by status change.
load_start = block.index("  async function loadLeadPage(")
load_end = block.index("\n\n  async function loadData()", load_start)
new_loader = r'''  const ACTIVE_FUNNEL_STATUSES = ['new', 'qualified', 'queued', 'contacted', 'replied', 'interested', 'proposal', 'negotiation']
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

      setLeads(rows)
      setTotalLeads(rows.length)
      setStatusCounts(counts)
      setStatusValueTotals(values)
      setStatusOverdueCounts(overdue)
    } catch (error) {
      setMessage(`Não foi possível carregar os leads: ${error.message}`)
    }
  }'''
block = block[:load_start] + new_loader + block[load_end:]

# Redirect all former page refreshes to the continuous loader.
block = re.sub(r"await loadLeadPage\([^\n;]*\)", "await loadAllLeads(filter)", block)
block = block.replace("loadLeadPage(page, filter)", "loadAllLeads(filter)")
block = block.replace("loadLeadPage(0, filter)", "loadAllLeads(filter)")
block = re.sub(r"\n\s*setPage\([^\n]*\)", "", block)

# Remove obsolete page helpers if present.
block = re.sub(
    r"\n  const totalPages = Math\.max\(1, Math\.ceil\(totalLeads / LEADS_PAGE_SIZE\)\)\n\n  async function goToPage\([\s\S]*?\n  \}\n",
    "\n",
    block,
    count=1,
)

# Funnel-only bulk selection must remain absent. Do not alter Campaigns > Envio.
block = re.sub(
    r'\n\s*<section className="bulk-toolbar">[\s\S]*?Selecionar todos os filtrados[\s\S]*?</section>\s*\n',
    '\n',
    block,
    count=1,
)
block = re.sub(
    r'\s*<input\s+type="checkbox"[\s\S]*?checked=\{selected\.has\(l\.id\)\}[\s\S]*?aria-label=\{`Selecionar \$\{l\.business_name\}`\}[\s\S]*?/>',
    '',
    block,
    count=1,
)

# Ensure discarded is not shown as a Kanban filter option when using generic status map.
block = block.replace(
    "{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}",
    "{Object.entries(statusLabel).filter(([value]) => value !== 'discarded').map(([value,label])=><option key={value} value={value}>{label}</option>)}"
)

text = text[:leads_start] + block + text[leads_end:]

# Reuse the already-reviewed Encerrados component from V83 without replacing the rich Funnel workspace.
v83_source = Path('scripts/apply_v83_terminal_visibility_and_closed.py').read_text(encoding='utf-8')
tree = ast.parse(v83_source)
closed_component = None
for node in tree.body:
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'closed_component' for t in node.targets):
        closed_component = ast.literal_eval(node.value)
        break
if not closed_component:
    raise SystemExit('ClosedLeads component not found in V83 source')

workspace_marker = "\nfunction SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {"
if 'function ClosedLeads(' not in text:
    if workspace_marker not in text:
        raise SystemExit('SalesFunnelWorkspace marker not found')
    text = text.replace(workspace_marker, closed_component + workspace_marker, 1)

# Add Encerrados beside Leads and Clientes while preserving all historical nested lead pages.
clients_tab = """        <button className={section === 'clients' ? 'active' : ''} onClick={() => setSection('clients')}>Clientes</button>"""
closed_tab = clients_tab + "\n        <button className={section === 'closed' ? 'active' : ''} onClick={() => setSection('closed')}>Encerrados</button>"
if "setSection('closed')" not in text:
    if clients_tab not in text:
        raise SystemExit('Clients tab marker not found')
    text = text.replace(clients_tab, closed_tab, 1)

clients_render = """      {section === 'clients' && <Clients organization={organization} userEmail={userEmail} userId={userId} />}"""
closed_render = clients_render + "\n      {section === 'closed' && <ClosedLeads organization={organization} userEmail={userEmail} />}"
if "section === 'closed' && <ClosedLeads" not in text:
    if clients_render not in text:
        raise SystemExit('Clients render marker not found')
    text = text.replace(clients_render, closed_render, 1)

# Manual lead registration: target audience is optional and origin/channel is flexible.
manual_start = text.index("function ManualLeadRegistration({ organization, settings, userEmail, userId }) {")
manual_end = text.index("\nfunction NotInterestedRepository", manual_start)
manual = text[manual_start:manual_end]

# Target audience must be optional.
manual = re.sub(
    r'(<select\s+value=\{form\.target_segment_id\}\s+onChange=\{e=>setForm\(\{\.\.\.form,target_segment_id:e\.target\.value\}\)\})\s+required>',
    r'\1>',
    manual,
    count=1,
)
if 'value={form.target_segment_id}' in manual and '<option value="">Sem público-alvo</option>' not in manual:
    manual = manual.replace(
        '<select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})}>',
        '<select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})}>\n                <option value="">Sem público-alvo</option>',
        1,
    )

# Origin/channel can be omitted or selected from common acquisition channels.
origin_pattern = re.compile(
    r'<select value=\{form\.customer_origin\} onChange=\{e=>setForm\(\{\.\.\.form,customer_origin:e\.target\.value\}\)\}(?: required)?>[\s\S]*?</select>',
    re.MULTILINE,
)
origin_select = '''<select value={form.customer_origin} onChange={e=>setForm({...form,customer_origin:e.target.value})}>
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
              </select>'''
manual, origin_count = origin_pattern.subn(origin_select, manual, count=1)
if origin_count != 1:
    raise SystemExit(f'manual origin select: expected 1, found {origin_count}')

text = text[:manual_start] + manual + text[manual_end:]

# Guardrails: preserve historical pages and today's explicit removals.
required = [
    'function OverdueReturnsPage', 'function OverdueReturnsAlert', 'function OverdueReturnsNavItem',
    'function TeamPerformance', 'function SalesPage', 'function PlatformSalesOverview',
    'function ManualLeadRegistration', 'function NotInterestedRepository', 'function LeadExportPanel',
    'function ResetPasswordScreen', 'save_lead_journey_checkpoint', 'customer_origin',
    'AdminCommercialArea', 'AdminIntegrations', 'function ClosedLeads', 'TERMINAL_VISIBLE_LIMIT = 50',
    'Cadastro novo lead', 'Leads sem interesse'
]
missing = [marker for marker in required if marker not in text]
if missing:
    raise SystemExit('Missing required markers: ' + ', '.join(missing))

leads_start = text.index("function Leads({ organization, settings, userEmail }) {")
leads_end = text.index("\nfunction Clients({ organization, userEmail, userId }) {", leads_start)
final_leads = text[leads_start:leads_end]
if 'Selecionar todos os filtrados' in final_leads:
    raise SystemExit('Funnel bulk selection returned')
if 'LEADS_PAGE_SIZE' in final_leads or 'const [page, setPage]' in final_leads:
    raise SystemExit('Funnel pagination state still present')

APP.write_text(text, encoding='utf-8')
print('Rich UI restored: continuous funnel, terminal 50 rule, Encerrados, optional manual target and lead channel.')
