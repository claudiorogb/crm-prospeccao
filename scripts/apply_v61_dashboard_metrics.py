from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V61: componente não encontrado: {label}')
    return start, end


# Substitui somente o Dashboard da empresa. TeamPerformance fica intacto.
start, end = bounds(
    'function Dashboard({ organization, userEmail, onGoCampaigns }) {',
    'function CatalogAdmin',
    'Dashboard'
)

new_dashboard = r'''function Dashboard({ organization, userEmail, onGoCampaigns }) {
  const [stats, setStats] = useState({
    ongoing: 0,
    negotiation: 0,
    proposalsSent: 0,
    interested: 0,
    won: 0,
    lost: 0,
    captured: 0,
    registered: 0,
    contacted: 0,
    responded: 0
  })
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true

    async function loadStats() {
      const { data, error } = await supabase
        .rpc('get_dashboard_stats', { p_organization_id: organization.id })

      if (!active) return

      if (error) {
        setMessage(`Não foi possível atualizar o Dashboard: ${error.message}`)
        return
      }

      setMessage('')
      setStats({
        ongoing: Number(data?.ongoing || 0),
        negotiation: Number(data?.negotiation || 0),
        proposalsSent: Number(data?.proposals_sent || 0),
        interested: Number(data?.interested || 0),
        won: Number(data?.won || 0),
        lost: Number(data?.lost || 0),
        captured: Number(data?.captured || 0),
        registered: Number(data?.registered || 0),
        contacted: Number(data?.contacted || 0),
        responded: Number(data?.responded || 0)
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
          <p className="muted">Visão resumida do funil, resultados e atividade comercial.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="panel dashboard-block-v61 dashboard-funnel-v61">
        <div className="dashboard-block-head-v61">
          <div>
            <span className="eyebrow">FUNIL ATIVO</span>
            <h2>Negócios em andamento</h2>
            <p className="muted">Somente oportunidades que já chegaram a Interessado e ainda não foram encerradas.</p>
          </div>
        </div>

        <div className="dashboard-hero-v61">
          <StatCard
            label="Negócios em andamento"
            value={stats.ongoing}
            detail="Interessado + Proposta + Negociação"
          />
        </div>

        <div className="dashboard-metric-grid-v61 dashboard-metric-grid-three-v61">
          <StatCard label="Total em Negociação" value={stats.negotiation} detail="Oportunidades na etapa Negociação" />
          <StatCard label="Total de propostas enviadas" value={stats.proposalsSent} detail="Leads que já tiveram proposta registrada" />
          <StatCard label="Total Interessados" value={stats.interested} detail="Oportunidades atualmente em Interessado" />
        </div>
      </section>

      <section className="panel dashboard-block-v61">
        <div className="dashboard-block-head-v61">
          <div>
            <span className="eyebrow">RESULTADOS</span>
            <h2>Fechamentos</h2>
            <p className="muted">Resultado das oportunidades que saíram do funil ativo.</p>
          </div>
        </div>
        <div className="dashboard-metric-grid-v61 dashboard-metric-grid-two-v61">
          <StatCard label="Ganhos" value={stats.won} detail="Negócios convertidos em clientes" />
          <StatCard label="Perdidos" value={stats.lost} detail="Negócios encerrados como perdidos" />
        </div>
      </section>

      <section className="panel dashboard-block-v61">
        <div className="dashboard-block-head-v61">
          <div>
            <span className="eyebrow">BASE COMERCIAL</span>
            <h2>Leads e contatos</h2>
            <p className="muted">Origem dos leads e avanço inicial da prospecção.</p>
          </div>
        </div>
        <div className="dashboard-metric-grid-v61 dashboard-metric-grid-four-v61">
          <StatCard label="Total de leads captados" value={stats.captured} detail="Captados pela busca de empresas" />
          <StatCard label="Total de leads cadastrados" value={stats.registered} detail="Cadastrados manualmente" />
          <StatCard label="Total Leads contatados" value={stats.contacted} detail="Leads que já receberam contato" />
          <StatCard label="Total que respondeu" value={stats.responded} detail="Responderam ou avançaram após a resposta" />
        </div>
      </section>

      <TeamPerformance organization={organization} />
    </>
  )
}


'''

text = text[:start] + new_dashboard + text[end:]

css += r'''

/* V61 - Dashboard comercial organizado por funil, resultados e base */
.dashboard-block-v61 {
  margin-bottom: 16px;
}
.dashboard-block-head-v61 {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.dashboard-block-head-v61 h2 {
  margin: 3px 0 4px;
}
.dashboard-block-head-v61 p {
  margin: 0;
}
.dashboard-hero-v61 {
  margin-bottom: 12px;
}
.dashboard-hero-v61 .stat-card {
  min-height: 132px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-width: 1px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .06);
}
.dashboard-hero-v61 .stat-value {
  font-size: 40px;
  line-height: 1;
  margin-bottom: 7px;
}
.dashboard-hero-v61 .stat-label {
  font-size: 14px;
}
.dashboard-metric-grid-v61 {
  display: grid;
  gap: 12px;
}
.dashboard-metric-grid-v61 .stat-card {
  min-width: 0;
  height: 100%;
}
.dashboard-metric-grid-three-v61 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.dashboard-metric-grid-two-v61 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.dashboard-metric-grid-four-v61 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.dashboard-funnel-v61 {
  border-top-width: 3px;
}

@media (max-width: 1050px) {
  .dashboard-metric-grid-four-v61 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .dashboard-metric-grid-three-v61,
  .dashboard-metric-grid-two-v61,
  .dashboard-metric-grid-four-v61 {
    grid-template-columns: 1fr;
  }
  .dashboard-hero-v61 .stat-value {
    font-size: 34px;
  }
}
'''

# Validação forte: todos os 10 indicadores e a seção EQUIPE devem continuar presentes.
start, end = bounds(
    'function Dashboard({ organization, userEmail, onGoCampaigns }) {',
    'function CatalogAdmin',
    'Dashboard final'
)
check = text[start:end]
required_labels = [
    'Negócios em andamento',
    'Total em Negociação',
    'Total de propostas enviadas',
    'Total Interessados',
    'Ganhos',
    'Perdidos',
    'Total de leads captados',
    'Total de leads cadastrados',
    'Total Leads contatados',
    'Total que respondeu'
]
checks = [
    ('todos os 10 indicadores', all(label in check for label in required_labels)),
    ('ongoing somente interessado para frente em aberto', "data?.ongoing" in check and 'Interessado + Proposta + Negociação' in check),
    ('dashboard usa RPC agregada', "rpc('get_dashboard_stats'" in check),
    ('Equipe preservada no Dashboard', '<TeamPerformance organization={organization} />' in check),
    ('componente TeamPerformance preservado', 'function TeamPerformance({ organization }) {' in text),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V61 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V61 aplicada: Dashboard reorganizado com 10 indicadores e EQUIPE preservada.')
