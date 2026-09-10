from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def component_bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'Componente não encontrado: {label}')
    return start, end


def replace_in_component(start_marker, end_marker, old, new, label):
    global text
    start, end = component_bounds(start_marker, end_marker, label)
    part = text[start:end]
    if old not in part:
        raise SystemExit(f'Marcador não encontrado em {label}')
    part = part.replace(old, new, 1)
    text = text[:start] + part + text[end:]


def replace_range_in_component(start_marker, end_marker, range_start, range_end, new, label):
    global text
    start, end = component_bounds(start_marker, end_marker, label)
    part = text[start:end]
    a = part.find(range_start)
    b = part.find(range_end, a)
    if a < 0 or b < 0:
        raise SystemExit(f'Faixa não encontrada em {label}')
    part = part[:a] + new + part[b:]
    text = text[:start] + part + text[end:]


# -----------------------------------------------------------------------------
# 1) ENVIAR MENSAGEM: seleção e desseleção previsíveis.
#    A falta de modelo de mensagem não bloqueia o checkbox; é validada no envio.
#    Leads já na fila continuam indisponíveis para uma nova seleção.
# -----------------------------------------------------------------------------
SENDING_START = 'function MessageSending({ organization, settings, userEmail }) {'
SENDING_END = 'function CampaignWorkspace({ organization, settings, userEmail }) {'

selection_block = """  const batchLimit = Math.max(1, Number(settings?.whatsapp_batch_limit || 20))
  const selectable = leads.filter(l =>
    l.status !== 'queued' &&
    !queuedLeadIds.has(l.id) &&
    Boolean(normalizeWhatsAppNumber(l.phone))
  )
  const eligible = selectable.filter(l => templates.some(t => t.target_segment_id === l.target_segment_id))
  const selectableBatch = selectable.slice(0, batchLimit)
  const allSelectableSelected = selectableBatch.length > 0 && selectableBatch.every(l => selected.has(l.id))

  function toggle(id, checked) {
    setSelected(old => {
      const next = new Set(old)

      if (!checked) {
        next.delete(id)
        setMessage('')
        return next
      }

      if (next.size >= batchLimit) {
        setMessage(`O limite atual é de ${batchLimit} leads por envio.`)
        return old
      }

      next.add(id)
      setMessage('')
      return next
    })
  }

  function toggleAll(checked) {
    if (!checked) {
      setSelected(new Set())
      setMessage('')
      return
    }

    setSelected(new Set(selectableBatch.map(l => l.id)))
    if (selectable.length > batchLimit) {
      setMessage(`Foram selecionados os primeiros ${batchLimit} leads disponíveis, conforme o limite do lote.`)
    } else {
      setMessage('')
    }
  }

"""
replace_range_in_component(
    SENDING_START,
    SENDING_END,
    '  const batchLimit = Math.max(1, Number(settings?.whatsapp_batch_limit || 20))',
    '  async function send() {',
    selection_block,
    'Envio - seleção'
)

replace_in_component(
    SENDING_START,
    SENDING_END,
    """  async function send() {
    if (!selected.size) return
    setLoading(true)
    setMessage('')
""",
    """  async function send() {
    if (!selected.size) return

    const selectedEligibleIds = [...selected].filter(id => eligible.some(l => l.id === id))
    const withoutActiveTemplate = [...selected].filter(id =>
      selectable.some(l => l.id === id) && !eligible.some(l => l.id === id)
    ).length

    if (!selectedEligibleIds.length) {
      setMessage('Os leads selecionados ainda não possuem uma mensagem ativa para o respectivo público-alvo. Cadastre ou ative a mensagem antes do envio.')
      return
    }

    setLoading(true)
    setMessage('')
""",
    'Envio - validação antes do disparo'
)

replace_in_component(
    SENDING_START,
    SENDING_END,
    "body: { organization_id: organization.id, lead_ids: [...selected] }",
    "body: { organization_id: organization.id, lead_ids: selectedEligibleIds }",
    'Envio - IDs enviados'
)

