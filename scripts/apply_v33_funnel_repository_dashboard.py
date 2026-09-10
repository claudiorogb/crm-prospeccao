from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def replace_between(start_marker, end_marker, replacement, label):
    global text
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'Início não encontrado: {label}')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'Fim não encontrado: {label}')
    text = text[:start] + replacement + text[end:]


# 1) Dashboard: inclui negócios perdidos e valor total das propostas perdidas.
dashboard = r'''function Dashboard({ organization, userEmail, onGoCampaigns }) {
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
    return () => {
      active = false
      clearInterval(timer)
    }
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

      <section className="panel dashboard-shortcut clickable" onClick={onGoCampaigns}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">PROSPECÇÃO</span>
            <h2>Campanhas</h2>
          </div>
          <ChevronRight />
        </div>
        <p>Cadastre públicos, campanhas, captação, mensagens, envios e números de WhatsApp em um único lugar.</p>
      </section>
    </>
  )
}


'''
replace_between('function Dashboard({ organization, userEmail, onGoCampaigns }) {', 'function CatalogAdmin', dashboard, 'Dashboard')


# 2) Ao enviar lead para Sem interesse ou Descartado, registra o motivo/observação.
status_handler = r'''  async function updateStatus(id, status) {
    let repositoryNote = null

    if (status === 'not_interested') {
      repositoryNote = window.prompt('Informe o motivo do não interesse:')
      if (repositoryNote === null) return
      if (!repositoryNote.trim()) {
        window.alert('Informe o motivo do não interesse antes de enviar o lead para Leads sem interesse.')
        return
      }
    }

    if (status === 'discarded') {
      repositoryNote = window.prompt('Informe o motivo do descarte (opcional):')
      if (repositoryNote === null) return
    }

    const payload = { status }
    if (repositoryNote !== null && repositoryNote.trim()) {
      payload.commercial_notes = repositoryNote.trim()
    }

    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', id)
      .eq('organization_id', organization.id)

    if (!error) {
      setLeads(old => old.map(l => l.id === id ? { ...l, ...payload } : l))
    }
  }


'''
replace_between('  async function updateStatus(id, status) {', '  async function updateLeadContactField', status_handler, 'updateStatus')


# 3) Retira Sem interesse do funil. Descartado e Na fila já ficam fora.
old_filter = ".filter(([status]) => !['discarded','queued'].includes(status))"
new_filter = ".filter(([status]) => !['discarded','queued','not_interested'].includes(status))"
if old_filter not in text:
    raise SystemExit('Filtro do Kanban não encontrado.')
text = text.replace(old_filter, new_filter, 1)


# 4) Leads sem interesse: reúne Sem interesse e Descartados, mostra observação e permite retorno ao funil.
repository = r'''function NotInterestedRepository({ organization, userEmail }) {
  const [leads, setLeads] = useState([])
  const [message, setMessage] = useState('')

  async function loadData() {
    const { data, error } = await supabase
      .from('leads')
      .select('id,business_name,phone,city,state,status,commercial_notes,campaigns(name)')
      .eq('organization_id', organization.id)
      .in('status', ['not_interested','discarded'])
      .order('updated_at', { ascending: false })

    if (error) setMessage(error.message)
    else setLeads(data || [])
  }

  useEffect(() => { loadData() }, [organization.id])

  async function returnToFunnel(lead) {
    if (!window.confirm(`Retornar "${lead.business_name}" ao funil como Novo?`)) return

    const { error } = await supabase
      .from('leads')
      .update({ status: 'new', updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('organization_id', organization.id)

    if (error) setMessage(error.message)
    else {
      setMessage(`${lead.business_name} retornou ao funil como Novo.`)
      await loadData()
    }
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">FUNIL DE VENDAS</span>
          <h1>Leads sem interesse</h1>
          <p className="muted">Leads sem interesse e descartados ficam fora do funil, mas podem ser recuperados.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="repository-list-v33">
        {leads.length === 0 ? (
          <article className="panel empty-state">
            <Users size={34}/>
            <h2>Nenhum lead nesta área</h2>
            <p>Leads marcados como Sem interesse ou Descartado aparecerão aqui.</p>
          </article>
        ) : leads.map(lead => (
          <article className="panel repository-row-v33" key={lead.id}>
            <div className="repository-main-v33">
              <div className="repository-title-v33">
                <strong>{lead.business_name}</strong>
                <span className={`repository-status-v33 ${lead.status === 'discarded' ? 'discarded' : 'not-interested'}`}>
                  {lead.status === 'discarded' ? 'Descartado' : 'Sem interesse'}
                </span>
              </div>
              <span>{lead.campaigns?.name || 'Sem campanha'} • {lead.city || '—'}{lead.state ? ` / ${lead.state}` : ''} • {lead.phone || 'Sem telefone'}</span>
              <div className="repository-note-v33">
                <span>Observações</span>
                <p>{lead.commercial_notes || 'Nenhuma observação registrada.'}</p>
              </div>
            </div>
            <button className="secondary" onClick={() => returnToFunnel(lead)}>Retornar ao funil</button>
          </article>
        ))}
      </section>
    </>
  )
}


'''
replace_between('function NotInterestedRepository({ organization, userEmail }) {', 'function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {', repository, 'Leads sem interesse')


