from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

# 1) Substitui o carregamento contínuo irrestrito por carregamento contínuo das etapas ativas
# e limite visual de 50 itens para Ganho, Perdido e Sem interesse.
start = text.index("  async function loadAllLeads(currentFilter = filter) {")
end = text.index("\n\n  async function loadData() {", start)

new_loader = r'''  const ACTIVE_FUNNEL_STATUSES = ['new', 'qualified', 'queued', 'contacted', 'replied', 'interested']
  const TERMINAL_FUNNEL_STATUSES = ['not_interested', 'won', 'lost']
  const TERMINAL_VISIBLE_LIMIT = 50

  function matchesTerminalFilter(lead, currentFilter) {
    if (currentFilter.status !== 'all' && lead.status !== currentFilter.status) return false
    if (currentFilter.segment !== 'all' && lead.target_segment_id !== currentFilter.segment) return false

    const q = currentFilter.search.trim().toLowerCase()
    if (!q) return true

    return [lead.business_name, lead.city, lead.phone]
      .some(value => String(value || '').toLowerCase().includes(q))
  }

  async function loadActiveStatus(status, currentFilter) {
    const batchSize = 100
    let offset = 0
    let rows = []

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
      const batchRows = Array.isArray(payload.rows) ? payload.rows : []
      rows = [...rows, ...batchRows]

      const total = Number(payload.total || 0)
      if (!batchRows.length || rows.length >= total) break
      offset += batchRows.length
    }

    return rows
  }

  async function loadTerminalPreview(status, currentFilter) {
    const { data, error } = await supabase
      .from('leads')
      .select('id,organization_id,campaign_id,target_segment_id,business_name,segment,phone,website,email,address,city,state,status,contact_name,last_contact_date,last_contacted_at,next_contact_date,commercial_notes,proposal_value,proposal_sent_at,renegotiated_value,contract_value,contract_signed_at,lost_from_status,captured_by,assigned_to,created_at,status_changed_at,campaigns(name),target_segments(name)')
      .eq('organization_id', organization.id)
      .eq('status', status)
      .is('deleted_at', null)
      .order('status_changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(TERMINAL_VISIBLE_LIMIT)

    if (error) throw error
    return (data || []).filter(lead => matchesTerminalFilter(lead, currentFilter))
  }

  async function loadAllLeads(currentFilter = filter) {
    try {
      const requestedActiveStatuses = currentFilter.status === 'all'
        ? ACTIVE_FUNNEL_STATUSES
        : ACTIVE_FUNNEL_STATUSES.includes(currentFilter.status)
          ? [currentFilter.status]
          : []

      const requestedTerminalStatuses = currentFilter.status === 'all'
        ? TERMINAL_FUNNEL_STATUSES
        : TERMINAL_FUNNEL_STATUSES.includes(currentFilter.status)
          ? [currentFilter.status]
          : []

      const [activeGroups, terminalGroups] = await Promise.all([
        Promise.all(requestedActiveStatuses.map(status => loadActiveStatus(status, currentFilter))),
        Promise.all(requestedTerminalStatuses.map(status => loadTerminalPreview(status, currentFilter)))
      ])

      const rows = [...activeGroups.flat(), ...terminalGroups.flat()]
        .sort((a, b) => new Date(b.status_changed_at || b.created_at || 0) - new Date(a.status_changed_at || a.created_at || 0))

      const counts = {}
      for (const lead of rows) counts[lead.status] = Number(counts[lead.status] || 0) + 1

      setLeads(rows)
      setTotalLeads(rows.length)
      setStatusCounts(counts)
    } catch (error) {
      setMessage(`Não foi possível carregar os leads: ${error.message}`)
    }
  }'''

text = text[:start] + new_loader + text[end:]

# 2) Ao mudar status, recarrega o Kanban para a regra dos 50 ser aplicada imediatamente.
old_update = r'''  async function updateStatus(id, status) {
    const { error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', id)
      .eq('organization_id', organization.id)
    if (!error) setLeads(old => old.map(l => l.id === id ? { ...l, status } : l))
  }'''

new_update = r'''  async function updateStatus(id, status) {
    const { error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', id)
      .eq('organization_id', organization.id)

    if (error) {
      setMessage(`Não foi possível atualizar o status: ${error.message}`)
      return
    }

    await loadAllLeads(filter)
  }'''

if old_update not in text:
    raise SystemExit('Bloco updateStatus não encontrado')
text = text.replace(old_update, new_update, 1)

# 3) Remove "Descartado" das opções de filtro do Kanban, já que não existe coluna para ele.
old_filter_options = """          {Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}"""
new_filter_options = """          {Object.entries(statusLabel)
            .filter(([value]) => value !== 'discarded')
            .map(([value,label])=><option key={value} value={value}>{label}</option>)}"""
if old_filter_options not in text:
    raise SystemExit('Filtro de status do Kanban não encontrado')
text = text.replace(old_filter_options, new_filter_options, 1)

# 4) Cria a área Encerrados. Apenas Perdido e Sem interesse acima dos 50 mais recentes
# de cada status entram aqui. Nenhum registro é movido ou apagado.
marker = "\nfunction SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {"
if marker not in text:
    raise SystemExit('SalesFunnelWorkspace não encontrado')

closed_component = r'''
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
'''

text = text.replace(marker, closed_component + marker, 1)

# 5) Adiciona Encerrados como terceira aba do Funil de vendas.
old_workspace = r'''function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {
  const [section, setSection] = useState('leads')
  return (
    <>
      <div className="workspace-tabs">
        <button className={section === 'leads' ? 'active' : ''} onClick={() => setSection('leads')}>Leads</button>
        <button className={section === 'clients' ? 'active' : ''} onClick={() => setSection('clients')}>Clientes</button>
      </div>
      {section === 'leads' && <Leads organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'clients' && <Clients organization={organization} userEmail={userEmail} userId={userId} />}
    </>
  )
}'''

new_workspace = r'''function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {
  const [section, setSection] = useState('leads')
  return (
    <>
      <div className="workspace-tabs">
        <button className={section === 'leads' ? 'active' : ''} onClick={() => setSection('leads')}>Leads</button>
        <button className={section === 'clients' ? 'active' : ''} onClick={() => setSection('clients')}>Clientes</button>
        <button className={section === 'closed' ? 'active' : ''} onClick={() => setSection('closed')}>Encerrados</button>
      </div>
      {section === 'leads' && <Leads organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'clients' && <Clients organization={organization} userEmail={userEmail} userId={userId} />}
      {section === 'closed' && <ClosedLeads organization={organization} userEmail={userEmail} />}
    </>
  )
}'''

if old_workspace not in text:
    raise SystemExit('SalesFunnelWorkspace original não encontrado')
text = text.replace(old_workspace, new_workspace, 1)

APP.write_text(text, encoding='utf-8')
print('V83 aplicada: limite de 50 em status terminais e área Encerrados.')
