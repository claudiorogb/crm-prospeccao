from pathlib import Path


APP = Path('src/App.jsx')
CSS = Path('src/styles.css')

text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f'V70: marcador não encontrado: {label}')
    text = text.replace(old, new, 1)


if 'kanban-summary-v70' in text and '/* V70 - Kanban compacto' in css:
    print('V70 já aplicada.')
    raise SystemExit(0)


# Ícones usados no resumo compacto do cartão.
replace_once(
    '  Save, ChevronDown, Menu, X, CalendarDays\n',
    '  Save, ChevronDown, Menu, X, CalendarDays, Clock, UserRound\n',
    'ícones do Kanban'
)


# O nome comercial do usuário é obrigatório no cadastro e é normalizado antes
# de chegar ao gatilho que cria public.profiles.
replace_once(
    """      } else if (mode === 'signup') {
        if (form.password.length < 10) {
          throw new Error('A senha precisa ter pelo menos 10 caracteres.')
        }
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.fullName } }
        })""",
    """      } else if (mode === 'signup') {
        if (form.password.length < 10) {
          throw new Error('A senha precisa ter pelo menos 10 caracteres.')
        }
        const displayName = form.fullName.trim().replace(/\\s+/g, ' ')
        if (displayName.length < 2) throw new Error('Informe como deseja ser chamado.')

        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: displayName } }
        })""",
    'normalização do nome no cadastro'
)

replace_once(
    """            <label>
              Nome
              <input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Seu nome" required />
            </label>""",
    """            <label>
              Como deseja ser chamado
              <input
                value={form.fullName}
                onChange={e => setForm({ ...form, fullName: e.target.value })}
                placeholder="Ex.: Claudio"
                minLength={2}
                maxLength={80}
                autoComplete="name"
                required
              />
            </label>""",
    'campo Como deseja ser chamado'
)


# Mantém o e-mail como identificador administrativo, mas passa a usar o nome
# de perfil nas áreas comerciais e nos cabeçalhos do usuário comum.
replace_once(
    "  const [accountStatus, setAccountStatus] = useState('active')\n",
    "  const [accountStatus, setAccountStatus] = useState('active')\n  const [userDisplayName, setUserDisplayName] = useState('')\n",
    'estado do nome do usuário'
)

replace_once(
    """      setAccountStatus('active')
      setIsSystemAdmin(false)""",
    """      setAccountStatus('active')
      setUserDisplayName('')
      setIsSystemAdmin(false)""",
    'limpeza do nome ao sair'
)

replace_once(
    ".select('account_status')\n          .eq('id', session.user.id)",
    ".select('account_status,full_name')\n          .eq('id', session.user.id)",
    'leitura do nome do perfil'
)

replace_once(
    """      const status = profileResult.data?.account_status || 'active'
      const platformAdmin = Boolean(adminResult.data)

      setAccountStatus(status)""",
    """      const status = profileResult.data?.account_status || 'active'
      const displayName = profileResult.data?.full_name?.trim() || session.user.user_metadata?.full_name?.trim() || ''
      const platformAdmin = Boolean(adminResult.data)

      setAccountStatus(status)
      setUserDisplayName(displayName)""",
    'atribuição do nome do perfil'
)

replace_once(
    "  const userEmail = session.user.email\n",
    "  const userEmail = session.user.email\n  const userLabel = userDisplayName || userEmail\n",
    'rótulo comercial do usuário'
)

for old, new, label in [
    ('            userEmail={userEmail}\n            onGoCampaigns=', '            userEmail={userLabel}\n            onGoCampaigns=', 'nome no Dashboard'),
    ('<CampaignWorkspace organization={organization} settings={settings} userEmail={userEmail} />', '<CampaignWorkspace organization={organization} settings={settings} userEmail={userLabel} />', 'nome em Campanhas'),
    ('<SalesPage organization={organization} userEmail={userEmail} />', '<SalesPage organization={organization} userEmail={userLabel} />', 'nome em Vendas'),
    ('            userEmail={userEmail}\n            userId={session.user.id}', '            userEmail={userLabel}\n            userId={session.user.id}', 'nome no Funil'),
    ('            userEmail={userEmail}\n            onOpenLead=', '            userEmail={userLabel}\n            onOpenLead=', 'nome nos retornos')
]:
    replace_once(old, new, label)


