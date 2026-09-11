from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def component_bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V54: componente não encontrado: {label}')
    return start, end


# -----------------------------------------------------------------------------
# 1) Dashboard: Negociação também é negócio em andamento.
# -----------------------------------------------------------------------------
text = text.replace(
    "new Set(['contacted','replied','interested','proposal','not_interested','won','lost'])",
    "new Set(['contacted','replied','interested','proposal','negotiation','not_interested','won','lost'])"
)
text = text.replace(
    "leads.filter(l => ['interested','proposal'].includes(l.status)).length",
    "leads.filter(l => ['interested','proposal','negotiation'].includes(l.status)).length"
)
text = text.replace(
    ".filter(l => ['interested','proposal'].includes(l.status) && l.proposal_sent_at)",
    ".filter(l => ['interested','proposal','negotiation'].includes(l.status) && l.proposal_sent_at)"
)


# -----------------------------------------------------------------------------
# 2) Leads: estado do histórico, carregamento de checkpoints e nova etapa.
# -----------------------------------------------------------------------------
start, end = component_bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)
leads = text[start:end]

state_marker = "  const kanbanFixedScrollRef = useRef(null)\n"
state_insert = """  const kanbanFixedScrollRef = useRef(null)\n  const [journeyEntries, setJourneyEntries] = useState([])\n  const [noteDrafts, setNoteDrafts] = useState({})\n  const [savingLeadIds, setSavingLeadIds] = useState(new Set())\n"""
if state_marker not in leads:
    raise SystemExit('V54: refs do funil não encontradas.')
leads = leads.replace(state_marker, state_insert, 1)

journey_loader = r'''  useEffect(() => {
    let active = true

    async function loadJourneyEntries() {
      const { data, error } = await supabase
        .from('lead_journey_entries')
        .select('id,lead_id,stage,contact_name,proposal_value,proposal_sent_at,renegotiated_value,next_contact_date,contract_value,contract_signed_at,note,created_at')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })

      if (!active) return
      if (error) setMessage(error.message)
      else setJourneyEntries(data || [])
    }

    loadJourneyEntries()
    return () => { active = false }
  }, [organization.id])

'''
save_lead_marker = '  async function saveLead(e) {'
if save_lead_marker not in leads:
    raise SystemExit('V54: marcador saveLead não encontrado.')
leads = leads.replace(save_lead_marker, journey_loader + save_lead_marker, 1)

# Nova etapa no mapa de status.
proposal_label = "    proposal: 'Proposta',\n"
if proposal_label not in leads:
    raise SystemExit('V54: status Proposta não encontrado.')
leads = leads.replace(proposal_label, proposal_label + "    negotiation: 'Negociação',\n", 1)

# Ordem da nova etapa entre Proposta e Ganho.
old_order = "['new','contacted','replied','interested','proposal','won','lost']"
new_order = "['new','contacted','replied','interested','proposal','negotiation','won','lost']"
if old_order not in leads:
    raise SystemExit('V54: ordem atual do funil não encontrada.')
leads = leads.replace(old_order, new_order, 1)

# -----------------------------------------------------------------------------
# 3) Regras de movimentação, gravação explícita e recuperação de perdido.
# -----------------------------------------------------------------------------
status_start = leads.find('  async function updateStatus(id, status) {')
status_end = leads.find('  async function updateLeadContactField', status_start)
if status_start < 0 or status_end < 0:
    raise SystemExit('V54: função updateStatus não encontrada.')

