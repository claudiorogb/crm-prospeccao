from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f'Marcador não encontrado: {label}')
    text = text.replace(old, new, 1)


def replace_between(start_marker, end_marker, replacement, label):
    global text
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'Início não encontrado: {label}')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'Fim não encontrado: {label}')
    text = text[:start] + replacement + text[end:]


# Dashboard: proposta passa a contar como negócio em andamento.
text = text.replace("ongoing: leads.filter(l => l.status === 'interested').length,", "ongoing: leads.filter(l => ['interested','proposal'].includes(l.status)).length,")
text = text.replace(".filter(l => l.status === 'interested' && l.proposal_sent_at)", ".filter(l => ['interested','proposal'].includes(l.status) && l.proposal_sent_at)")


# Campanhas: remove campos de proposta e acrescenta editar/excluir.
campaigns_component = r'''function Campaigns({ organization, settings, userEmail }) {
  const [campaigns, setCampaigns] = useState([])
  const [segments, setSegments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const emptyForm = () => ({
    name: '',
    target_segment_id: '',
    city: settings?.default_city || 'Campinas',
    state: settings?.default_state || 'SP',
    radius_km: settings?.default_radius_km || 30,
    daily_contact_limit: settings?.default_daily_contact_limit || 20
  })
  const [form, setForm] = useState(emptyForm)

  async function loadData() {
    const [{data: campaignData}, {data: segmentData}] = await Promise.all([
      supabase
        .from('campaigns')
        .select('*, target_segments(name)')
        .eq('organization_id', organization.id)
        .order('created_at', {ascending:false}),
      supabase
        .from('target_segments')
        .select('id,name,is_active')
        .eq('organization_id', organization.id)
        .eq('is_active', true)
        .order('name')
    ])
    setCampaigns(campaignData || [])
    setSegments(segmentData || [])
    if (!form.target_segment_id && segmentData?.length) {
      setForm(old => ({...old, target_segment_id: segmentData[0].id}))
    }
  }

  useEffect(() => { loadData() }, [organization.id])

  function startNew() {
    setEditingId(null)
    const next = emptyForm()
    if (segments.length) next.target_segment_id = segments[0].id
    setForm(next)
    setMessage('')
    setShowForm(true)
  }

  function startEdit(c) {
    setEditingId(c.id)
    setForm({
      name: c.name || '',
      target_segment_id: c.target_segment_id || '',
      city: c.city || settings?.default_city || 'Campinas',
      state: c.state || settings?.default_state || 'SP',
      radius_km: c.radius_km || settings?.default_radius_km || 30,
      daily_contact_limit: c.daily_contact_limit || settings?.default_daily_contact_limit || 20
    })
    setMessage('')
    setShowForm(true)
  }

  async function saveCampaign(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const selected = segments.find(s => s.id === form.target_segment_id)
    const payload = {
      name: form.name.trim(),
      target_segment_id: form.target_segment_id,
      segment: selected?.name || 'Público personalizado',
      city: form.city.trim(),
      state: form.state,
      radius_km: Number(form.radius_km),
      daily_contact_limit: Number(form.daily_contact_limit)
    }

    let error
    if (editingId) {
      ;({ error } = await supabase.from('campaigns').update(payload).eq('id', editingId).eq('organization_id', organization.id))
    } else {
      ;({ error } = await supabase.from('campaigns').insert({
        ...payload,
        organization_id: organization.id,
        cadence_days: [1,3,5],
        status: 'draft',
        search_term_cursor: 0
      }))
    }

    if (error) setMessage(error.message)
    else {
      setMessage(editingId ? 'Campanha atualizada.' : 'Campanha criada com sucesso.')
      setEditingId(null)
      setShowForm(false)
      setForm(emptyForm())
      await loadData()
    }
    setLoading(false)
  }

  async function deleteCampaign(c) {
    if (!window.confirm(`Excluir a campanha "${c.name}"? Os leads já captados serão mantidos.`)) return
    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', c.id)
      .eq('organization_id', organization.id)
    if (error) setMessage(error.message)
    else {
      setMessage('Campanha excluída.')
      await loadData()
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">PROSPECÇÃO</span>
          <h1>Campanhas</h1>
          <p className="muted">Associe um público-alvo a uma região de prospecção.</p>
        </div>
        <div className="topbar-actions">
          <div className="user-badge">{userEmail}</div>
          <button className="primary inline-btn" onClick={startNew} disabled={!segments.length}>
            <Plus size={17}/> Nova campanha
          </button>
        </div>
      </header>

      {!segments.length && <div className="notice">Crie pelo menos um público-alvo antes de criar uma campanha.</div>}

      {showForm && (
        <section className="panel campaign-form-panel">
          <span className="eyebrow">{editingId ? 'EDITAR CAMPANHA' : 'NOVA CAMPANHA'}</span>
          <h2>{editingId ? 'Editar campanha' : 'Configurar prospecção'}</h2>
          <form onSubmit={saveCampaign} className="campaign-form">
            <label>Nome da campanha
              <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex.: Clínicas Campinas" required />
            </label>
            <label>Público-alvo
              <select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})} required>
                {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="field-grid three">
              <label>Cidade<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} required /></label>
              <label>UF
                <select value={form.state} onChange={e=>setForm({...form,state:e.target.value})} required>
                  {UF_OPTIONS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </label>
              <label>Raio (km)<input type="number" min="1" max="50" value={form.radius_km} onChange={e=>setForm({...form,radius_km:e.target.value})} required /></label>
            </div>
            <label>Limite de contatos/dia
              <input type="number" min="1" max="100" value={form.daily_contact_limit} onChange={e=>setForm({...form,daily_contact_limit:e.target.value})} required />
            </label>
            <div className="settings-preview">
              <div><strong>Filtro:</strong> público + raio + empresa operacional + duplicidade</div>
              <div><strong>Cadência:</strong> segunda, quarta e sexta</div>
              <div><strong>Busca:</strong> termos do público alternados automaticamente</div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={()=>{setShowForm(false);setEditingId(null)}}>Cancelar</button>
              <button className="primary" disabled={loading}>{loading?'Salvando...':editingId?'Salvar alterações':'Salvar campanha'}</button>
            </div>
          </form>
        </section>
      )}

      {message && <div className="notice">{message}</div>}

      <section className="campaign-list">
        {campaigns.length===0 ? (
          <article className="panel empty-state"><Target size={34}/><h2>Nenhuma campanha criada</h2><p>Crie a primeira campanha para iniciar a prospecção.</p></article>
        ) : campaigns.map(c => (
          <article className="panel campaign-card" key={c.id}>
            <div>
              <span className="eyebrow">{c.target_segments?.name || c.segment}</span>
              <h2>{c.name}</h2>
              <p>{c.city} / {c.state} • raio de {c.radius_km} km</p>
            </div>
            <div className="campaign-meta campaign-actions-v32">
              <span>{c.daily_contact_limit}/dia</span>
              <button className="secondary" onClick={() => startEdit(c)}>Editar</button>
              <button className="text-danger" onClick={() => deleteCampaign(c)}><Trash2 size={14}/> Excluir</button>
            </div>
          </article>
        ))}
      </section>
    </>
  )
}


'''
replace_between('function Campaigns({ organization, settings, userEmail }) {', 'function Capture({ organization, settings, userEmail }) {', campaigns_component, 'Campanhas')