# 5) Renomeia a subpágina Repositório para Leads sem interesse.
old_repo_button = ">Repositório</button>"
if old_repo_button not in text:
    raise SystemExit('Botão Repositório não encontrado.')
text = text.replace(old_repo_button, '>Leads sem interesse</button>', 1)


# 6) CSS: nomes mais legíveis, colunas um pouco maiores e rolagem horizontal sempre acessível.
css += r'''

/* V33 - funil, leads sem interesse e rolagem */
.sales-kanban {
  grid-template-columns: repeat(8, 320px) !important;
  gap: 14px;
}
.kanban-column {
  width: 320px !important;
}
.kanban-lead-card h3 {
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 1.22;
  letter-spacing: -0.01em;
  word-break: normal !important;
  overflow-wrap: normal !important;
  hyphens: none;
}
.kanban-card-top > div {
  width: 100%;
  min-width: 0;
}
.sales-kanban-always-scroll {
  height: calc(100dvh - 300px) !important;
  min-height: 300px !important;
  max-height: 680px !important;
  overflow-x: scroll !important;
  overflow-y: auto !important;
  padding-bottom: 12px !important;
  scrollbar-gutter: stable both-edges;
  scrollbar-width: auto;
  overscroll-behavior: contain;
}
.sales-kanban-always-scroll::-webkit-scrollbar {
  height: 14px;
  width: 12px;
}
.sales-kanban-always-scroll::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 999px;
  border: 3px solid #f1f5f9;
}
.sales-kanban-always-scroll::-webkit-scrollbar-track {
  background: #f1f5f9;
}
.repository-list-v33 {
  display: grid;
  gap: 12px;
}
.repository-row-v33 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.repository-main-v33 {
  min-width: 0;
  display: grid;
  gap: 7px;
}
.repository-main-v33 > span {
  color: #64748b;
  font-size: 13px;
}
.repository-title-v33 {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.repository-status-v33 {
  padding: 5px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  background: #fff7ed;
  color: #9a3412;
}
.repository-status-v33.discarded {
  background: #f1f5f9;
  color: #475569;
}
.repository-note-v33 {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 9px;
  background: #f8fafc;
}
.repository-note-v33 span {
  display: block;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 3px;
}
.repository-note-v33 p {
  margin: 0;
  color: #475569;
  line-height: 1.45;
  font-size: 13px;
}
.dashboard-commercial-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
}
@media (max-width: 900px) {
  .dashboard-commercial-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .sales-kanban-always-scroll { height: calc(100dvh - 260px) !important; min-height: 280px !important; }
}
@media (max-width: 600px) {
  .dashboard-commercial-grid { grid-template-columns: 1fr !important; }
  .repository-row-v33 { align-items: stretch; flex-direction: column; }
  .sales-kanban-always-scroll { height: calc(100dvh - 230px) !important; min-height: 260px !important; }
}
'''


# 7) Validação: o build falha se algum requisito desta rodada não estiver presente.
def component(start_marker, end_marker):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'Componente ausente: {start_marker}')
    return text[start:end]

leads = component('function Leads({ organization, settings, userEmail }) {', 'function Clients({ organization, userEmail, userId }) {')
repo = component('function NotInterestedRepository({ organization, userEmail }) {', 'function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {')
dash = component('function Dashboard({ organization, userEmail, onGoCampaigns }) {', 'function CatalogAdmin')
sales = component('function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {', 'function AdminOverview')

checks = [
    ('Sem interesse fora do funil', "!['discarded','queued','not_interested'].includes(status)" in leads),
    ('Motivo obrigatório para Sem interesse', "Informe o motivo do não interesse" in leads),
    ('Descartados no repositório', ".in('status', ['not_interested','discarded'])" in repo),
    ('Observações no repositório', 'commercial_notes' in repo and 'Observações' in repo),
    ('Retorno ao funil', 'returnToFunnel' in repo and 'Retornar ao funil' in repo),
    ('Nome Leads sem interesse', 'Leads sem interesse' in sales),
    ('Perdidos no dashboard', 'lostValue' in dash and 'Negócios perdidos' in dash),
    ('Rolagem horizontal forçada', 'overflow-x: scroll !important' in css),
    ('Nome de lead sem quebra agressiva', 'word-break: normal !important' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V33 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V33 aplicada e validada com sucesso.')