new_status_block = r'''  async function updateStatus(id, status) {
    const currentLead = leads.find(item => item.id === id)
    if (!currentLead) return

    const currentStatus = currentLead.status
    const lockedTransitions = {
      interested: ['interested', 'proposal', 'lost'],
      proposal: ['proposal', 'negotiation', 'lost'],
      negotiation: ['negotiation', 'won', 'lost'],
      won: ['won'],
      lost: ['lost']
    }

    if (lockedTransitions[currentStatus] && !lockedTransitions[currentStatus].includes(status)) {
      setMessage('A partir de Interessado, o negócio só pode avançar. Para voltar uma etapa comercial, marque como Perdido e use Recuperar lead.')
      return
    }

    if (status === 'negotiation' && !['proposal','negotiation'].includes(currentStatus)) {
      setMessage('Negociação só pode ser iniciada depois da etapa Proposta.')
      return
    }

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

    const payload = { status, updated_at: new Date().toISOString() }
    if (status === 'lost' && currentStatus !== 'lost') payload.lost_from_status = currentStatus
    if (repositoryNote !== null && repositoryNote.trim()) payload.commercial_notes = repositoryNote.trim()

    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', id)
      .eq('organization_id', organization.id)

    if (error) {
      setMessage(error.message)
      return
    }

    setLeads(old => old.map(item => item.id === id ? { ...item, ...payload } : item))
    setMessage('')
  }

  function allowedStatusOptions(currentStatus) {
    const locked = {
      interested: ['interested', 'proposal', 'lost'],
      proposal: ['proposal', 'negotiation', 'lost'],
      negotiation: ['negotiation', 'won', 'lost'],
      won: ['won'],
      lost: ['lost']
    }

    if (locked[currentStatus]) {
      return locked[currentStatus]
        .filter(value => statusLabel[value])
        .map(value => [value, statusLabel[value]])
    }

    return Object.entries(statusLabel)
      .filter(([value]) => value !== 'queued' && value !== 'negotiation')
  }

  async function saveStageCheckpoint(lead, stage) {
    if (savingLeadIds.has(lead.id)) return

    setSavingLeadIds(old => new Set([...old, lead.id]))
    setMessage('')

    const numericOrNull = value => {
      if (value === '' || value === null || value === undefined) return null
      const parsed = Number(String(value).replace(',', '.'))
      return Number.isFinite(parsed) ? parsed : null
    }

    const payload = {}
    if (['replied','interested','proposal','negotiation','won','lost'].includes(stage)) {
      payload.contact_name = (lead.contact_name || '').trim() || null
    }
    if (['replied','interested','proposal','negotiation'].includes(stage)) {
      payload.next_contact_date = lead.next_contact_date || null
    }
    if (stage === 'proposal') {
      payload.proposal_value = numericOrNull(lead.proposal_value)
      payload.proposal_sent_at = lead.proposal_sent_at || null
    }
    if (stage === 'negotiation') {
      payload.renegotiated_value = numericOrNull(lead.renegotiated_value)
    }
    if (['won','lost'].includes(stage)) {
      payload.contract_value = numericOrNull(lead.contract_value)
      payload.contract_signed_at = lead.contract_signed_at || null
    }

    payload.updated_at = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', lead.id)
      .eq('organization_id', organization.id)

    if (updateError) {
      setMessage(`Não foi possível salvar: ${updateError.message}`)
      setSavingLeadIds(old => {
        const next = new Set(old)
        next.delete(lead.id)
        return next
      })
      return
    }

    const note = (noteDrafts[lead.id] || '').trim()
    const snapshot = {
      organization_id: organization.id,
      lead_id: lead.id,
      stage,
      contact_name: payload.contact_name ?? lead.contact_name ?? null,
      proposal_value: stage === 'proposal' ? payload.proposal_value : numericOrNull(lead.proposal_value),
      proposal_sent_at: stage === 'proposal' ? payload.proposal_sent_at : (lead.proposal_sent_at || null),
      renegotiated_value: stage === 'negotiation' ? payload.renegotiated_value : numericOrNull(lead.renegotiated_value),
      next_contact_date: ['replied','interested','proposal','negotiation'].includes(stage) ? payload.next_contact_date : null,
      contract_value: ['won','lost'].includes(stage) ? payload.contract_value : numericOrNull(lead.contract_value),
      contract_signed_at: ['won','lost'].includes(stage) ? payload.contract_signed_at : (lead.contract_signed_at || null),
      note: note || null
    }

    const { data: entry, error: historyError } = await supabase
      .from('lead_journey_entries')
      .insert(snapshot)
      .select('id,lead_id,stage,contact_name,proposal_value,proposal_sent_at,renegotiated_value,next_contact_date,contract_value,contract_signed_at,note,created_at')
      .single()

    if (historyError) {
      setMessage(`Os dados foram salvos, mas o histórico não foi registrado: ${historyError.message}`)
    } else {
      setJourneyEntries(old => [entry, ...old])
      setNoteDrafts(old => ({ ...old, [lead.id]: '' }))
      setLeads(old => old.map(item => item.id === lead.id ? { ...item, ...payload } : item))
      setMessage('Informações salvas e registradas no histórico.')
    }

    setSavingLeadIds(old => {
      const next = new Set(old)
      next.delete(lead.id)
      return next
    })
  }

  async function recoverLostLead(lead) {
    const fallback = ['interested','proposal','negotiation'].includes(lead.lost_from_status)
      ? lead.lost_from_status
      : 'interested'

    if (!window.confirm(`Recuperar "${lead.business_name}" para ${statusLabel[fallback]}? Todo o histórico e os valores serão preservados.`)) return

    const { error } = await supabase
      .from('leads')
      .update({ status: fallback, lost_from_status: null, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('organization_id', organization.id)

    if (error) setMessage(error.message)
    else {
      setLeads(old => old.map(item => item.id === lead.id ? { ...item, status: fallback, lost_from_status: null } : item))
      setMessage(`${lead.business_name} voltou para ${statusLabel[fallback]} com todo o histórico preservado.`)
    }
  }

'''
leads = leads[:status_start] + new_status_block + leads[status_end:]


