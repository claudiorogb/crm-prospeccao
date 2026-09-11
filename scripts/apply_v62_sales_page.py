from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f'V62: marcador não encontrado: {label}')
    text = text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# 1) Nova página VENDAS: consulta somente o período selecionado e aproveita o
#    índice existente por organização/data da tabela sales.
# -----------------------------------------------------------------------------
sales_page = r'''function SalesPage({ organization, userEmail }) {
  const [period, setPeriod] = useState('month')
  const [customStart, setCustomStart] = useState(currentBrazilDate())
  const [customEnd, setCustomEnd] = useState(currentBrazilDate())
  const [salesRows, setSalesRows] = useState([])
  const [loadingSales, setLoadingSales] = useState(false)
  const [message, setMessage] = useState('')

  function shiftIsoDate(isoDate, days) {
    const [year, month, day] = String(isoDate).split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  }

  function resolveRange() {
    const today = currentBrazilDate()

    if (period === 'today') return { start: today, end: today }
    if (period === 'yesterday') {
      const yesterday = shiftIsoDate(today, -1)
      return { start: yesterday, end: yesterday }
    }
    if (period === 'week') {
      const [year, month, day] = today.split('-').map(Number)
      const current = new Date(Date.UTC(year, month - 1, day))
      const weekday = current.getUTCDay()
      const daysFromMonday = weekday === 0 ? 6 : weekday - 1
      return { start: shiftIsoDate(today, -daysFromMonday), end: today }
    }
    if (period === 'month') return { start: `${today.slice(0, 7)}-01`, end: today }
    if (period === 'year') return { start: `${today.slice(0, 4)}-01-01`, end: today }
    return { start: customStart, end: customEnd }
  }

  async function loadSales() {
    const { start, end } = resolveRange()

    if (!start || !end) {
      setSalesRows([])
      setMessage('Informe a data inicial e a data final do período personalizado.')
      return
    }

    if (start > end) {
      setSalesRows([])
      setMessage('A data inicial não pode ser posterior à data final.')
      return
    }

    setLoadingSales(true)
    setMessage('')

    const { data, error } = await supabase
      .from('sales')
      .select('id,lead_id,sale_date,amount,product_service,notes,origin,created_at,leads(business_name,contact_name)')
      .eq('organization_id', organization.id)
      .is('deleted_at', null)
      .gte('sale_date', start)
      .lte('sale_date', end)
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      setSalesRows([])
      setMessage(`Não foi possível carregar as vendas: ${error.message}`)
    } else {
      setSalesRows(data || [])
    }

    setLoadingSales(false)
  }

  useEffect(() => {
    loadSales()
  }, [organization.id, period, customStart, customEnd])

  const totalValue = salesRows.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)
  const averageTicket = salesRows.length ? totalValue / salesRows.length : 0
  const { start: rangeStart, end: rangeEnd } = resolveRange()

  function formatSaleDate(value) {
    if (!value) return '—'
    return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')
  }

  function periodLabel() {
    const labels = {
      today: 'Hoje',
      yesterday: 'Ontem',
      week: 'Semana',
      month: 'Mês',
      year: 'Ano',
      custom: 'Personalizado'
    }
    return labels[period] || 'Período'
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">COMERCIAL</span>
          <h1>Vendas</h1>
          <p className="muted">Consulte as vendas registradas por período.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <section className="panel sales-period-panel-v62">
        <div className="sales-period-main-v62">
          <label>
            Período das vendas
            <select value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="today">Hoje</option>
              <option value="yesterday">Ontem</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
              <option value="year">Ano</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>

          {period === 'custom' && (
            <div className="sales-custom-range-v62">
              <label>
                De
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              </label>
              <span className="sales-range-separator-v62">até</span>
              <label>
                Até
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </label>
            </div>
          )}
        </div>

        <div className="sales-period-current-v62">
          <span>{periodLabel()}</span>
          <strong>{rangeStart && rangeEnd ? `${formatSaleDate(rangeStart)} até ${formatSaleDate(rangeEnd)}` : 'Defina o período'}</strong>
        </div>
      </section>

      {message && <div className="notice error">{message}</div>}

      <section className="sales-summary-grid-v62">
        <StatCard label="Total vendido" value={formatCurrency(totalValue)} detail="Soma das vendas no período" />
        <StatCard label="Quantidade de vendas" value={salesRows.length} detail="Registros no período" />
        <StatCard label="Ticket médio" value={formatCurrency(averageTicket)} detail="Média por venda" />
      </section>

      <section className="panel sales-list-panel-v62">
        <div className="panel-head">
          <div>
            <span className="eyebrow">VENDAS DO PERÍODO</span>
            <h2>Movimentações</h2>
          </div>
          <button type="button" className="secondary inline-btn" onClick={loadSales} disabled={loadingSales}>
            <RefreshCw size={15}/>{loadingSales ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>

        {loadingSales && !salesRows.length ? (
          <p className="muted">Carregando vendas...</p>
        ) : salesRows.length === 0 ? (
          <div className="sales-empty-v62">
            <strong>Nenhuma venda neste período</strong>
            <span>Altere o período para consultar outros registros.</span>
          </div>
        ) : (
          <div className="sales-table-v62">
            <div className="sales-table-row-v62 sales-table-head-v62">
              <span>Data</span>
              <span>Cliente</span>
              <span>Produto / serviço</span>
              <span>Origem</span>
              <span>Valor</span>
            </div>
            {salesRows.map(sale => (
              <div className="sales-table-row-v62" key={sale.id}>
                <span>{formatSaleDate(sale.sale_date)}</span>
                <span className="sales-client-v62">
                  <strong>{sale.leads?.business_name || 'Cliente'}</strong>
                  {sale.leads?.contact_name && <small>{sale.leads.contact_name}</small>}
                </span>
                <span>{sale.product_service || '—'}</span>
                <span>{sale.origin === 'won_conversion' ? 'Contrato inicial' : 'Venda registrada'}</span>
                <strong className="sales-value-v62">{formatCurrency(sale.amount)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}


'''

