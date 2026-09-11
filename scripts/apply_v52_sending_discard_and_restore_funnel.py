from pathlib import Path
import re

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def component(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V52: componente não encontrado: {label}')
    return start, end, text[start:end]


# -----------------------------------------------------------------------------
# 1) ENVIO: seleção continua por flags, permite descartar em massa SEM apagar
#    do banco e mostra apenas leads ainda aguardando o primeiro contato.
#    Após o worker confirmar o envio, o lead vira "contacted" e sai desta tela.
# -----------------------------------------------------------------------------
start, end, sending = component(
    'function MessageSending({ organization, settings, userEmail }) {',
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'Envio de mensagens'
)

sending = sending.replace(
    ".eq('organization_id', organization.id)\n        .not('status', 'in', '(discarded,won,lost,not_interested)')\n        .order('created_at', { ascending: false }),",
    ".eq('organization_id', organization.id)\n        .is('deleted_at', null)\n        .in('status', ['new','qualified','queued'])\n        .order('created_at', { ascending: false }),",
    1
)

old_selectable = '''  const selectableLeads = leads.filter(lead =>
    !queuedLeadIds.has(lead.id) &&
    lead.status !== 'queued' &&
    Boolean(normalizeWhatsAppNumber(lead.phone))
  )'''
new_selectable = '''  const selectableLeads = leads.filter(lead =>
    !queuedLeadIds.has(lead.id) &&
    lead.status !== 'queued'
  )'''
if old_selectable not in sending:
    raise SystemExit('V52: seleção da tela Envio não encontrada.')
sending = sending.replace(old_selectable, new_selectable, 1)

insert_before_send = '''  async function send() {'''
discard_function = r'''  async function discardSelected() {
    if (!selected.size || loading) return

    const ids = leads
      .filter(lead => selected.has(lead.id) && !queuedLeadIds.has(lead.id) && lead.status !== 'queued')
      .map(lead => lead.id)

    if (!ids.length) {
      setMessage('Nenhum dos leads selecionados pode ser descartado enquanto estiver na fila de envio.')
      return
    }

    if (!window.confirm(`Descartar ${ids.length} captação(ões) selecionada(s)? Os registros serão preservados no banco e poderão ser recuperados em Leads sem interesse.`)) return

    setLoading(true)
    setMessage('')
    const { error } = await supabase
      .from('leads')
      .update({ status: 'discarded', updated_at: new Date().toISOString() })
      .eq('organization_id', organization.id)
      .is('deleted_at', null)
      .in('id', ids)

    if (error) {
      setMessage(error.message || 'Não foi possível descartar os leads selecionados.')
    } else {
      setMessage(`${ids.length} captação(ões) descartada(s). Os registros permanecem preservados no banco.`)
      setSelected(new Set())
      await loadData()
    }
    setLoading(false)
  }

'''
if insert_before_send not in sending:
    raise SystemExit('V52: função send não encontrada.')
sending = sending.replace(insert_before_send, discard_function + insert_before_send, 1)

old_toolbar_button = '''        <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}>
          <Send size={16}/>{loading ? 'Agendando...' : 'Agendar mensagens'}
        </button>'''
new_toolbar_button = '''        <div className="sending-bulk-actions-v52">
          <button type="button" className="secondary danger inline-btn" onClick={discardSelected} disabled={!selected.size || loading}>
            <Trash2 size={16}/>Descartar selecionados
          </button>
          <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}>
            <Send size={16}/>{loading ? 'Processando...' : 'Agendar mensagens'}
          </button>
        </div>'''
if old_toolbar_button not in sending:
    raise SystemExit('V52: botão de envio não encontrado.')
sending = sending.replace(old_toolbar_button, new_toolbar_button, 1)

sending = sending.replace(
    "          const canSelect = !isQueued && hasPhone",
    "          const canSelect = !isQueued",
    1
)

text = text[:start] + sending + text[end:]


# -----------------------------------------------------------------------------
# 2) FUNIL: remove integralmente a tentativa de cabeçalho congelado da V51.
#    O usuário preferiu manter o layout estável a continuar com esse recurso.
#    Preserva a barra horizontal fixa já existente (V35) e toda a lógica do funil.
# -----------------------------------------------------------------------------
start, end, leads = component(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)

leads = leads.replace('  const stickyKanbanHeaderRef = useRef(null)\n', '', 1)

sticky_start = leads.find('      <div className="kanban-sticky-scope-v51">')
section_marker = '''      <section
        className="sales-kanban-wrap sales-kanban-always-scroll"
        ref={kanbanScrollRef}'''
section_pos = leads.find(section_marker, sticky_start if sticky_start >= 0 else 0)
if sticky_start < 0 or section_pos < 0:
    raise SystemExit('V52: estrutura sticky da V51 não encontrada para remoção.')

# Remove abertura do wrapper e faixa duplicada de cabeçalhos.
leads = leads[:sticky_start] + leads[section_pos:]

sticky_sync = '''          if (stickyKanbanHeaderRef.current && Math.abs(stickyKanbanHeaderRef.current.scrollLeft - e.currentTarget.scrollLeft) > 1) {
            stickyKanbanHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft
          }
'''
if sticky_sync not in leads:
    raise SystemExit('V52: sincronização sticky não encontrada.')
leads = leads.replace(sticky_sync, '', 1)

# Remove somente o fechamento do wrapper criado pela V51, logo após o Kanban.
section_pos = leads.find(section_marker)
section_end = leads.find('\n      </section>', section_pos)
if section_end < 0:
    raise SystemExit('V52: fim do Kanban não encontrado.')
section_end += len('\n      </section>')
if leads[section_end:section_end + len('\n      </div>')] != '\n      </div>':
    raise SystemExit('V52: fechamento do wrapper sticky não encontrado.')
leads = leads[:section_end] + leads[section_end + len('\n      </div>'):]

# Ordem explícita do funil: Perdido é sempre a última coluna.
old_order = '''          {Object.entries(statusLabel)
            .filter(([status]) => !['discarded','queued','not_interested'].includes(status))
            .map(([status, label]) => {'''
new_order = '''          {['new','qualified','contacted','replied','interested','proposal','won','lost']
            .map(status => {
              const label = statusLabel[status]'''
if old_order not in leads:
    raise SystemExit('V52: renderização das colunas do funil não encontrada.')
leads = leads.replace(old_order, new_order, 1)

text = text[:start] + leads + text[end:]


# -----------------------------------------------------------------------------
# 3) CSS: remove regras do congelamento e evita corte de cards longos.
# -----------------------------------------------------------------------------
css, removed_v49 = re.subn(
    r'\.sales-kanban-always-scroll \.kanban-column-head \{\n  position: sticky !important;\n  top: 0 !important;\n  z-index: 30 !important;\n  background: #ffffff !important;\n  border-bottom: 1px solid #e2e8f0;\n  box-shadow: 0 4px 10px rgba\(15, 23, 42, \.05\);\n\}\n',
    '',
    css,
    count=1
)
if removed_v49 != 1:
    raise SystemExit('V52: regra sticky da V49 não encontrada.')

for selector in [
    r'\.kanban-sticky-scope-v51',
    r'\.kanban-sticky-viewport-v51',
    r'\.kanban-sticky-grid-v51',
    r'\.kanban-sticky-cell-v51',
    r'\.sales-kanban-always-scroll \.kanban-column > \.kanban-column-head',
]:
    css = re.sub(selector + r' \{.*?\}\n', '', css, count=1, flags=re.S)

css += r'''

/* V52 - funil estável sem cabeçalho congelado */
.sales-kanban-always-scroll .kanban-column-head {
  position: static !important;
  top: auto !important;
  z-index: auto !important;
  display: flex !important;
}
.kanban-column {
  height: auto !important;
  overflow: visible !important;
}
.sending-bulk-actions-v52 {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
@media (max-width: 700px) {
  .sending-bulk-actions-v52 {
    width: 100%;
    justify-content: stretch;
  }
  .sending-bulk-actions-v52 button {
    flex: 1 1 100%;
    justify-content: center;
  }
}
'''


# -----------------------------------------------------------------------------
# 4) Validações: evita publicar uma correção parcial.
# -----------------------------------------------------------------------------
start, end, sending_check = component(
    'function MessageSending({ organization, settings, userEmail }) {',
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'Envio final'
)
start, end, leads_check = component(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads final'
)

checks = [
    ('descarte em massa sem delete físico', 'discardSelected' in sending_check and ".update({ status: 'discarded'" in sending_check and '.delete()' not in sending_check),
    ('flags permitem selecionar sem telefone para descarte', 'const canSelect = !isQueued' in sending_check),
    ('enviados deixam a tela ao virar contacted', ".in('status', ['new','qualified','queued'])" in sending_check),
    ('registro preservado no banco', 'Os registros permanecem preservados no banco' in sending_check),
    ('sticky removido do JSX', 'kanban-sticky-scope-v51' not in leads_check and 'stickyKanbanHeaderRef' not in leads_check),
    ('Perdido por último', "['new','qualified','contacted','replied','interested','proposal','won','lost']" in leads_check),
    ('cabeçalho normal restaurado', '.sales-kanban-always-scroll .kanban-column-head' in css and 'position: static !important' in css),
    ('cards não cortados', 'overflow: visible !important;' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V52 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V52 aplicada: descarte em massa preservando banco, enviados saem da tela e funil restaurado sem sticky.')
