from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V69: componente não encontrado: {label}')
    return start, end


# -----------------------------------------------------------------------------
# 1) Histórico comercial: lead + checkpoint passam a ser salvos atomicamente
#    pelo banco. Se uma parte falhar, nenhuma das duas fica gravada pela metade.
# -----------------------------------------------------------------------------
start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)
leads = text[start:end]

save_start = leads.find('  async function saveStageCheckpoint(lead, stage) {')
save_end = leads.find('  async function recoverLostLead(lead) {', save_start)
if save_start < 0 or save_end < 0:
    raise SystemExit('V69: saveStageCheckpoint não encontrado.')

atomic_save = r'''  async function saveStageCheckpoint(lead, stage) {
    if (savingLeadIds.has(lead.id)) return

    setSavingLeadIds(old => new Set([...old, lead.id]))
    setMessage('')

    const note = (noteDrafts[lead.id] || '').trim()
    const proposalValue = parseMoneyValue(lead.proposal_value)
    const renegotiatedValue = parseMoneyValue(lead.renegotiated_value)
    const contractValue = parseMoneyValue(lead.contract_value)

    const { data, error } = await supabase.rpc('save_lead_journey_checkpoint', {
      p_organization_id: organization.id,
      p_lead_id: lead.id,
      p_stage: stage,
      p_contact_name: (lead.contact_name || '').trim() || null,
      p_proposal_value: proposalValue,
      p_proposal_sent_at: lead.proposal_sent_at || null,
      p_renegotiated_value: renegotiatedValue,
      p_next_contact_date: ['replied','interested','proposal','negotiation'].includes(stage) ? (lead.next_contact_date || null) : null,
      p_contract_value: contractValue,
      p_contract_signed_at: lead.contract_signed_at || null,
      p_note: note || null
    })

    if (error) {
      setMessage(`Não foi possível salvar: ${error.message}`)
    } else {
      const entry = Array.isArray(data) ? data[0] : data
      clearDirtyFields(lead.id)
      if (entry?.id) setJourneyEntries(old => [entry, ...old])
      setNoteDrafts(old => ({ ...old, [lead.id]: '' }))
      setMessage('Informações salvas e registradas no histórico.')
    }

    setSavingLeadIds(old => {
      const next = new Set(old)
      next.delete(lead.id)
      return next
    })
  }

'''

leads = leads[:save_start] + atomic_save + leads[save_end:]
text = text[:start] + leads + text[end:]


# -----------------------------------------------------------------------------
# 2) EQUIPE + ORIGEM: substitui o resumo simples por desempenho comercial
#    completo, usando RPCs agregadas e isoladas por organização.
# -----------------------------------------------------------------------------
start, end = bounds(
    'function TeamPerformance({ organization }) {',
    'function Dashboard({ organization, userEmail, onGoCampaigns }) {',
    'TeamPerformance'
)