# Estado compacto/expandido e métricas completas retornadas pelo RPC. As
# métricas do cabeçalho não dependem da página atual do Kanban.
replace_once(
    "  const [journeyEntries, setJourneyEntries] = useState([])\n",
    "  const [journeyEntries, setJourneyEntries] = useState([])\n  const [expandedLeadIds, setExpandedLeadIds] = useState(() => new Set())\n",
    'estado de expansão'
)

replace_once(
    "  const [statusCounts, setStatusCounts] = useState({})\n",
    "  const [statusCounts, setStatusCounts] = useState({})\n  const [statusValueTotals, setStatusValueTotals] = useState({})\n  const [statusOverdueCounts, setStatusOverdueCounts] = useState({})\n",
    'métricas por etapa'
)

replace_once(
    """    setStatusCounts(payload.status_counts || {})
    setPage(pageToLoad)""",
    """    setStatusCounts(payload.status_counts || {})
    setStatusValueTotals(payload.status_value_totals || {})
    setStatusOverdueCounts(payload.status_overdue_counts || {})
    setPage(pageToLoad)""",
    'carga das métricas por etapa'
)

replace_once(
    """  const statusLabel = {
    new: 'Novo',""",
    """  function currentLeadValue(lead) {
    return parseMoneyValue(lead.contract_value)
      ?? parseMoneyValue(lead.renegotiated_value)
      ?? parseMoneyValue(lead.proposal_value)
      ?? 0
  }

  function formatKanbanDate(value) {
    if (!value) return ''
    return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')
  }

  function toggleLeadExpanded(leadId) {
    setExpandedLeadIds(current => {
      const next = new Set(current)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
  }

  const statusLabel = {
    new: 'Novo',""",
    'helpers do cartão compacto'
)

replace_once(
    """              const label = statusLabel[status]
              const columnLeads = visibleLeads.filter(l => l.status === status)
              return (
                <div className="kanban-column" key={status}>
                  <div className="kanban-column-head">
                    <strong>{label}</strong>
                    <span>{columnLeads.length}</span>
                  </div>""",
    """              const label = statusLabel[status]
              const columnLeads = visibleLeads.filter(l => l.status === status)
              const columnTotal = Number(statusValueTotals?.[status] || 0)
              const overdueCount = Number(statusOverdueCounts?.[status] || 0)
              return (
                <div className="kanban-column" key={status}>
                  <div className="kanban-column-head kanban-column-head-v70">
                    <div className="kanban-column-title-v70">
                      <strong>{label}</strong>
                      <span>{Number(statusCounts?.[status] || 0)}</span>
                    </div>
                    <div className="kanban-column-metrics-v70">
                      <strong>{formatCurrency(columnTotal)}</strong>
                      <span className={overdueCount > 0 ? 'has-overdue' : ''} title="Retornos atrasados">
                        <Clock size={14}/>{overdueCount}
                      </span>
                    </div>
                  </div>""",
    'cabeçalho das etapas'
)