# -----------------------------------------------------------------------------
# 4) Substitui apenas o miolo visual do Kanban. Mantém filtros, barra horizontal,
#    scroll e demais recursos das versões atuais.
# -----------------------------------------------------------------------------
kanban_start = leads.find('        <div className="sales-kanban">')
kanban_end_marker = '        </div>\n      </section>'
kanban_end = leads.find(kanban_end_marker, kanban_start)
if kanban_start < 0 or kanban_end < 0:
    raise SystemExit('V54: miolo do Kanban não encontrado.')
kanban_end += len('        </div>')

new_kanban = r'''        <div className="sales-kanban">
          {['new','contacted','replied','interested','proposal','negotiation','won','lost']
            .map(status => {
              const label = statusLabel[status]
              const columnLeads = visibleLeads.filter(l => l.status === status)
              return (
                <div className="kanban-column" key={status}>
                  <div className="kanban-column-head">
                    <strong>{label}</strong>
                    <span>{columnLeads.length}</span>
                  </div>

                  <div className="kanban-column-cards">
                    {columnLeads.length === 0 ? (
                      <div className="kanban-empty">Nenhum negócio</div>
                    ) : columnLeads.map(l => {
                      const earlyStage = ['new','contacted'].includes(status)
                      const repliedStage = status === 'replied'
                      const interestedStage = status === 'interested'
                      const proposalStage = status === 'proposal'
                      const negotiationStage = status === 'negotiation'
                      const closedStage = ['won','lost'].includes(status)
                      const showEditor = repliedStage || interestedStage || proposalStage || negotiationStage || closedStage
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
                          </div>

                          {showEditor && (
                            <label>
                              <span>Nome do contato</span>
                              <input
                                value={l.contact_name || ''}
                                onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, contact_name: e.target.value } : item))}
                                placeholder="Nome do responsável"
                              />
                            </label>
                          )}

                          {proposalStage && (
                            <div className="kanban-two-fields">
                              <label>
                                <span>Valor da proposta</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.proposal_value ?? ''}
                                  onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, proposal_value: e.target.value } : item))}
                                  placeholder="R$ 0,00"
                                />
                              </label>
                              <label>
                                <span>Proposta enviada</span>
                                <input
                                  type="date"
                                  value={l.proposal_sent_at || ''}
                                  onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, proposal_sent_at: e.target.value } : item))}
                                />
                              </label>
                            </div>
                          )}

                          {negotiationStage && (
                            <>
                              <div className="kanban-two-fields">
                                <label>
                                  <span>Valor da proposta</span>
                                  <input type="number" value={l.proposal_value ?? ''} readOnly className="readonly-field-v54" />
                                </label>
                                <label>
                                  <span>Proposta enviada</span>
                                  <input type="date" value={l.proposal_sent_at || ''} readOnly className="readonly-field-v54" />
                                </label>
                              </div>
                              <label>
                                <span>Valor renegociado</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.renegotiated_value ?? ''}
                                  onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, renegotiated_value: e.target.value } : item))}
                                  placeholder="R$ 0,00"
                                />
                              </label>
                            </>
                          )}

                          {closedStage && (
                            <div className="kanban-two-fields">
                              <label>
                                <span>Valor do contrato</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.contract_value ?? ''}
                                  onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, contract_value: e.target.value } : item))}
                                  placeholder="R$ 0,00"
                                />
                              </label>
                              <label>
                                <span>Data da assinatura do contrato</span>
                                <input
                                  type="date"
                                  value={l.contract_signed_at || ''}
                                  onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, contract_signed_at: e.target.value } : item))}
                                />
                              </label>
                            </div>
                          )}

                          {(repliedStage || interestedStage || proposalStage || negotiationStage) && (
                            <label className={l.next_contact_date && l.next_contact_date < currentBrazilDate() ? 'next-contact-overdue' : ''}>
                              <span>Próximo contato {l.next_contact_date && l.next_contact_date < currentBrazilDate() && <strong className="overdue-badge">Atrasado</strong>}</span>
                              <input
                                type="date"
                                value={l.next_contact_date || ''}
                                onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, next_contact_date: e.target.value } : item))}
                              />
                            </label>
                          )}

                          {showEditor && (
                            <div className="journey-note-editor-v54">
                              <label>
                                <span>Anotações comerciais</span>
                                <textarea
                                  className="lead-notes-textarea"
                                  value={noteDrafts[l.id] || ''}
                                  onChange={e => setNoteDrafts(old => ({ ...old, [l.id]: e.target.value }))}
                                  placeholder="Registre a conversa, objeções, decisões e próximos passos."
                                />
                              </label>
                              <div className="journey-save-row-v54">
                                <button
                                  type="button"
                                  className="journey-save-button-v54"
                                  onClick={() => saveStageCheckpoint(l, status)}
                                  disabled={savingLeadIds.has(l.id)}
                                >
                                  {savingLeadIds.has(l.id) ? 'Salvando...' : 'Salvar'}
                                </button>
                              </div>
                            </div>
                          )}

                          {showEditor && (leadHistory.length > 0 || (l.commercial_notes || '').trim()) && (
                            <div className="lead-journey-history-v54">
                              <span className="lead-journey-history-title-v54">Histórico</span>
                              {!leadHistory.length && (l.commercial_notes || '').trim() && (
                                <div className="lead-journey-entry-v54 legacy">
                                  <small>Registro anterior</small>
                                  <p>{l.commercial_notes}</p>
                                </div>
                              )}
                              {leadHistory.map(entry => (
                                <div className="lead-journey-entry-v54" key={entry.id}>
                                  <small>{formatDateTime(entry.created_at)} • {statusLabel[entry.stage] || entry.stage}</small>
                                  {entry.note && <p>{entry.note}</p>}
                                  <div className="lead-journey-values-v54">
                                    {entry.proposal_value !== null && entry.proposal_value !== undefined && <span>Proposta: {formatCurrency(entry.proposal_value)}</span>}
                                    {entry.renegotiated_value !== null && entry.renegotiated_value !== undefined && <span>Renegociado: {formatCurrency(entry.renegotiated_value)}</span>}
                                    {entry.contract_value !== null && entry.contract_value !== undefined && <span>Contrato: {formatCurrency(entry.contract_value)}</span>}
                                    {entry.next_contact_date && <span>Próximo contato: {new Date(`${entry.next_contact_date}T12:00:00`).toLocaleDateString('pt-BR')}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <label>
                            <span>Status</span>
                            <select value={l.status} onChange={e => updateStatus(l.id, e.target.value)}>
                              {allowedStatusOptions(l.status).map(([value,statusName]) => <option key={value} value={value}>{statusName}</option>)}
                            </select>
                          </label>

                          {status === 'lost' && (
                            <button type="button" className="secondary recover-lead-v54" onClick={() => recoverLostLead(l)}>
                              Recuperar lead
                            </button>
                          )}

                          <div className="kanban-card-footer">
                            {l.website ? <a className="lead-site-link" href={l.website} target="_blank" rel="noreferrer">Abrir site</a> : <span />}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              )
            })}
        </div>'''