# Mensagens: mantém listagem existente e acrescenta exclusão.
replace_once(
"""  async function toggleActive(t) {\n    const {error}=await supabase.from('message_templates').update({is_active:!t.is_active}).eq('id',t.id).eq('organization_id',organization.id)\n    if(!error) await loadData()\n  }""",
"""  async function toggleActive(t) {\n    const {error}=await supabase.from('message_templates').update({is_active:!t.is_active}).eq('id',t.id).eq('organization_id',organization.id)\n    if(!error) await loadData()\n  }\n\n  async function deleteTemplate(t) {\n    if (!window.confirm(`Excluir a mensagem \\\"${t.name}\\\"?`)) return\n    const { error } = await supabase\n      .from('message_templates')\n      .delete()\n      .eq('id', t.id)\n      .eq('organization_id', organization.id)\n    if (error) setMessage(error.message)\n    else {\n      setMessage('Mensagem excluída.')\n      await loadData()\n    }\n  }""",
'mensagem - excluir função'
)
replace_once(
"""              <button className=\"secondary\" onClick={()=>toggleActive(t)}>{t.is_active?'Desativar':'Ativar'}</button>""",
"""              <button className=\"secondary\" onClick={()=>toggleActive(t)}>{t.is_active?'Desativar':'Ativar'}</button>\n              <button className=\"text-danger\" onClick={()=>deleteTemplate(t)}><Trash2 size={14}/> Excluir</button>""",
'mensagem - botão excluir'
)