admin_marker = 'function Administration({ organizations, reloadOrganizations, userEmail }) {'
if admin_marker not in text:
    raise SystemExit('V62: componente Administration não encontrado.')
text = text.replace(admin_marker, sales_page + admin_marker, 1)


# -----------------------------------------------------------------------------
# 2) Menu principal: Vendas fica como página própria da organização.
# -----------------------------------------------------------------------------
funnel_nav = '''          <button className={`nav-item ${page === 'sales-funnel' ? 'active' : ''}`} onClick={() => { setPage('sales-funnel'); setMobileMenuOpen(false) }}>
            <Users size={18}/> Funil de vendas
          </button>
'''
if funnel_nav not in text:
    raise SystemExit('V62: botão Funil de vendas não encontrado no menu.')

sales_nav = funnel_nav + '''          <button className={`nav-item ${page === 'sales' ? 'active' : ''}`} onClick={() => { setPage('sales'); setMobileMenuOpen(false) }}>
            <Activity size={18}/> Vendas
          </button>
'''
text = text.replace(funnel_nav, sales_nav, 1)


# -----------------------------------------------------------------------------
# 3) Rota da página Vendas, sem interferir no Funil, Clientes ou Administração.
# -----------------------------------------------------------------------------
funnel_route = """        {page === 'sales-funnel' && settings?.feature_flags?.leads !== false && (\n"""
if funnel_route not in text:
    raise SystemExit('V62: rota do Funil não encontrada.')

sales_route = """        {page === 'sales' && (\n          <SalesPage organization={organization} userEmail={userEmail} />\n        )}\n""" + funnel_route
text = text.replace(funnel_route, sales_route, 1)


