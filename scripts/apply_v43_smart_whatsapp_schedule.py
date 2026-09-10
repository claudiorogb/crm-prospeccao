from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

start_marker = 'function MessageSending({ organization, settings, userEmail }) {'
end_marker = 'function CampaignWorkspace({ organization, settings, userEmail }) {'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Componente MessageSending não encontrado para V43.')

component = r'''function MessageSending({ organization, settings, userEmail }) {
  const [leads, setLeads] = useState([])
  const [templates, setTemplates] = useState([])
  const [queue, setQueue] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [savingWindow, setSavingWindow] = useState(false)
  const [message, setMessage] = useState('')
  const [sendConfig, setSendConfig] = useState({
    dailyLimit: Number(settings?.whatsapp_daily_send_limit || 20),
    intervalSeconds: Number(settings?.whatsapp_send_interval_seconds || 120),
    start: '08:00',
    end: '18:00',
    days: [1, 3, 5]
  })

  async function loadData() {
    const [leadResult, templateResult, queueResult, settingsResult] = await Promise.all([
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
        .order('created_at', { ascending: false }),
      supabase
        .from('organization_settings')
        .select('whatsapp_send_interval_seconds,whatsapp_daily_send_limit,allowed_send_start,allowed_send_end,default_cadence_days')
        .eq('organization_id', organization.id)
        .single()
    ])

    if (leadResult.error || templateResult.error || queueResult.error || settingsResult.error) {
      setMessage(
        leadResult.error?.message ||
        templateResult.error?.message ||
        queueResult.error?.message ||
        settingsResult.error?.message ||
        'Não foi possível carregar a página de envio.'
      )
      return
    }

    setLeads(leadResult.data || [])
    setTemplates(templateResult.data || [])
    setQueue(queueResult.data || [])
    const cfg = settingsResult.data || {}
    setSendConfig({
      dailyLimit: Number(cfg.whatsapp_daily_send_limit || 20),
      intervalSeconds: Number(cfg.whatsapp_send_interval_seconds || 120),
      start: String(cfg.allowed_send_start || '08:00').slice(0, 5),
      end: String(cfg.allowed_send_end || '18:00').slice(0, 5),
      days: Array.isArray(cfg.default_cadence_days) && cfg.default_cadence_days.length ? cfg.default_cadence_days.map(Number) : [1, 3, 5]
    })
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

  const allSelectableSelected = selectableLeads.length > 0 && selectableLeads.every(lead => selected.has(lead.id))

  function toggleLead(id, checked) {
    setSelected(previous => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(checked) {
    setSelected(checked ? new Set(selectableLeads.map(lead => lead.id)) : new Set())
    setMessage('')
  }

  async function saveScheduleWindow() {
    if (!sendConfig.start || !sendConfig.end || sendConfig.start >= sendConfig.end) {
      setMessage('O horário inicial precisa ser anterior ao horário final.')
      return
    }
    setSavingWindow(true)
    setMessage('')
    const { error } = await supabase
      .from('organization_settings')
      .update({ allowed_send_start: sendConfig.start, allowed_send_end: sendConfig.end })
      .eq('organization_id', organization.id)
    if (error) setMessage(error.message)
    else setMessage(`Horário de envio salvo: ${sendConfig.start} às ${sendConfig.end}.`)
    setSavingWindow(false)
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
      const first = data?.first_scheduled_for ? new Date(data.first_scheduled_for).toLocaleString('pt-BR') : '—'
      const last = data?.last_scheduled_for ? new Date(data.last_scheduled_for).toLocaleString('pt-BR') : '—'
      const ignoredText = ignored > 0 ? ` ${ignored} lead(s) não foram agendados por falta de dados necessários.` : ''
      setMessage(`${data?.queued || 0} mensagem(ns) agendada(s). Primeiro envio: ${first}. Último envio: ${last}.${ignoredText}`)
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
          <p className="muted">Selecione quantos leads quiser. O CRM distribui automaticamente os envios pelos dias e horários configurados.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="panel whatsapp-schedule-v43">
        <div>
          <span className="eyebrow">PROGRAMAÇÃO AUTOMÁTICA</span>
          <h2>Janela de envio</h2>
          <p className="muted">Segunda, quarta e sexta • até {sendConfig.dailyLimit} mensagens por dia • intervalo de {sendConfig.intervalSeconds} segundos.</p>
        </div>
        <div className="schedule-fields-v43">
          <label>Início
            <input type="time" value={sendConfig.start} onChange={e => setSendConfig(old => ({...old, start:e.target.value}))} />
          </label>
          <label>Fim
            <input type="time" value={sendConfig.end} onChange={e => setSendConfig(old => ({...old, end:e.target.value}))} />
          </label>
          <button type="button" className="secondary inline-btn" onClick={saveScheduleWindow} disabled={savingWindow}>
            {savingWindow ? 'Salvando...' : 'Salvar horário'}
          </button>
        </div>
      </section>

      <section className="panel sending-toolbar">
        <label className="select-all">
          <input type="checkbox" checked={allSelectableSelected} onChange={event => toggleAll(event.target.checked)} />
          Selecionar todos
        </label>
        <span>{selected.size} selecionado(s)</span>
        <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}>
          <Send size={16}/>{loading ? 'Agendando...' : 'Agendar mensagens'}
        </button>
      </section>

      <section className="panel queue-summary-v32">
        <div><strong>{queue.filter(item => ['queued','ready','processing'].includes(item.status)).length}</strong><span>Na fila</span></div>
        <div><strong>{queue.filter(item => item.status === 'failed').length}</strong><span>Falhas</span></div>
      </section>

      <section className="sending-list">
        {leads.length === 0 ? (
          <article className="panel empty-state"><Send size={30}/><h2>Nenhum lead disponível para envio</h2></article>
        ) : leads.map(lead => {
          const hasPhone = Boolean(normalizeWhatsAppNumber(lead.phone))
          const hasTemplate = templates.some(template => template.target_segment_id === lead.target_segment_id)
          const isQueued = lead.status === 'queued' || queuedLeadIds.has(lead.id)
          const canSend = !isQueued && hasPhone && hasTemplate
          const canSelect = !isQueued && hasPhone
          return (
            <article className="panel sending-row" key={lead.id}>
              <input type="checkbox" checked={selected.has(lead.id)} onChange={event => toggleLead(lead.id, event.target.checked)} disabled={!canSelect} aria-label={`Selecionar ${lead.business_name}`} />
              <div><strong>{lead.business_name}</strong><span>{lead.campaigns?.name || lead.target_segments?.name || 'Sem campanha'}</span></div>
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

css_marker = '/* V43 - programação automática de WhatsApp */'
if css_marker not in text:
    pass

checks = [
    ('seleção sem limite de lote', 'selectableLeads.map(lead => lead.id)' in component and 'batchLimit' not in component),
    ('horário editável', 'allowed_send_start' in component and 'type="time"' in component),
    ('dias informados', 'Segunda, quarta e sexta' in component),
    ('agendamento no backend', "enqueue_whatsapp_messages" in component),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V43 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V43 aplicada: seleção ampla, distribuição automática e janela de horário configurável.')
