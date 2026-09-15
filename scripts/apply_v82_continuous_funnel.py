from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: esperado 1 trecho, encontrado {count}')
    text = text.replace(old, new, 1)

replace_once(
"""  const [filter, setFilter] = useState({ search: '', segment: 'all', status: 'all' })
  const LEADS_PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  const [totalLeads, setTotalLeads] = useState(0)""",
"""  const [filter, setFilter] = useState({ search: '', segment: 'all', status: 'all' })
  const [totalLeads, setTotalLeads] = useState(0)""",
'estados de paginação'
)

start = text.index('  async function loadLeadPage(')
end = text.index('\n\n  async function loadData()', start)
old_block = text[start:end]
new_block = r'''  async function loadAllLeads(currentFilter = filter) {
    const batchSize = 100
    let offset = 0
    let rows = []
    let summary = null

    while (true) {
      const { data, error } = await supabase.rpc('get_leads_page', {
        p_organization_id: organization.id,
        p_search: currentFilter.search.trim() || null,
        p_target_segment_id: currentFilter.segment === 'all' ? null : currentFilter.segment,
        p_status: currentFilter.status === 'all' ? null : currentFilter.status,
        p_limit: batchSize,
        p_offset: offset
      })

      if (error) {
        setMessage(`Não foi possível carregar os leads: ${error.message}`)
        return
      }

      const payload = data || {}
      if (!summary) summary = payload
      const batchRows = Array.isArray(payload.rows) ? payload.rows : []
      rows = [...rows, ...batchRows]

      const total = Number(payload.total || 0)
      if (!batchRows.length || rows.length >= total) break
      offset += batchRows.length
    }

    setLeads(rows)
    setTotalLeads(Number(summary?.total || 0))
    setStatusCounts(summary?.status_counts || {})
  }'''
text = text[:start] + new_block + text[end:]

replace_once(
"""  async function loadData() {
    await Promise.all([
      loadLookups(),
      loadLeadPage(page, filter)
    ])
  }""",
"""  async function loadData() {
    await Promise.all([
      loadLookups(),
      loadAllLeads(filter)
    ])
  }""",
'loadData contínuo'
)

replace_once(
"""  useEffect(() => {
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
  }, [organization.id, filter.search, filter.segment, filter.status])""",
"""  useEffect(() => {
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
  }, [organization.id, filter.search, filter.segment, filter.status])""",
'filtros sem página'
)

replace_once(
"""  useEffect(() => {
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
  }, [organization.id, page, filter.search, filter.segment, filter.status])""",
"""  useEffect(() => {
    let active = true

    async function refreshVisibleLeads() {
      if (!active) return
      await loadAllLeads(filter)
    }

    function handleFocus() {
      refreshVisibleLeads()
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      active = false
      window.removeEventListener('focus', handleFocus)
    }
  }, [organization.id, filter.search, filter.segment, filter.status])""",
'refresh sem polling pesado'
)

replace_once(
"""  const visibleLeads = leads
  const totalPages = Math.max(1, Math.ceil(totalLeads / LEADS_PAGE_SIZE))

  async function goToPage(nextPage) {
    const safePage = Math.min(Math.max(nextPage, 0), totalPages - 1)
    if (safePage === page) return
    setSelected(new Set())
    await loadLeadPage(safePage, filter)
  }

  const eligibleVisibleLeads""",
"""  const visibleLeads = leads

  const eligibleVisibleLeads""",
'remover navegação de páginas'
)

replace_once(
"""          <h1>Leads</h1>
          <p className=\"muted\">Selecione as empresas que devem receber a mensagem definida para o público-alvo.</p>""",
"""          <h1>Leads</h1>
          <p className=\"muted\">Acompanhe continuamente os leads e mova cada oportunidade pelas etapas do funil.</p>""",
'texto do cabeçalho do funil'
)

pagination = r'''

      <section className="bulk-toolbar">
        <div>
          <strong>{totalLeads}</strong> lead{totalLeads === 1 ? '' : 's'} encontrado{totalLeads === 1 ? '' : 's'}
          <span className="muted"> • Página {page + 1} de {totalPages} • até {LEADS_PAGE_SIZE} por página</span>
        </div>
        <div className="bulk-actions">
          <button className="secondary inline-btn" onClick={() => goToPage(page - 1)} disabled={page <= 0}>Anterior</button>
          <button className="secondary inline-btn" onClick={() => goToPage(page + 1)} disabled={page >= totalPages - 1}>Próxima</button>
        </div>
      </section>'''
replace_once(pagination, '', 'barra de paginação')

APP.write_text(text, encoding='utf-8')
print('V82 aplicada: funil contínuo, sem paginação visual e sem polling pesado.')