replace_in_component(
    SENDING_START,
    SENDING_END,
    """      setMessage(`${data?.queued || 0} mensagem(ns) adicionada(s) à fila.`)
      setSelected(new Set())
""",
    """      const ignored = withoutActiveTemplate > 0
        ? ` ${withoutActiveTemplate} lead(s) não foram enviados porque ainda não possuem mensagem cadastrada/ativa.`
        : ''
      setMessage(`${data?.queued || 0} mensagem(ns) adicionada(s) à fila.${ignored}`)
      setSelected(new Set())
""",
    'Envio - retorno'
)

replace_in_component(
    SENDING_START,
    SENDING_END,
    """        <label className="select-all"><input type="checkbox" checked={selected.size > 0 && selected.size === Math.min(eligible.length, batchLimit)} onChange={toggleAll} /> Selecionar aptos</label>""",
    """        <label className="select-all"><input type="checkbox" checked={allSelectableSelected} onChange={e => toggleAll(e.target.checked)} /> Selecionar leads</label>""",
    'Envio - flag geral'
)

replace_in_component(
    SENDING_START,
    SENDING_END,
    """              <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} disabled={!canSend} />""",
    """              <input
                type="checkbox"
                checked={selected.has(l.id)}
                onChange={e => toggle(l.id, e.target.checked)}
                disabled={isQueued || !hasPhone}
                aria-label={`Selecionar ${l.business_name}`}
              />""",
    'Envio - flags individuais'
)

replace_in_component(
    SENDING_START,
    SENDING_END,
    """              <span className={isQueued ? 'template-status queued' : canSend ? 'template-status active' : 'template-status inactive'}>
                {isQueued ? 'Na fila' : canSend ? 'Apto' : !hasPhone ? 'Sem telefone' : 'Sem mensagem ativa'}
              </span>""",
    """              <span className={isQueued ? 'template-status queued' : canSend ? 'template-status active' : 'template-status inactive'}>
                {isQueued ? 'Na fila' : canSend ? 'Apto' : !hasPhone ? 'Sem telefone' : ''}
              </span>""",
    'Envio - retirar texto Sem mensagem ativa'
)


