from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

start_marker = 'function MessageSending({ organization, settings, userEmail }) {'
end_marker = 'function CampaignWorkspace({ organization, settings, userEmail }) {'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Componente MessageSending não encontrado.')

component = r'''function MessageSending({ organization, settings, userEmail }) {
  const [leads, setLeads] = useState([])
  const [templates, setTemplates] = useState([])
  const [queue, setQueue] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function loadData() {
    const [leadResult, templateResult, queueResult] = await Promise.all([
      supabase
        .from('leads')
        .select('id,business_name,phone,status,target_segment_id,target_segments(name),campaigns(name),city,state')
        .eq('organization_id', organization.id)
        .not('status', 'in', '(discarded,won,lost,not_interested)')
        .order('created_at', { ascending: false }),
      supabase
        .from('message_templates')
        .select('id,target_segment_id,name,is_default_for_target')
        .eq('organization_id', organization.id)
        .eq('is_active', true),
      supabase
        .from('outbound_messages')
        .select('id,lead_id,status,scheduled_for,queued_at,sent_at,error_message')
        .eq('organization_id', organization.id)
        .in('status', ['queued','ready','processing','failed'])
        .order('created_at', { ascending: false })
    ])

    if (leadResult.error || templateResult.error || queueResult.error) {
      setMessage(
        leadResult.error?.message ||
        templateResult.error?.message ||
        queueResult.error?.message ||
        'Não foi possível carregar a página de envio.'
      )
      return
    }

    setLeads(leadResult.data || [])
    setTemplates(templateResult.data || [])
    setQueue(queueResult.data || [])
  }

  useEffect(() => {
    let active = true
    async function refresh() {
      if (!active) return
      await loadData()
    }
    refresh()
    const timer = setInterval(refresh, 4000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [organization.id])

  const batchLimit = Math.max(1, Number(settings?.whatsapp_batch_limit || 20))
  const queuedLeadIds = new Set(
    queue
      .filter(item => ['queued','ready','processing'].includes(item.status))
      .map(item => item.lead_id)
  )

  const selectableLeads = leads.filter(lead =>
    !queuedLeadIds.has(lead.id) &&
    lead.status !== 'queued' &&
    Boolean(normalizeWhatsAppNumber(lead.phone))
  )

  const selectableBatch = selectableLeads.slice(0, batchLimit)
  const allSelectableSelected = selectableBatch.length > 0 && selectableBatch.every(lead => selected.has(lead.id))

  function toggleLead(id, checked) {
    setSelected(previous => {
      const next = new Set(previous)
      if (!checked) {
        next.delete(id)
        return next
      }
      if (next.size >= batchLimit) return previous
      next.add(id)
      return next
    })
  }

  function toggleAll(checked) {
    if (!checked) {
      setSelected(new Set())
      setMessage('')
      return
    }
    setSelected(new Set(selectableBatch.map(lead => lead.id)))
    setMessage(selectableLeads.length > batchLimit
      ? `Foram selecionados os primeiros ${batchLimit} leads, conforme o limite do lote.`
      : '')
  }

  async function send() {
    if (!selected.size || loading) return

    const selectedLeads = leads.filter(lead => selected.has(lead.id))
    const eligibleIds = selectedLeads
      .filter(lead =>
        !queuedLeadIds.has(lead.id) &&
        lead.status !== 'queued' &&
        Boolean(normalizeWhatsAppNumber(lead.phone)) &&
        templates.some(template => template.target_segment_id === lead.target_segment_id)
      )
      .map(lead => lead.id)

    const ignored = selected.size - eligibleIds.length

    if (!eligibleIds.length) {
      setMessage('Nenhum lead selecionado possui todos os dados necessários para o envio. Verifique telefone e mensagem cadastrada para o público-alvo.')
      return
    }

    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.functions.invoke('enqueue_whatsapp_messages', {
      body: { organization_id: organization.id, lead_ids: eligibleIds }
    })

    if (error || data?.error) {
      setMessage(data?.error || error?.message || 'Não foi possível criar a fila de mensagens.')
    } else {
      const ignoredText = ignored > 0 ? ` ${ignored} lead(s) não foram enviados por falta de dados necessários.` : ''
      setMessage(`${data?.queued || 0} mensagem(ns) adicionada(s) à fila.${ignoredText}`)
      setSelected(new Set())
      await loadData()
    }

    setLoading(false)
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">CAMPANHAS</span>
          <h1>Envio</h1>
          <p className="muted">Selecione os leads e envie as mensagens para a fila do WhatsApp.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="panel sending-toolbar">
        <label className="select-all">
          <input
            type="checkbox"
            checked={allSelectableSelected}
            onChange={event => toggleAll(event.target.checked)}
          />
          Selecionar leads
        </label>
        <span>{selected.size} de {batchLimit} selecionados</span>
        <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}>
          <Send size={16}/>{loading ? 'Enviando...' : 'Enviar mensagens'}
        </button>
      </section>

      <section className="panel queue-summary-v32">
        <div>
          <strong>{queue.filter(item => ['queued','ready','processing'].includes(item.status)).length}</strong>
          <span>Na fila</span>
        </div>
        <div>
          <strong>{queue.filter(item => item.status === 'failed').length}</strong>
          <span>Falhas</span>
        </div>
      </section>

      <section className="sending-list">
        {leads.length === 0 ? (
          <article className="panel empty-state">
            <Send size={30}/>
            <h2>Nenhum lead disponível para envio</h2>
          </article>
        ) : leads.map(lead => {
          const hasPhone = Boolean(normalizeWhatsAppNumber(lead.phone))
          const hasTemplate = templates.some(template => template.target_segment_id === lead.target_segment_id)
          const isQueued = lead.status === 'queued' || queuedLeadIds.has(lead.id)
          const canSend = !isQueued && hasPhone && hasTemplate
          const canSelect = !isQueued && hasPhone

          return (
            <article className="panel sending-row" key={lead.id}>
              <input
                type="checkbox"
                checked={selected.has(lead.id)}
                onChange={event => toggleLead(lead.id, event.target.checked)}
                disabled={!canSelect}
                aria-label={`Selecionar ${lead.business_name}`}
              />
              <div>
                <strong>{lead.business_name}</strong>
                <span>{lead.campaigns?.name || lead.target_segments?.name || 'Sem campanha'}</span>
              </div>
              <span>{lead.city || '—'}{lead.state ? `/${lead.state}` : ''}</span>
              <span>{lead.phone || 'Sem telefone'}</span>
              {(isQueued || canSend || !hasPhone) && (
                <span className={isQueued ? 'template-status queued' : canSend ? 'template-status active' : 'template-status inactive'}>
                  {isQueued ? 'Na fila' : canSend ? 'Apto' : 'Sem telefone'}
                </span>
              )}
            </article>
          )
        })}
      </section>
    </>
  )
}

'''

text = text[:start] + component + text[end:]

checks = [
    ('componente restaurado', 'function MessageSending' in text),
    ('flag geral', 'allSelectableSelected' in component),
    ('flag individual', 'toggleLead(lead.id, event.target.checked)' in component),
    ('fila preservada', 'queue-summary-v32' in component),
    ('texto removido', 'Sem mensagem ativa' not in component),
    ('envio preservado', "enqueue_whatsapp_messages" in component),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V42 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V42 aplicada: página Envio restaurada e flags corrigidos.')