# -----------------------------------------------------------------------------
# 4) Visual da página: filtro compacto, resumo e tabela responsiva.
# -----------------------------------------------------------------------------
css += r'''

/* V62 - página Vendas */
.sales-period-panel-v62 {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}
.sales-period-main-v62 {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}
.sales-period-main-v62 > label {
  min-width: 220px;
}
.sales-custom-range-v62 {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.sales-custom-range-v62 label {
  min-width: 160px;
}
.sales-range-separator-v62 {
  padding-bottom: 11px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}
.sales-period-current-v62 {
  display: grid;
  gap: 3px;
  text-align: right;
  padding-bottom: 3px;
}
.sales-period-current-v62 span {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.sales-period-current-v62 strong {
  font-size: 13px;
  color: #334155;
}
.sales-summary-grid-v62 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.sales-list-panel-v62 {
  overflow: hidden;
}
.sales-table-v62 {
  display: grid;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}
.sales-table-row-v62 {
  display: grid;
  grid-template-columns: 110px minmax(170px, 1.5fr) minmax(150px, 1.2fr) minmax(120px, .9fr) 130px;
  gap: 12px;
  align-items: center;
  min-width: 760px;
  padding: 11px 14px;
  border-bottom: 1px solid #e2e8f0;
  font-size: 12px;
}
.sales-table-row-v62:last-child {
  border-bottom: 0;
}
.sales-table-head-v62 {
  background: #f8fafc;
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.sales-client-v62 {
  display: grid;
  gap: 2px;
}
.sales-client-v62 small {
  color: #94a3b8;
  font-size: 10px;
}
.sales-value-v62 {
  text-align: right;
  white-space: nowrap;
}
.sales-empty-v62 {
  display: grid;
  gap: 5px;
  text-align: center;
  padding: 34px 18px;
  color: #64748b;
}
.sales-empty-v62 strong {
  color: #334155;
}

@media (max-width: 900px) {
  .sales-period-panel-v62 {
    align-items: stretch;
    flex-direction: column;
  }
  .sales-period-current-v62 {
    text-align: left;
  }
  .sales-list-panel-v62 {
    overflow-x: auto;
  }
}

@media (max-width: 760px) {
  .sales-summary-grid-v62 {
    grid-template-columns: 1fr;
  }
  .sales-custom-range-v62 {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }
  .sales-custom-range-v62 label,
  .sales-period-main-v62 > label {
    min-width: 0;
    width: 100%;
  }
  .sales-range-separator-v62 {
    display: none;
  }
}
'''


# -----------------------------------------------------------------------------
# 5) Validação forte: página, períodos, menu e rota precisam existir juntos.
# -----------------------------------------------------------------------------
checks = [
    ('componente Vendas', 'function SalesPage({ organization, userEmail }) {' in text),
    ('menu Vendas', "page === 'sales'" in text and '<Activity size={18}/> Vendas' in text),
    ('rota Vendas', '<SalesPage organization={organization} userEmail={userEmail} />' in text),
    ('lista Período das vendas', 'Período das vendas' in text),
    ('Hoje', '<option value="today">Hoje</option>' in text),
    ('Ontem', '<option value="yesterday">Ontem</option>' in text),
    ('Semana', '<option value="week">Semana</option>' in text),
    ('Mês', '<option value="month">Mês</option>' in text),
    ('Ano', '<option value="year">Ano</option>' in text),
    ('Personalizado', '<option value="custom">Personalizado</option>' in text and 'customStart' in text and 'customEnd' in text),
    ('consulta vendas por período', ".from('sales')" in text and ".gte('sale_date', start)" in text and ".lte('sale_date', end)" in text),
    ('resumo de vendas', 'Total vendido' in text and 'Quantidade de vendas' in text and 'Ticket médio' in text),
    ('Equipe do Dashboard preservada', '<TeamPerformance organization={organization} />' in text),
    ('Funil preservado', "page === 'sales-funnel'" in text),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V62 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V62 aplicada: página Vendas com filtros Hoje/Ontem/Semana/Mês/Ano/Personalizado e resumo do período.')