# -----------------------------------------------------------------------------
# 2) EXPORTAÇÃO: por mês, intervalo personalizado ou todo o período.
#    CSV com UTF-8/BOM e separador ; abre diretamente no Excel em pt-BR.
# -----------------------------------------------------------------------------
if 'function LeadExportPanel({ leads, onClose, onMessage }) {' not in text:
    export_component = r'''
function LeadExportPanel({ leads, onClose, onMessage }) {
  const today = currentBrazilDate()
  const [mode, setMode] = useState('month')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`)
  const [endDate, setEndDate] = useState(today)

  const statusNames = {
    new: 'Novo',
    qualified: 'Qualificado',
    queued: 'Na fila',
    contacted: 'Contatado',
    replied: 'Respondeu',
    interested: 'Interessado',
    proposal: 'Proposta',
    not_interested: 'Sem interesse',
    won: 'Ganho',
    lost: 'Perdido',
    discarded: 'Descartado'
  }

  function dateKey(value) {
    if (!value) return ''
    try {
      const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date(value))
      const get = type => parts.find(part => part.type === type)?.value || ''
      return `${get('year')}-${get('month')}-${get('day')}`
    } catch {
      return String(value).slice(0, 10)
    }
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`
  }

  function exportToExcel() {
    if (mode === 'month' && !month) {
      onMessage('Selecione o mês para exportação.')
      return
    }
    if (mode === 'range' && (!startDate || !endDate || startDate > endDate)) {
      onMessage('Informe um período válido para exportação.')
      return
    }

    const rows = leads.filter(lead => {
      if (mode === 'all') return true
      const date = dateKey(lead.created_at)
      if (!date) return false
      if (mode === 'month') return date.startsWith(month)
      return date >= startDate && date <= endDate
    })

    if (!rows.length) {
      onMessage('Não existem leads no período selecionado.')
      return
    }

    const headers = [
      'Empresa', 'Público-alvo', 'Campanha', 'Telefone', 'E-mail',
      'Cidade', 'UF', 'Contato', 'Status', 'Valor da proposta',
      'Proposta enviada', 'Último contato', 'Próximo contato',
      'Observações', 'Data de cadastro'
    ]

    const data = rows.map(lead => [
      lead.business_name || '',
      lead.target_segments?.name || lead.segment || '',
      lead.campaigns?.name || '',
      lead.phone || '',
      lead.email || '',
      lead.city || '',
      lead.state || '',
      lead.contact_name || '',
      statusNames[lead.status] || lead.status || '',
      lead.proposal_value === null || lead.proposal_value === undefined || lead.proposal_value === ''
        ? ''
        : formatCurrency(lead.proposal_value),
      lead.proposal_sent_at || '',
      lead.last_contact_date || '',
      lead.next_contact_date || '',
      lead.commercial_notes || '',
      lead.created_at ? new Date(lead.created_at).toLocaleString('pt-BR') : ''
    ])

    const csv = '\uFEFF' + [headers, ...data]
      .map(row => row.map(csvCell).join(';'))
      .join('\r\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const periodName = mode === 'all'
      ? 'todo-periodo'
      : mode === 'month'
        ? month
        : `${startDate}_a_${endDate}`

    link.href = url
    link.download = `crm-leads-${periodName}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    onMessage(`${rows.length} lead(s) exportado(s). O arquivo abre diretamente no Excel.`)
  }

  return (
    <section className="panel export-panel-v41">
      <div className="export-panel-head-v41">
        <div>
          <span className="eyebrow">EXPORTAÇÃO</span>
          <h2>Exportar leads para Excel</h2>
          <p className="muted">Escolha um mês, um intervalo de datas ou todo o período.</p>
        </div>
        <button type="button" className="secondary" onClick={onClose}>Fechar</button>
      </div>

      <div className="export-fields-v41">
        <label>
          Período
          <select value={mode} onChange={e => setMode(e.target.value)}>
            <option value="month">Por mês</option>
            <option value="range">Período personalizado</option>
            <option value="all">Todo o período</option>
          </select>
        </label>

        {mode === 'month' && (
          <label>
            Mês
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </label>
        )}

        {mode === 'range' && (
          <>
            <label>
              Data inicial
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            <label>
              Data final
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </label>
          </>
        )}

        <button type="button" className="primary inline-btn export-button-v41" onClick={exportToExcel}>
          <Save size={17}/> Exportar Excel
        </button>
      </div>
    </section>
  )
}


'''
    marker = 'function Leads({ organization, settings, userEmail }) {'
    if marker not in text:
        raise SystemExit('Leads não encontrado para inserir exportação.')
    text = text.replace(marker, export_component + marker, 1)

LEADS_START = 'function Leads({ organization, settings, userEmail }) {'
LEADS_END = 'function Clients({ organization, userEmail, userId }) {'

replace_in_component(
    LEADS_START,
    LEADS_END,
    "  const [loading, setLoading] = useState(false)\n",
    "  const [loading, setLoading] = useState(false)\n  const [showExport, setShowExport] = useState(false)\n",
    'Leads - estado exportação'
)

replace_in_component(
    LEADS_START,
    LEADS_END,
    """          <div className="user-badge">{userEmail}</div>""",
    """          <div className="user-badge">{userEmail}</div>
          <button type="button" className="secondary inline-btn" onClick={() => setShowExport(old => !old)}><Save size={17}/> Exportar Excel</button>""",
    'Leads - botão exportação'
)