# Leads: remove botão de cadastro manual e seleção por flags desta página.
text = text.replace("          <button className=\"primary inline-btn\" onClick={() => setShowForm(!showForm)}><Plus size={17}/> Novo lead</button>\n", '')

bulk_start = '      <section className="bulk-toolbar">'
bulk_end = '      <section className="sales-kanban-wrap">'
if bulk_start in text and bulk_end in text:
    start = text.find(bulk_start)
    end = text.find(bulk_end, start)
    text = text[:start] + text[end:]

# Novo status Proposta e Kanban com regras específicas por etapa.
text = text.replace("    interested: 'Interessado',\n    not_interested: 'Sem interesse',", "    interested: 'Interessado',\n    proposal: 'Proposta',\n    not_interested: 'Sem interesse',")

kanban_start = '      <section className="sales-kanban-wrap">'
kanban_end = '    </>\n  )\n}\n\nfunction Clients'
start = text.find(kanban_start)
end = text.find(kanban_end, start)
if start < 0 or end < 0:
    raise SystemExit('Kanban V31 não encontrado.')

kanban = r'''      <section className="sales-kanban-wrap sales-kanban-always-scroll">
        <div className="sales-kanban">
          {Object.entries(statusLabel)
            .filter(([status]) => !['discarded','queued'].includes(status))
            .map(([status, label]) => {
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
                      const compactEarly = ['new','qualified','contacted'].includes(status)
                      const repliedStage = status === 'replied'
                      const interestedStage = status === 'interested'
                      const proposalOrLater = ['proposal','won','lost'].includes(status)
                      const minimalRejected = status === 'not_interested'
                      const showNextContact = !['lost','not_interested'].includes(status) && !compactEarly

                      return (
                        <article className="panel kanban-lead-card" key={l.id}>
                          <div className="kanban-card-top">
                            <div>
                              {!minimalRejected && <span className="eyebrow">{l.target_segments?.name || l.segment}</span>}
                              <h3>{l.business_name}</h3>
                            </div>
                          </div>

                          <div className="kanban-card-meta">
                            <span>{l.city || '—'}{l.state ? ` / ${l.state}` : ''}</span>
                            <span>{l.phone || 'Sem telefone'}</span>
                            {l.campaigns?.name && <span>{l.campaigns.name}</span>}
                          </div>

                          {!minimalRejected && !compactEarly && (
                            <label>
                              <span>Nome do contato</span>
                              <input
                                value={l.contact_name || ''}
                                onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, contact_name: e.target.value } : item))}
                                onBlur={e => updateLeadContactField(l.id, 'contact_name', e.target.value.trim())}
                                placeholder="Nome do responsável"
                              />
                            </label>
                          )}

                          {proposalOrLater && (
                            <div className="kanban-two-fields">
                              <label>
                                <span>Valor da proposta</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.proposal_value ?? ''}
                                  onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, proposal_value: e.target.value } : item))}
                                  onBlur={e => updateLeadContactField(l.id, 'proposal_value', e.target.value)}
                                  placeholder="R$ 0,00"
                                />
                              </label>
                              <label>
                                <span>Proposta enviada</span>
                                <input
                                  type="date"
                                  value={l.proposal_sent_at || ''}
                                  onChange={e => {
                                    const value = e.target.value
                                    setLeads(old => old.map(item => item.id === l.id ? { ...item, proposal_sent_at: value } : item))
                                    updateLeadContactField(l.id, 'proposal_sent_at', value)
                                  }}
                                />
                              </label>
                            </div>
                          )}

                          {showNextContact && (
                            <label className={l.next_contact_date && l.next_contact_date < currentBrazilDate() ? 'next-contact-overdue' : ''}>
                              <span>Próximo contato {l.next_contact_date && l.next_contact_date < currentBrazilDate() && <strong className="overdue-badge">Atrasado</strong>}</span>
                              <input
                                type="date"
                                value={l.next_contact_date || ''}
                                onChange={e => {
                                  const value = e.target.value
                                  setLeads(old => old.map(item => item.id === l.id ? { ...item, next_contact_date: value } : item))
                                  updateLeadContactField(l.id, 'next_contact_date', value)
                                }}
                              />
                            </label>
                          )}

                          {!minimalRejected && (interestedStage || proposalOrLater || (l.commercial_notes || '').trim()) && (
                            <label>
                              <span>Anotações comerciais</span>
                              <textarea
                                className="lead-notes-textarea"
                                value={l.commercial_notes || ''}
                                onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, commercial_notes: e.target.value } : item))}
                                onBlur={e => updateLeadContactField(l.id, 'commercial_notes', e.target.value.trim())}
                                placeholder="Necessidades, objeções e próximos passos."
                              />
                            </label>
                          )}

                          {!minimalRejected && (
                            <label>
                              <span>Status</span>
                              <select value={l.status} onChange={e=>updateStatus(l.id,e.target.value)}>
                                {Object.entries(statusLabel).filter(([value]) => value !== 'queued').map(([value,statusName])=><option key={value} value={value}>{statusName}</option>)}
                              </select>
                            </label>
                          )}

                          {!minimalRejected && (
                            <div className="kanban-card-footer">
                              {l.website ? <a className="lead-site-link" href={l.website} target="_blank" rel="noreferrer">Abrir site</a> : <span />}
                              <button type="button" className="text-danger" onClick={()=>deleteLead(l.id,l.business_name)} title="Remove o registro definitivamente">
                                <Trash2 size={14}/> Excluir
                              </button>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </div>
              )
            })}
        </div>
      </section>
'''
text = text[:start] + kanban + text[end:]