replace_once(
    """                      const showEditor = repliedStage || interestedStage || proposalStage || negotiationStage || closedStage
                      const leadHistory = journeyEntries.filter(entry => entry.lead_id === l.id)

                      return (
                        <article className="panel kanban-lead-card" key={l.id}>
                          <div className="kanban-card-top">
                            <div>
                              <span className="eyebrow">{l.target_segments?.name || l.segment}</span>
                              <h3>{l.business_name}</h3>
                            </div>
                          </div>

                          <div className="kanban-card-meta">
                            <span>{l.city || '—'}{l.state ? ` / ${l.state}` : ''}</span>
                            <span>{l.phone || 'Sem telefone'}</span>
                            {l.campaigns?.name && <span>{l.campaigns.name}</span>}
                          </div>""",
    """                      const showEditor = repliedStage || interestedStage || proposalStage || negotiationStage || closedStage
                      const leadHistory = journeyEntries.filter(entry => entry.lead_id === l.id)
                      const expanded = expandedLeadIds.has(l.id)
                      const overdue = isOverdueReturn(l)
                      const withinDueDate = !closedStage && Boolean(l.next_contact_date) && !overdue && l.next_contact_date >= currentBrazilDate()

                      return (
                        <article
                          className={`panel kanban-lead-card kanban-lead-card-v70${overdue ? ' is-overdue-v70' : withinDueDate ? ' is-on-time-v70' : ''}`}
                          key={l.id}
                        >
                          <div className="kanban-summary-v70">
                            <div className="kanban-summary-topline-v70">
                              <div>
                                <span className="kanban-segment-v70">{l.target_segments?.name || l.segment || 'Sem segmento'}</span>
                                <span className="kanban-company-v70">{l.business_name}</span>
                              </div>
                              <button
                                type="button"
                                className="kanban-expand-toggle-v70"
                                onClick={() => toggleLeadExpanded(l.id)}
                                aria-label={expanded ? `Ocultar detalhes de ${l.business_name}` : `Exibir detalhes de ${l.business_name}`}
                                aria-expanded={expanded}
                              >
                                {expanded ? '−' : '+'}
                              </button>
                            </div>

                            <div className="kanban-people-row-v70">
                              <strong>{l.contact_name || 'Contato não informado'}</strong>
                              <span><UserRound size={14}/>{l.seller_name || 'Não atribuído'}</span>
                            </div>

                            <strong className="kanban-value-v70">{formatCurrency(currentLeadValue(l))}</strong>

                            <div className={`kanban-due-v70${overdue ? ' overdue' : withinDueDate ? ' on-time' : ''}`}>
                              {overdue ? (
                                <strong>ATRASADO</strong>
                              ) : l.next_contact_date ? (
                                <span><Clock size={14}/>{formatKanbanDate(l.next_contact_date)}</span>
                              ) : (
                                <span>Sem retorno previsto</span>
                              )}
                            </div>
                          </div>

                          {expanded && (
                            <div className="kanban-expanded-v70">
                              <div className="kanban-card-meta">
                                <span>{l.city || '—'}{l.state ? ` / ${l.state}` : ''}</span>
                                <span>{l.phone || 'Sem telefone'}</span>
                                {l.campaigns?.name && <span>{l.campaigns.name}</span>}
                              </div>""",
    'resumo do cartão'
)

replace_once(
    """                          <div className="kanban-card-footer">
                            {l.website ? <a className="lead-site-link" href={l.website} target="_blank" rel="noreferrer">Abrir site</a> : <span />}
                          </div>
                        </article>""",
    """                              <div className="kanban-card-footer">
                                {l.website ? <a className="lead-site-link" href={l.website} target="_blank" rel="noreferrer">Abrir site</a> : <span />}
                              </div>
                            </div>
                          )}
                        </article>""",
    'fechamento dos detalhes expansíveis'
)


