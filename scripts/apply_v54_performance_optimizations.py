from pathlib import Path
import re

path = Path('src/App.jsx')
text = path.read_text(encoding='utf-8')
original = text


def replace_once(pattern, replacement, source, *, flags=0, label='replacement'):
    updated, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 replacement, found {count}')
    return updated

# Dashboard: replace two full-table reads + client aggregation with one RLS-respecting RPC.
dashboard_start = text.index('function Dashboard({ organization, userEmail, onGoCampaigns }) {')
dashboard_end = text.index('\n\nfunction CatalogAdmin', dashboard_start)
dashboard = text[dashboard_start:dashboard_end]
dashboard = replace_once(
    r"    async function loadStats\(\) \{.*?\n    \}\n\n    loadStats\(\)",
    """    async function loadStats() {
      const { data, error } = await supabase
        .rpc('get_dashboard_stats', { p_organization_id: organization.id })

      if (!active || error) return

      setStats({
        leadsFound: Number(data?.leads_found || 0),
        contacted: Number(data?.contacted || 0),
        ongoing: Number(data?.ongoing || 0),
        won: Number(data?.won || 0),
        wonValue: Number(data?.won_value || 0),
        ongoingValue: Number(data?.ongoing_value || 0)
      })
    }

    loadStats()""",
    dashboard,
    flags=re.S,
    label='dashboard stats RPC'
)
text = text[:dashboard_start] + dashboard + text[dashboard_end:]

# Leads: server-side pagination, filtering and minimal payload.
leads_start = text.index('function Leads({ organization, settings, userEmail }) {')
leads_end = text.index('\n\nfunction Clients', leads_start)
leads = text[leads_start:leads_end]

state_marker = "  const [filter, setFilter] = useState({ search: '', segment: 'all', status: 'all' })\n"
if state_marker not in leads:
    raise RuntimeError('leads pagination state marker not found')
leads = leads.replace(
    state_marker,
    state_marker +
    "  const LEADS_PAGE_SIZE = 50\n"
    "  const [page, setPage] = useState(0)\n"
    "  const [totalLeads, setTotalLeads] = useState(0)\n"
    "  const [statusCounts, setStatusCounts] = useState({})\n",
    1
)

leads = replace_once(
    r"  async function loadData\(\) \{.*?\n  async function saveLead\(e\) \{",
    """  async function loadLookups() {
    const [
      { data: campaignData },
      { data: targetData },
      { data: templateData }
    ] = await Promise.all([
      supabase.from('campaigns').select('id,name,target_segment_id,target_segments(name)').eq('organization_id',organization.id).order('created_at',{ascending:false}),
      supabase.from('target_segments').select('id,name').eq('organization_id',organization.id).eq('is_active',true).order('name'),
      supabase.from('message_templates').select('id,name,target_segment_id,is_active').eq('organization_id',organization.id).eq('is_active',true).order('created_at',{ascending:false})
    ])

    setCampaigns(campaignData || [])
    setTargetSegments(targetData || [])
    setTemplates(templateData || [])
    if (!form.segment && targetData?.length) {
      setForm(old => ({ ...old, segment: targetData[0].id }))
    }
  }

  async function loadLeadPage(pageToLoad = page, currentFilter = filter) {
    const { data, error } = await supabase.rpc('get_leads_page', {
      p_organization_id: organization.id,
      p_search: currentFilter.search.trim() || null,
      p_target_segment_id: currentFilter.segment === 'all' ? null : currentFilter.segment,
      p_status: currentFilter.status === 'all' ? null : currentFilter.status,
      p_limit: LEADS_PAGE_SIZE,
      p_offset: pageToLoad * LEADS_PAGE_SIZE
    })

    if (error) {
      setMessage(`Não foi possível carregar os leads: ${error.message}`)
      return
    }

    const payload = data || {}
    setLeads(Array.isArray(payload.rows) ? payload.rows : [])
    setTotalLeads(Number(payload.total || 0))
    setStatusCounts(payload.status_counts || {})
    setPage(pageToLoad)
  }

  async function loadData() {
    await Promise.all([
      loadLookups(),
      loadLeadPage(page, filter)
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
      await loadLeadPage(0, filter)
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
      await loadLeadPage(page, filter)
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
  }, [organization.id, page, filter.search, filter.segment, filter.status])

  async function saveLead(e) {""",
    leads,
    flags=re.S,
    label='leads data loading'
)

leads = replace_once(
    r"  const visibleLeads = leads\.filter\(l => \{.*?\n  \}\)\n\n  const eligibleVisibleLeads",
    """  const visibleLeads = leads
  const totalPages = Math.max(1, Math.ceil(totalLeads / LEADS_PAGE_SIZE))

  async function goToPage(nextPage) {
    const safePage = Math.min(Math.max(nextPage, 0), totalPages - 1)
    if (safePage === page) return
    setSelected(new Set())
    await loadLeadPage(safePage, filter)
  }

  const eligibleVisibleLeads""",
    leads,
    flags=re.S,
    label='client-side lead filtering removal'
)

if '<span>{columnLeads.length}</span>' not in leads:
    raise RuntimeError('kanban count marker not found')
leads = leads.replace(
    '<span>{columnLeads.length}</span>',
    '<span>{Number(statusCounts?.[status] || 0)}</span>',
    1
)

pagination_marker = """      </section>
    </>
  )
}
"""
pagination_replacement = """      </section>

      <section className=\"bulk-toolbar\">
        <div>
          <strong>{totalLeads}</strong> lead{totalLeads === 1 ? '' : 's'} encontrado{totalLeads === 1 ? '' : 's'}
          <span className=\"muted\"> • Página {page + 1} de {totalPages} • até {LEADS_PAGE_SIZE} por página</span>
        </div>
        <div className=\"bulk-actions\">
          <button className=\"secondary inline-btn\" onClick={() => goToPage(page - 1)} disabled={page <= 0}>Anterior</button>
          <button className=\"secondary inline-btn\" onClick={() => goToPage(page + 1)} disabled={page >= totalPages - 1}>Próxima</button>
        </div>
      </section>
    </>
  )
}
"""
if pagination_marker not in leads:
    raise RuntimeError('pagination insertion marker not found')
leads = leads.replace(pagination_marker, pagination_replacement, 1)

text = text[:leads_start] + leads + text[leads_end:]

if text == original:
    raise RuntimeError('no changes produced')

path.write_text(text, encoding='utf-8')
print('V54 performance optimizations applied successfully.')