# Página Envio: flags ficam aqui e o acompanhamento da fila passa a ser exibido aqui.
message_sending = r'''function MessageSending({ organization, settings, userEmail }) {
  const [leads, setLeads] = useState([])
  const [templates, setTemplates] = useState([])
  const [queue, setQueue] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function loadData() {
    const [{ data: leadData }, { data: templateData }, { data: queueData }] = await Promise.all([
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
    setLeads(leadData || [])
    setTemplates(templateData || [])
    setQueue(queueData || [])
  }

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 4000)
    return () => clearInterval(timer)
  }, [organization.id])

  const batchLimit = Math.max(1, Number(settings?.whatsapp_batch_limit || 20))
  const eligible = leads.filter(l => l.status !== 'queued' && normalizeWhatsAppNumber(l.phone) && templates.some(t => t.target_segment_id === l.target_segment_id))
  const queuedLeadIds = new Set(queue.filter(q => ['queued','ready','processing'].includes(q.status)).map(q => q.lead_id))

  function toggle(id) {
    setSelected(old => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else if (next.size < batchLimit) next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(old => old.size ? new Set() : new Set(eligible.slice(0, batchLimit).map(l => l.id)))
  }

  async function send() {
    if (!selected.size) return
    setLoading(true)
    setMessage('')
    const { data, error } = await supabase.functions.invoke('enqueue_whatsapp_messages', {
      body: { organization_id: organization.id, lead_ids: [...selected] }
    })
    if (error || data?.error) setMessage(data?.error || error?.message || 'Não foi possível criar a fila de mensagens.')
    else {
      setMessage(`${data?.queued || 0} mensagem(ns) adicionada(s) à fila.`)
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
          <h1>Enviar mensagem</h1>
          <p className="muted">Selecione os leads, envie para a fila e acompanhe o processamento nesta página.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="panel sending-toolbar">
        <label className="select-all"><input type="checkbox" checked={selected.size > 0 && selected.size === Math.min(eligible.length, batchLimit)} onChange={toggleAll} /> Selecionar aptos</label>
        <span>{selected.size} de {batchLimit} selecionados</span>
        <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}><Send size={16}/>{loading ? 'Enviando...' : 'Enviar mensagens'}</button>
      </section>

      <section className="panel queue-summary-v32">
        <div><strong>{queue.filter(q => ['queued','ready','processing'].includes(q.status)).length}</strong><span>Na fila</span></div>
        <div><strong>{queue.filter(q => q.status === 'failed').length}</strong><span>Falhas</span></div>
      </section>

      <section className="sending-list">
        {leads.map(l => {
          const hasPhone = Boolean(normalizeWhatsAppNumber(l.phone))
          const hasTemplate = templates.some(t => t.target_segment_id === l.target_segment_id)
          const isQueued = l.status === 'queued' || queuedLeadIds.has(l.id)
          const canSend = !isQueued && hasPhone && hasTemplate
          return (
            <article className="panel sending-row" key={l.id}>
              <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} disabled={!canSend} />
              <div><strong>{l.business_name}</strong><span>{l.campaigns?.name || l.target_segments?.name || 'Sem campanha'}</span></div>
              <span>{l.city || '—'}{l.state ? `/${l.state}` : ''}</span>
              <span>{l.phone || 'Sem telefone'}</span>
              <span className={isQueued ? 'template-status queued' : canSend ? 'template-status active' : 'template-status inactive'}>
                {isQueued ? 'Na fila' : canSend ? 'Apto' : !hasPhone ? 'Sem telefone' : 'Sem mensagem ativa'}
              </span>
            </article>
          )
        })}
      </section>
    </>
  )
}

'''
replace_between('function MessageSending({ organization, settings, userEmail }) {', 'function CampaignWorkspace({ organization, settings, userEmail }) {', message_sending, 'Envio')