leads = leads[:kanban_start] + new_kanban + leads[kanban_end:]
text = text[:start] + leads + text[end:]


# -----------------------------------------------------------------------------
# 5) CSS apenas para os novos campos/histórico. Não altera scroll nem navegação.
# -----------------------------------------------------------------------------
css += r'''

/* V54 - negociação e histórico comercial */
.readonly-field-v54 {
  background: #f1f5f9 !important;
  color: #475569 !important;
  cursor: not-allowed;
}
.journey-note-editor-v54 {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px;
  background: #fafcfd;
}
.journey-save-row-v54 {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.journey-save-button-v54 {
  border: 0;
  background: transparent;
  color: #0f766e;
  font-size: 11px;
  font-weight: 800;
  padding: 4px 6px;
  border-radius: 6px;
}
.journey-save-button-v54:hover {
  background: #ecfdf5;
}
.journey-save-button-v54:disabled {
  opacity: .55;
  cursor: default;
}
.lead-journey-history-v54 {
  display: grid;
  gap: 7px;
  max-height: 190px;
  overflow-y: auto;
  padding-right: 3px;
}
.lead-journey-history-title-v54 {
  font-size: 11px;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.lead-journey-entry-v54 {
  border-left: 2px solid #cbd5e1;
  padding: 6px 8px;
  background: #f8fafc;
  border-radius: 0 7px 7px 0;
}
.lead-journey-entry-v54 small {
  color: #94a3b8;
  font-size: 10px;
}
.lead-journey-entry-v54 p {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.35;
  color: #334155;
}
.lead-journey-values-v54 {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 5px;
}
.lead-journey-values-v54 span {
  font-size: 10px;
  color: #64748b;
}
.recover-lead-v54 {
  width: 100%;
  padding: 9px 10px;
  font-size: 12px;
}
'''