start, end = component_bounds(LEADS_START, LEADS_END, 'Leads - painel exportação')
part = text[start:end]
if '<LeadExportPanel' not in part:
    header_end = part.find('      </header>')
    if header_end < 0:
        raise SystemExit('Cabeçalho de Leads não encontrado.')
    header_end += len('      </header>')
    panel = """

      {showExport && (
        <LeadExportPanel
          leads={leads}
          onClose={() => setShowExport(false)}
          onMessage={setMessage}
        />
      )}"""
    part = part[:header_end] + panel + part[header_end:]
    text = text[:start] + part + text[end:]


# -----------------------------------------------------------------------------
# 3) LEADS SEM INTERESSE: incluir também status Perdido.
# -----------------------------------------------------------------------------
REPO_START = 'function NotInterestedRepository({ organization, userEmail }) {'
REPO_END = 'function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {'

replace_in_component(
    REPO_START,
    REPO_END,
    ".in('status', ['not_interested','discarded'])",
    ".in('status', ['not_interested','discarded','lost'])",
    'Leads sem interesse - consulta'
)
replace_in_component(
    REPO_START,
    REPO_END,
    'Leads sem interesse e descartados ficam fora do funil, mas podem ser recuperados.',
    'Leads sem interesse, descartados e negócios perdidos ficam registrados nesta área e podem ser recuperados.',
    'Leads sem interesse - descrição'
)
replace_in_component(
    REPO_START,
    REPO_END,
    'Leads marcados como Sem interesse ou Descartado aparecerão aqui.',
    'Leads marcados como Sem interesse, Descartado ou Perdido aparecerão aqui.',
    'Leads sem interesse - vazio'
)
replace_in_component(
    REPO_START,
    REPO_END,
    """                <span className={`repository-status-v33 ${lead.status === 'discarded' ? 'discarded' : 'not-interested'}`}>
                  {lead.status === 'discarded' ? 'Descartado' : 'Sem interesse'}
                </span>""",
    """                <span className={`repository-status-v33 ${lead.status === 'discarded' ? 'discarded' : lead.status === 'lost' ? 'lost' : 'not-interested'}`}>
                  {lead.status === 'discarded' ? 'Descartado' : lead.status === 'lost' ? 'Perdido' : 'Sem interesse'}
                </span>""",
    'Leads sem interesse - badge Perdido'
)