# Cadastro manual separado do funil e repositório de sem interesse.
extra_components = r'''function ManualLeadRegistration({ organization, settings, userEmail }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    business_name: '', phone: '', website: '', email: '', address: '',
    city: settings?.default_city || 'Campinas', state: settings?.default_state || 'SP', contact_name: ''
  })

  async function saveLead(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const { error } = await supabase.from('leads').insert({
      organization_id: organization.id,
      campaign_id: null,
      target_segment_id: null,
      business_name: form.business_name.trim(),
      segment: 'Cadastro manual',
      phone: form.phone.trim() || null,
      website: form.website.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state || null,
      contact_name: form.contact_name.trim() || null,
      status: 'new',
      source: 'manual'
    })
    if (error) setMessage(error.message)
    else {
      setMessage('Lead cadastrado com sucesso.')
      setForm(old => ({ ...old, business_name:'', phone:'', website:'', email:'', address:'', contact_name:'' }))
    }
    setLoading(false)
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">FUNIL DE VENDAS</span>
          <h1>Cadastro novo lead</h1>
          <p className="muted">Cadastro manual independente de público-alvo ou campanha.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>
      {message && <div className="notice">{message}</div>}
      <section className="panel campaign-form-panel">
        <form onSubmit={saveLead} className="campaign-form">
          <label>Empresa<input value={form.business_name} onChange={e=>setForm({...form,business_name:e.target.value})} required /></label>
          <div className="field-grid">
            <label>Nome do contato<input value={form.contact_name} onChange={e=>setForm({...form,contact_name:e.target.value})} /></label>
            <label>Telefone
              <div className="phone-input-wrap"><span className="phone-prefix">+55</span><input value={String(form.phone || '').replace(/\D/g,'').replace(/^55/,'')} onChange={e=>{const local=e.target.value.replace(/\D/g,'').slice(0,11);setForm({...form,phone:local?`55${local}`:''})}} placeholder="DDD + número" /></div>
            </label>
          </div>
          <div className="field-grid">
            <label>Site<input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} /></label>
            <label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></label>
          </div>
          <label>Endereço<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} /></label>
          <div className="field-grid">
            <label>Cidade<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} /></label>
            <label>UF<select value={form.state} onChange={e=>setForm({...form,state:e.target.value})}>{UF_OPTIONS.map(uf=><option key={uf} value={uf}>{uf}</option>)}</select></label>
          </div>
          <div className="form-actions"><button className="primary" disabled={loading}>{loading?'Salvando...':'Salvar lead'}</button></div>
        </form>
      </section>
    </>
  )
}

function NotInterestedRepository({ organization, userEmail }) {
  const [leads, setLeads] = useState([])
  const [message, setMessage] = useState('')
  async function loadData() {
    const { data } = await supabase.from('leads').select('id,business_name,phone,city,state,campaigns(name)').eq('organization_id', organization.id).eq('status','not_interested').order('updated_at',{ascending:false})
    setLeads(data || [])
  }
  useEffect(()=>{loadData()},[organization.id])
  async function reopen(id) {
    const { error } = await supabase.from('leads').update({status:'new'}).eq('id',id).eq('organization_id',organization.id)
    if (error) setMessage(error.message)
    else { setMessage('Lead devolvido ao funil como Novo.'); await loadData() }
  }
  return (
    <>
      <header className="topbar compact-subpage-header">
        <div><span className="eyebrow">FUNIL DE VENDAS</span><h1>Repositório</h1><p className="muted">Leads classificados como sem interesse permanecem guardados aqui.</p></div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>
      {message && <div className="notice">{message}</div>}
      <section className="campaign-list">
        {leads.length === 0 ? <article className="panel empty-state"><h2>Nenhum lead no repositório</h2></article> : leads.map(l => (
          <article className="panel repository-row-v32" key={l.id}>
            <div><strong>{l.business_name}</strong><span>{l.campaigns?.name || 'Sem campanha'} • {l.city || '—'}{l.state ? `/${l.state}` : ''} • {l.phone || 'Sem telefone'}</span></div>
            <button className="secondary" onClick={()=>reopen(l.id)}>Reabrir</button>
          </article>
        ))}
      </section>
    </>
  )
}

'''
insert_pos = text.find('function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {')
if insert_pos < 0:
    raise SystemExit('SalesFunnelWorkspace não encontrado.')