analytics = r'''function TeamPerformance({ organization }) {
  const [sellerRows, setSellerRows] = useState([])
  const [originRows, setOriginRows] = useState([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      const [sellerResult, originResult] = await Promise.all([
        supabase.rpc('get_seller_performance', { p_organization_id: organization.id }),
        supabase.rpc('get_origin_conversion', { p_organization_id: organization.id })
      ])

      if (!active) return
      if (sellerResult.error || originResult.error) {
        setMessage(sellerResult.error?.message || originResult.error?.message || 'Não foi possível carregar os indicadores comerciais.')
        return
      }

      setMessage('')
      setSellerRows(sellerResult.data || [])
      setOriginRows(originResult.data || [])
    }

    load()
    const timer = setInterval(load, 30000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [organization.id])

  return (
    <>
      {message && <div className="notice error">{message}</div>}

      <section className="panel commercial-analytics-v69">
        <div className="panel-head">
          <div>
            <span className="eyebrow">EQUIPE</span>
            <h2>Desempenho por vendedor</h2>
            <p className="muted">Conversão, propostas e vendas atribuídas a cada usuário da empresa.</p>
          </div>
        </div>

        <div className="analytics-table-v69 seller-table-v69">
          <div className="analytics-row-v69 analytics-head-v69">
            <span>Vendedor</span>
            <span>Em andamento</span>
            <span>Propostas</span>
            <span>Ganhos</span>
            <span>Perdidos</span>
            <span>Conversão</span>
            <span>Vendas</span>
            <span>Ticket médio</span>
          </div>
          {sellerRows.map(row => (
            <div className="analytics-row-v69" key={row.user_id}>
              <span className="analytics-name-v69">
                <strong>{row.seller_name || 'Usuário'}</strong>
                <small>{row.role === 'owner' ? 'Proprietário' : row.role === 'admin' ? 'Administrador' : 'Usuário'}</small>
              </span>
              <span>{Number(row.active_leads || 0)}</span>
              <span>{Number(row.proposals_sent || 0)}</span>
              <span>{Number(row.won_count || 0)}</span>
              <span>{Number(row.lost_count || 0)}</span>
              <span>{Number(row.conversion_rate || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>
              <span><strong>{formatCurrency(row.total_sales || 0)}</strong><small>{Number(row.sales_count || 0)} venda(s)</small></span>
              <span>{formatCurrency(row.average_ticket || 0)}</span>
            </div>
          ))}
          {!sellerRows.length && <p className="muted analytics-empty-v69">Nenhum vendedor ativo encontrado.</p>}
        </div>
      </section>

      <section className="panel commercial-analytics-v69">
        <div className="panel-head">
          <div>
            <span className="eyebrow">ORIGEM E CONVERSÃO</span>
            <h2>Resultado por canal</h2>
            <p className="muted">Mostra quais origens geram leads, clientes e receita.</p>
          </div>
        </div>

        <div className="analytics-table-v69 origin-table-v69">
          <div className="analytics-row-v69 analytics-head-v69">
            <span>Origem</span>
            <span>Leads</span>
            <span>Contatados</span>
            <span>Ganhos</span>
            <span>Conversão</span>
            <span>Vendas</span>
            <span>Valor vendido</span>
          </div>
          {originRows.map(row => (
            <div className="analytics-row-v69" key={row.origin_label}>
              <span><strong>{row.origin_label}</strong></span>
              <span>{Number(row.leads_total || 0)}</span>
              <span>{Number(row.contacted || 0)}</span>
              <span>{Number(row.won_count || 0)}</span>
              <span>{Number(row.conversion_rate || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>
              <span>{Number(row.sales_count || 0)}</span>
              <span><strong>{formatCurrency(row.sales_value || 0)}</strong></span>
            </div>
          ))}
          {!originRows.length && <p className="muted analytics-empty-v69">Nenhum dado de origem disponível.</p>}
        </div>
      </section>
    </>
  )
}

'''

text = text[:start] + analytics + text[end:]

css += r'''

/* V69 - desempenho comercial e origem/conversão */
.commercial-analytics-v69 {
  margin-top: 16px;
  overflow: hidden;
}
.analytics-table-v69 {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow-x: auto;
}
.analytics-row-v69 {
  display: grid;
  gap: 12px;
  align-items: center;
  padding: 11px 14px;
  border-bottom: 1px solid #e2e8f0;
  font-size: 12px;
}
.analytics-row-v69:last-child {
  border-bottom: 0;
}
.seller-table-v69 .analytics-row-v69 {
  grid-template-columns: minmax(155px, 1.4fr) 90px 80px 70px 70px 80px minmax(125px, 1fr) 115px;
  min-width: 900px;
}
.origin-table-v69 .analytics-row-v69 {
  grid-template-columns: minmax(150px, 1.4fr) 70px 85px 70px 85px 70px minmax(120px, 1fr);
  min-width: 760px;
}
.analytics-head-v69 {
  background: #f8fafc;
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.analytics-name-v69,
.analytics-row-v69 > span {
  min-width: 0;
}
.analytics-name-v69,
.analytics-row-v69 > span:has(small) {
  display: grid;
  gap: 2px;
}
.analytics-row-v69 small {
  display: block;
  color: #94a3b8;
  font-size: 10px;
  margin-top: 2px;
}
.analytics-empty-v69 {
  padding: 18px;
  margin: 0;
}
'''

# -----------------------------------------------------------------------------
# 3) Validações para evitar regressões.
# -----------------------------------------------------------------------------
checks = [
    ('checkpoint atômico', "rpc('save_lead_journey_checkpoint'" in text),
    ('histórico local preservado', 'setJourneyEntries(old => [entry, ...old])' in text),
    ('rascunho preservado', 'clearDirtyFields(lead.id)' in text),
    ('desempenho vendedor', "rpc('get_seller_performance'" in text and 'Desempenho por vendedor' in text),
    ('origem conversão', "rpc('get_origin_conversion'" in text and 'Resultado por canal' in text),
    ('dashboard preservado', '<TeamPerformance organization={organization} />' in text),
    ('vendas preservadas', 'function SalesPage({ organization, userEmail }) {' in text),
    ('envio preservado', 'function MessageSending({ organization, settings, userEmail }) {' in text),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V69 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V69 aplicada: histórico atômico, desempenho por vendedor e origem/conversão.')