# -----------------------------------------------------------------------------
# 4) MENU LATERAL: trilho de ícones no desktop, expansão por hover/foco/click.
#    Mobile permanece com o menu já existente.
# -----------------------------------------------------------------------------
if '/* V41 - menu lateral compacto e expansível */' not in css:
    css += r'''

/* V41 - menu lateral compacto e expansível */
@media (min-width: 901px) {
  .app-shell {
    grid-template-columns: 64px minmax(0, 1fr) !important;
  }

  .sidebar {
    width: 64px;
    height: 100vh;
    min-height: 100vh;
    padding: 18px 12px;
    overflow-x: hidden;
    overflow-y: auto;
    position: sticky;
    top: 0;
    z-index: 1100;
    transition: width .18s ease, box-shadow .18s ease;
  }

  .sidebar:hover,
  .sidebar:focus-within {
    width: 250px;
    box-shadow: 10px 0 28px rgba(15, 23, 42, .16);
  }

  .sidebar-brand {
    width: 226px;
    gap: 12px;
    padding-left: 1px;
  }

  .sidebar-brand .brand-mark.small {
    flex: 0 0 38px;
  }

  .sidebar-brand > div:last-child {
    opacity: 0;
    visibility: hidden;
    transform: translateX(-6px);
    transition: opacity .14s ease, transform .14s ease;
    white-space: nowrap;
  }

  .sidebar:hover .sidebar-brand > div:last-child,
  .sidebar:focus-within .sidebar-brand > div:last-child {
    opacity: 1;
    visibility: visible;
    transform: translateX(0);
  }

  .sidebar nav {
    width: 226px;
  }

  .sidebar .nav-item {
    width: 226px;
    min-height: 42px;
    white-space: nowrap;
    overflow: hidden;
    font-size: 0;
  }

  .sidebar .nav-item svg {
    flex: 0 0 18px;
    min-width: 18px;
  }

  .sidebar:hover .nav-item,
  .sidebar:focus-within .nav-item {
    font-size: 13px;
  }

  .kanban-fixed-horizontal-scroll {
    left: 64px !important;
  }
}

@media (max-width: 900px) {
  .kanban-fixed-horizontal-scroll {
    left: 0 !important;
  }
}

/* V41 - checkboxes de envio */
.sending-row > input[type="checkbox"],
.sending-toolbar input[type="checkbox"] {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px;
  padding: 0 !important;
  margin: 0;
  accent-color: #00a88f;
  cursor: pointer;
}
.sending-row > input[type="checkbox"]:disabled {
  cursor: not-allowed;
  opacity: .45;
}

/* V41 - padrão visual R$ para valores monetários */
label:has(> input[type="number"][step="0.01"]) {
  position: relative;
}
label:has(> input[type="number"][step="0.01"])::after {
  content: "R$";
  position: absolute;
  left: 12px;
  bottom: 13px;
  z-index: 2;
  color: #64748b;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}
label:has(> input[type="number"][step="0.01"]) > input {
  padding-left: 40px !important;
}

/* V41 - exportação */
.export-panel-v41 { margin-bottom: 16px; }
.export-panel-head-v41 {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 18px;
}
.export-panel-head-v41 h2 { margin-bottom: 5px; }
.export-fields-v41 {
  display: grid;
  grid-template-columns: minmax(180px, .9fr) minmax(180px, 1fr) minmax(180px, 1fr) auto;
  gap: 12px;
  align-items: end;
}
.export-button-v41 { min-height: 43px; justify-content: center; }
.repository-status-v33.lost { background: #fef2f2; color: #b91c1c; }

@media (max-width: 900px) {
  .export-fields-v41 { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .export-panel-head-v41 { flex-direction: column; }
  .export-fields-v41 { grid-template-columns: 1fr; }
  .export-button-v41 { width: 100%; }
}
'''


# -----------------------------------------------------------------------------
# 5) Validação obrigatória da V41 antes do Vite.
# -----------------------------------------------------------------------------
def get_component(start_marker, end_marker, label):
    start, end = component_bounds(start_marker, end_marker, label)
    return text[start:end]

sending = get_component(SENDING_START, SENDING_END, 'Envio validação')
leads_part = get_component(LEADS_START, LEADS_END, 'Leads validação')
repo = get_component(REPO_START, REPO_END, 'Repositório validação')

checks = [
    ('flag geral controlada', 'allSelectableSelected' in sending and 'toggleAll(e.target.checked)' in sending),
    ('flags individuais controladas', 'toggle(l.id, e.target.checked)' in sending),
    ('texto Sem mensagem ativa removido da listagem', "? 'Sem telefone' : ''" in sending),
    ('validação da mensagem mantida no envio', 'selectedEligibleIds' in sending),
    ('leads na fila não selecionáveis', 'disabled={isQueued || !hasPhone}' in sending),
    ('exportação por mês', 'type="month"' in text and 'Por mês' in text),
    ('exportação por intervalo', 'Período personalizado' in text),
    ('exportação de todo período', 'Todo o período' in text),
    ('arquivo compatível com Excel', "text/csv;charset=utf-8;" in text),
    ('botão exportar presente', 'Exportar Excel' in leads_part),
    ('perdidos em Leads sem interesse', ".in('status', ['not_interested','discarded','lost'])" in repo and "'Perdido'" in repo),
    ('menu compacto', '/* V41 - menu lateral compacto e expansível */' in css and '.sidebar:hover' in css),
    ('padrão R$', 'content: "R$";' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V41 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V41 aplicada e validada: flags, exportação, R$, perdidos e menu lateral.')