css += r'''

/* V70 - Kanban compacto, prazo, vendedor e resposta visual ao clique */
.sales-kanban {
  grid-template-columns: repeat(8, 284px) !important;
  gap: 8px !important;
}
.kanban-column {
  width: 284px !important;
  border-radius: 10px !important;
}
.kanban-column-head-v70 {
  align-items: flex-start !important;
  gap: 8px;
  padding: 10px 11px !important;
}
.kanban-column-title-v70,
.kanban-column-metrics-v70 {
  display: flex;
  align-items: center;
  gap: 7px;
}
.kanban-column-title-v70 > span {
  min-width: 22px !important;
  width: auto !important;
  height: 22px !important;
  padding: 0 6px;
}
.kanban-column-metrics-v70 {
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  white-space: nowrap;
}
.kanban-column-metrics-v70 > strong {
  font-size: 12px;
  color: #334155;
}
.kanban-column-metrics-v70 > span {
  min-width: 0 !important;
  width: auto !important;
  height: auto !important;
  padding: 0 !important;
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
  background: transparent !important;
  color: #64748b;
}
.kanban-column-metrics-v70 > span.has-overdue { color: #b91c1c; }
.kanban-column-cards { gap: 7px !important; padding: 7px !important; }
.kanban-lead-card-v70 {
  gap: 0 !important;
  padding: 11px !important;
  border-color: #e2e8f0;
  transition: border-color .15s ease, background-color .15s ease, box-shadow .15s ease;
}
.kanban-lead-card-v70.is-overdue-v70 {
  background: #fff1f2 !important;
  border-color: #fecaca !important;
}
.kanban-lead-card-v70.is-on-time-v70 {
  background: #f0fdf4 !important;
  border-color: #bbf7d0 !important;
}
.kanban-summary-v70 { display: grid; gap: 8px; }
.kanban-summary-topline-v70 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  gap: 8px;
  align-items: start;
}
.kanban-summary-topline-v70 > div { min-width: 0; display: grid; gap: 2px; }
.kanban-segment-v70 {
  color: #0f766e;
  font-size: 11px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: .05em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.kanban-company-v70 {
  color: #64748b;
  font-size: 12px;
  line-height: 1.25;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.kanban-expand-toggle-v70 {
  width: 28px;
  height: 28px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: rgba(255,255,255,.82);
  color: #0f172a;
  font-size: 20px;
  line-height: 1;
  font-weight: 500;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.kanban-people-row-v70 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.kanban-people-row-v70 > strong {
  min-width: 0;
  color: #17212b;
  font-size: 15px;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.kanban-people-row-v70 > span {
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  color: #475569;
  font-size: 11px;
  line-height: 1.2;
  text-align: right;
}
.kanban-people-row-v70 > span svg { flex: 0 0 auto; }
.kanban-value-v70 { color: #1e293b; font-size: 13px; }
.kanban-due-v70 {
  min-height: 18px;
  color: #64748b;
  font-size: 12px;
}
.kanban-due-v70 span,
.kanban-due-v70 strong {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.kanban-due-v70.overdue { color: #b91c1c; }
.kanban-due-v70.on-time { color: #15803d; }
.kanban-expanded-v70 {
  display: grid;
  gap: 11px;
  margin-top: 11px;
  padding-top: 11px;
  border-top: 1px solid rgba(148,163,184,.35);
}

button:not(:disabled),
[role="button"]:not([aria-disabled="true"]) {
  transition: translate .08s ease, box-shadow .08s ease, filter .08s ease;
}
button:not(:disabled):active,
[role="button"]:not([aria-disabled="true"]):active {
  translate: 0 1px;
  box-shadow: inset 0 2px 4px rgba(15, 23, 42, .18) !important;
  filter: brightness(.97);
}

@media (max-width: 760px) {
  .sales-kanban { grid-template-columns: repeat(8, 272px) !important; }
  .kanban-column { width: 272px !important; }
}
'''


APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')


checks = [
    ('campo de nome', 'Como deseja ser chamado' in text and 'displayName.length < 2' in text),
    ('nome comercial carregado', ".select('account_status,full_name')" in text and 'userLabel = userDisplayName || userEmail' in text),
    ('cartão expansível', 'kanban-summary-v70' in text and "expanded ? '−' : '+'" in text),
    ('vendedor no cartão', "l.seller_name || 'Não atribuído'" in text),
    ('valor vigente', 'currentLeadValue(lead)' in text and 'renegotiated_value' in text and 'contract_value' in text),
    ('métricas por etapa', 'statusValueTotals' in text and 'statusOverdueCounts' in text),
    ('prazo visual', 'isOverdueReturn(l)' in text and 'is-overdue-v70' in text and 'is-on-time-v70' in text),
    ('feedback de clique', 'button:not(:disabled):active' in css),
]

failed = [label for label, ok in checks if not ok]
if failed:
    raise SystemExit('V70: validações falharam: ' + ', '.join(failed))

print('V70 aplicada: Kanban compacto, vendedor por nome, totais/atrasos por fase e feedback de clique.')