# -----------------------------------------------------------------------------
# 6) Validação forte: publica somente se todos os pontos solicitados existirem.
# -----------------------------------------------------------------------------
start, end = component_bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads final'
)
check = text[start:end]
checks = [
    ('coluna Negociação criada', "negotiation: 'Negociação'" in check and new_order in check),
    ('Proposta fixa na negociação', 'readOnly className="readonly-field-v54"' in check),
    ('valor renegociado editável', 'Valor renegociado' in check and 'renegotiated_value' in check),
    ('Respondeu com anotações', 'const repliedStage' in check and 'Anotações comerciais' in check),
    ('Ganho/Perdido com contrato', 'Valor do contrato' in check and 'Data da assinatura do contrato' in check),
    ('sem próximo contato em fechado', "['won','lost'].includes(status)" in check),
    ('progressão travada após interessado', "interested: ['interested', 'proposal', 'lost']" in check and "proposal: ['proposal', 'negotiation', 'lost']" in check),
    ('recuperação de perdido preservada', 'recoverLostLead' in check and 'lost_from_status' in check),
    ('histórico com data', "from('lead_journey_entries')" in check and 'formatDateTime(entry.created_at)' in check),
    ('salvar discreto no rodapé das anotações', 'journey-save-button-v54' in check),
    ('sem botão excluir no funil', 'deleteLead(l.id,l.business_name)' not in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V54 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V54 aplicada: Negociação, histórico comercial, salvamento explícito e progressão controlada do funil.')
