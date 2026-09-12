from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')

start = text.find('function SalesPage({ organization, userEmail }) {')
end = text.find('function Administration({ organizations, reloadOrganizations, userEmail }) {', start)
if start < 0 or end < 0:
    raise SystemExit('V67: página Vendas não encontrada.')

sales_page = r'''function SalesPage({ organization, userEmail }) {
  const [period, setPeriod] = useState('month')
  const [customStart, setCustomStart] = useState(currentBrazilDate())
  const [customEnd, setCustomEnd] = useState(currentBrazilDate())
  const [sellerFilter, setSellerFilter] = useState('')
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
    const { data, error } = await supabase.rpc('get_sales_page', {
      p_organization_id: organization.id,
      p_start: start,
      p_end: end
    })

    if (error) {
      setSalesRows([])
      setMessage(`Não foi possível carregar as vendas: ${error.message}`)
    } else {
      setSalesRows(data || [])
    }
    setLoadingSales(false)
  }

  useEffect(() => {
    setSellerFilter('')
    loadSales()
  }, [organization.id, period, customStart, customEnd])

  const sellerOptions = Array.from(
    new Map(
      salesRows.map(row => [row.seller_id || '__unassigned__', row.seller_name || 'Não identificado'])
    ).entries()
  ).map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  const visibleSales = sellerFilter
    ? salesRows.filter(row => (row.seller_id || '__unassigned__') === sellerFilter)
    : salesRows

  const totalValue = visibleSales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)
  const averageTicket = visibleSales.length ? totalValue / visibleSales.length : 0
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
          <p className="muted">Consulte as vendas registradas por período e vendedor.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <section className="panel sales-period-panel-v62">
        <div className="sales-period-main-v62 sales-filters-v67">
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

          <label>
            Vendedor
            <select value={sellerFilter} onChange={e => setSellerFilter(e.target.value)}>
              <option value="">Todos os vendedores</option>
              {sellerOptions.map(seller => (
                <option key={seller.id} value={seller.id}>{seller.name}</option>
              ))}
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
        <StatCard label="Total vendido" value={formatCurrency(totalValue)} detail="Soma das vendas filtradas" />
        <StatCard label="Quantidade de vendas" value={visibleSales.length} detail="Registros filtrados" />
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
        ) : visibleSales.length === 0 ? (
          <div className="sales-empty-v62">
            <strong>Nenhuma venda neste filtro</strong>
            <span>Altere o período ou o vendedor para consultar outros registros.</span>
          </div>
        ) : (
          <div className="sales-table-v62 sales-table-v67">
            <div className="sales-table-row-v62 sales-table-row-v67 sales-table-head-v62">
              <span>Data</span>
              <span>Cliente</span>
              <span>Vendedor</span>
              <span>Produto / serviço</span>
              <span>Origem</span>
              <span>Valor</span>
            </div>
            {visibleSales.map(sale => (
              <div className="sales-table-row-v62 sales-table-row-v67" key={sale.id}>
                <span>{formatSaleDate(sale.sale_date)}</span>
                <span className="sales-client-v62">
                  <strong>{sale.business_name || 'Cliente'}</strong>
                  {sale.contact_name && <small>{sale.contact_name}</small>}
                </span>
                <span>{sale.seller_name || 'Não identificado'}</span>
                <span>{sale.product_service || '—'}</span>
                <span>{sale.source_label || '—'}</span>
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

text = text[:start] + sales_page + text[end:]

css += r'''

/* V67 - vendedor e origem na página Vendas */
.sales-filters-v67 > label {
  min-width: 220px;
}
.sales-table-row-v67 {
  grid-template-columns: 105px minmax(170px, 1.45fr) minmax(140px, 1fr) minmax(150px, 1.15fr) minmax(130px, .95fr) 125px !important;
  min-width: 940px !important;
}
@media (max-width: 760px) {
  .sales-filters-v67 > label {
    width: 100%;
    min-width: 0;
  }
}
'''

checks = [
    ('filtro vendedor', 'Todos os vendedores' in text and 'sellerFilter' in sales_page),
    ('coluna vendedor', '<span>Vendedor</span>' in sales_page and 'sale.seller_name' in sales_page),
    ('origem semântica', 'sale.source_label' in sales_page),
    ('RPC seguro', "supabase.rpc('get_sales_page'" in sales_page),
    ('resumo acompanha filtro', 'visibleSales.reduce' in sales_page and 'visibleSales.length' in sales_page),
    ('períodos preservados', '<option value="custom">Personalizado</option>' in sales_page),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('V67: validação falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V67 aplicada: Vendas com filtro por vendedor, coluna vendedor e origem comercial padronizada.')