text = text[:insert_pos] + extra_components + text[insert_pos:]

# Ordem dos submenus: Enviar mensagem logo após Captação.
text = text.replace("    ['capture','Captação'],\n    ['messages','Mensagens'],\n    ['sending','Envio'],", "    ['capture','Captação'],\n    ['sending','Enviar mensagem'],\n    ['messages','Mensagens'],")

sales_workspace = r'''function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {
  const [section, setSection] = useState('leads')
  return (
    <>
      <div className="workspace-tabs">
        <button className={section === 'leads' ? 'active' : ''} onClick={() => setSection('leads')}>Leads</button>
        <button className={section === 'new-lead' ? 'active' : ''} onClick={() => setSection('new-lead')}>Cadastro novo lead</button>
        <button className={section === 'clients' ? 'active' : ''} onClick={() => setSection('clients')}>Clientes</button>
        <button className={section === 'repository' ? 'active' : ''} onClick={() => setSection('repository')}>Repositório</button>
      </div>
      {section === 'leads' && <Leads organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'new-lead' && <ManualLeadRegistration organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'clients' && <Clients organization={organization} userEmail={userEmail} userId={userId} />}
      {section === 'repository' && <NotInterestedRepository organization={organization} userEmail={userEmail} />}
    </>
  )
}

'''
replace_between('function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {', 'function AdminOverview', sales_workspace, 'Funil workspace')


# CSS V32
if '/* V32 - melhorias comerciais */' not in css:
    css += r'''

/* V32 - melhorias comerciais */
.sales-kanban-always-scroll {
  height: calc(100vh - 255px);
  min-height: 420px;
  overflow: auto;
  padding-bottom: 8px;
  scrollbar-gutter: stable;
}
.sales-kanban-always-scroll .kanban-column-head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--panel, #fff);
}
.campaign-actions-v32 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.queue-summary-v32 {
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 1fr));
  gap: 16px;
  margin-bottom: 14px;
}
.queue-summary-v32 > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.queue-summary-v32 strong { font-size: 24px; }
.template-status.queued { background: #eef2ff; color: #3730a3; }
.repository-row-v32 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.repository-row-v32 > div { display: flex; flex-direction: column; gap: 5px; }
@media (max-width: 760px) {
  .sales-kanban-always-scroll { height: calc(100vh - 220px); min-height: 360px; }
  .repository-row-v32 { align-items: flex-start; flex-direction: column; }
  .queue-summary-v32 { grid-template-columns: 1fr 1fr; }
}
'''

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V32 aplicado com sucesso.')
