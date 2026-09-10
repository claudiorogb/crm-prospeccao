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


def replace_between(start_marker, end_marker, replacement, label, use_last=False):
    global text
    start = text.rfind(start_marker) if use_last else text.find(start_marker)
    if start < 0:
        raise SystemExit(f'Início não encontrado: {label}')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'Fim não encontrado: {label}')
    text = text[:start] + replacement + text[end:]


# 1) Dashboard comercial
start = text.find('function Dashboard({ organization, settings, userEmail, onGoCampaigns }) {')
end = text.find('function CatalogAdmin', start)
if start < 0 or end < 0:
    raise SystemExit('Não foi possível localizar o Dashboard atual.')

dashboard = r'''function Dashboard({ organization, userEmail, onGoCampaigns }) {
  const [stats, setStats] = useState({
    leadsFound: 0,
    contacted: 0,
    ongoing: 0,
    won: 0,
    wonValue: 0,
    ongoingValue: 0
  })

  useEffect(() => {
    let active = true

    async function loadStats() {
      const [{ data: leadsData, error: leadsError }, { data: salesData, error: salesError }] = await Promise.all([
        supabase
          .from('leads')
          .select('id,status,last_contact_date,last_contacted_at,proposal_value,proposal_sent_at')
          .eq('organization_id', organization.id),
        supabase
          .from('sales')
          .select('amount,lead_id')
          .eq('organization_id', organization.id)
      ])

      if (!active || leadsError || salesError) return

      const leads = leadsData || []
      const sales = salesData || []
      const contactedStatuses = new Set(['contacted','replied','interested','not_interested','won','lost'])
      const wonIds = new Set(leads.filter(l => l.status === 'won').map(l => l.id))

      setStats({
        leadsFound: leads.length,
        contacted: leads.filter(l => l.last_contact_date || l.last_contacted_at || contactedStatuses.has(l.status)).length,
        ongoing: leads.filter(l => l.status === 'interested').length,
        won: wonIds.size,
        wonValue: sales.filter(s => wonIds.has(s.lead_id)).reduce((sum, s) => sum + Number(s.amount || 0), 0),
        ongoingValue: leads
          .filter(l => l.status === 'interested' && l.proposal_sent_at)
          .reduce((sum, l) => sum + Number(l.proposal_value || 0), 0)
      })
    }

    loadStats()
    const timer = setInterval(loadStats, 15000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [organization.id])

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">PAINEL</span>
          <h1>Dashboard</h1>
          <p className="muted">Resumo da prospecção e do funil comercial.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <section className="stats-grid dashboard-commercial-grid">
        <StatCard label="Leads encontrados" value={stats.leadsFound} detail="Total captado ou cadastrado" />
        <StatCard label="Leads contatados" value={stats.contacted} detail="Leads que já receberam contato" />
        <StatCard label="Negócios em andamento" value={stats.ongoing} detail="Leads atualmente interessados" />
        <StatCard label="Negócios fechados" value={stats.won} detail={`Valor total: ${formatCurrency(stats.wonValue)}`} />
        <StatCard label="Propostas em andamento" value={formatCurrency(stats.ongoingValue)} detail="Somente propostas enviadas de negócios interessados" />
      </section>

      <section className="panel dashboard-shortcut clickable" onClick={onGoCampaigns}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">PROSPECÇÃO</span>
            <h2>Campanhas</h2>
          </div>
          <ChevronRight />
        </div>
        <p>Cadastre públicos, campanhas, captação, mensagens, envios e números de WhatsApp em um único lugar.</p>
      </section>
    </>
  )
}


'''
text = text[:start] + dashboard + text[end:]

# 2) Campos de proposta no cadastro e edição de leads
replace_once(
"""    next_contact_date: '',\n    status: 'new'""",
"""    next_contact_date: '',\n    proposal_value: '',\n    proposal_sent_at: '',\n    status: 'new'""",
'formulário inicial de lead'
)

replace_once(
"""      next_contact_date: form.next_contact_date || null,\n      status: form.status,""",
"""      next_contact_date: form.next_contact_date || null,\n      proposal_value: form.proposal_value === '' ? null : Number(String(form.proposal_value).replace(',', '.')),\n      proposal_sent_at: form.proposal_sent_at || null,\n      status: form.status,""",
'insert do lead'
)

replace_once(
"""        next_contact_date:''\n      }))""",
"""        next_contact_date:'',\n        proposal_value:'',\n        proposal_sent_at:''\n      }))""",
'limpeza do formulário de lead'
)

replace_once(
"""    const allowed = ['contact_name', 'last_contact_date', 'next_contact_date', 'commercial_notes']""",
"""    const allowed = ['contact_name', 'last_contact_date', 'next_contact_date', 'commercial_notes', 'proposal_value', 'proposal_sent_at']""",
'campos editáveis de lead'
)

manual_marker = """            <div className=\"form-actions\">\n              <button type=\"button\" className=\"secondary\" onClick={()=>setShowForm(false)}>Cancelar</button>"""
manual_insert = """            <div className=\"field-grid\">\n              <label>\n                Valor da proposta (R$)\n                <input\n                  type=\"number\"\n                  min=\"0\"\n                  step=\"0.01\"\n                  value={form.proposal_value}\n                  onChange={e=>setForm({...form,proposal_value:e.target.value})}\n                  placeholder=\"0,00\"\n                />\n              </label>\n              <label>\n                Data de envio da proposta\n                <input\n                  type=\"date\"\n                  value={form.proposal_sent_at}\n                  onChange={e=>setForm({...form,proposal_sent_at:e.target.value})}\n                />\n              </label>\n            </div>\n\n            <div className=\"form-actions\">\n              <button type=\"button\" className=\"secondary\" onClick={()=>setShowForm(false)}>Cancelar</button>"""
replace_once(manual_marker, manual_insert, 'campos de proposta no cadastro manual')

# 3) Kanban no funil de Leads. Mantém seleção/envio, edição de status e dados comerciais.
lead_list_start = '      <section className="lead-list">'
lead_list_end = '      </section>\n    </>\n  )\n}\n\nfunction Clients'
start = text.find(lead_list_start)
end = text.find(lead_list_end, start)
if start < 0 or end < 0:
    raise SystemExit('Não foi possível localizar a lista atual de leads.')

kanban = r'''      <section className="sales-kanban-wrap">
        <div className="sales-kanban">
          {Object.entries(statusLabel)
            .filter(([status]) => status !== 'discarded')
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
                    ) : columnLeads.map(l => (
                      <article className="panel kanban-lead-card" key={l.id}>
                        <div className="kanban-card-top">
                          <input
                            type="checkbox"
                            checked={selected.has(l.id)}
                            onChange={()=>toggleSelected(l.id)}
                            aria-label={`Selecionar ${l.business_name}`}
                          />
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

                        <label>
                          <span>Nome do contato</span>
                          <input
                            value={l.contact_name || ''}
                            onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, contact_name: e.target.value } : item))}
                            onBlur={e => updateLeadContactField(l.id, 'contact_name', e.target.value.trim())}
                            placeholder="Nome do responsável"
                          />
                        </label>

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

                        {(l.status === 'interested' || (l.commercial_notes || '').trim()) && (
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

                        <label>
                          <span>Status</span>
                          <select value={l.status} onChange={e=>updateStatus(l.id,e.target.value)}>
                            {Object.entries(statusLabel).map(([value,statusName])=><option key={value} value={value}>{statusName}</option>)}
                          </select>
                        </label>

                        <div className="kanban-card-footer">
                          {l.website ? <a className="lead-site-link" href={l.website} target="_blank" rel="noreferrer">Abrir site</a> : <span />}
                          <button type="button" className="text-danger" onClick={()=>deleteLead(l.id,l.business_name)} title="Remove o registro definitivamente">
                            <Trash2 size={14}/> Excluir
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )
            })}
        </div>
      </section>
'''
text = text[:start] + kanban + text[end + len('      </section>\n'):]

# 4) Área de envio e hubs de navegação
insert_at = text.find('function AdminOverview')
if insert_at < 0:
    raise SystemExit('Não foi possível localizar AdminOverview para inserir os hubs.')

hubs = r'''
function MessageSending({ organization, settings, userEmail }) {
  const [leads, setLeads] = useState([])
  const [templates, setTemplates] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function loadData() {
    const [{ data: leadData }, { data: templateData }] = await Promise.all([
      supabase
        .from('leads')
        .select('id,business_name,phone,status,target_segment_id,target_segments(name)')
        .eq('organization_id', organization.id)
        .not('status', 'in', '(discarded,won,lost)')
        .order('created_at', { ascending: false }),
      supabase
        .from('message_templates')
        .select('id,target_segment_id,name,is_default_for_target')
        .eq('organization_id', organization.id)
        .eq('is_active', true)
    ])
    setLeads(leadData || [])
    setTemplates(templateData || [])
  }

  useEffect(() => { loadData() }, [organization.id])

  const batchLimit = Math.max(1, Number(settings?.whatsapp_batch_limit || 20))
  const eligible = leads.filter(l => normalizeWhatsAppNumber(l.phone) && templates.some(t => t.target_segment_id === l.target_segment_id))

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
          <h1>Envio</h1>
          <p className="muted">Selecione leads aptos e envie as mensagens cadastradas para a fila do WhatsApp.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="panel sending-toolbar">
        <label className="select-all"><input type="checkbox" checked={selected.size > 0 && selected.size === Math.min(eligible.length, batchLimit)} onChange={toggleAll} /> Selecionar aptos</label>
        <span>{selected.size} de {batchLimit} selecionados</span>
        <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}><Send size={16}/>{loading ? 'Enviando...' : 'Enviar mensagens'}</button>
      </section>

      <section className="sending-list">
        {leads.map(l => {
          const hasPhone = Boolean(normalizeWhatsAppNumber(l.phone))
          const hasTemplate = templates.some(t => t.target_segment_id === l.target_segment_id)
          const canSend = hasPhone && hasTemplate
          return (
            <article className="panel sending-row" key={l.id}>
              <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} disabled={!canSend} />
              <div><strong>{l.business_name}</strong><span>{l.target_segments?.name || 'Sem público definido'}</span></div>
              <span>{l.phone || 'Sem telefone'}</span>
              <span className={canSend ? 'template-status active' : 'template-status inactive'}>{canSend ? 'Apto' : !hasPhone ? 'Sem telefone' : 'Sem mensagem ativa'}</span>
            </article>
          )
        })}
      </section>
    </>
  )
}

function CampaignWorkspace({ organization, settings, userEmail }) {
  const [section, setSection] = useState('targets')
  const items = [
    ['targets','Público-alvo'],
    ['campaigns','Campanha'],
    ['capture','Captação'],
    ['messages','Mensagens'],
    ['sending','Envio'],
    ['whatsapp','WhatsApp']
  ]

  return (
    <>
      <div className="workspace-tabs">
        {items.map(([key,label]) => <button key={key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>{label}</button>)}
      </div>
      {section === 'targets' && <TargetSegments organization={organization} userEmail={userEmail} />}
      {section === 'campaigns' && settings?.feature_flags?.campaigns !== false && <Campaigns organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'capture' && settings?.feature_flags?.capture !== false && <Capture organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'messages' && settings?.feature_flags?.messages !== false && <Messages organization={organization} userEmail={userEmail} />}
      {section === 'sending' && <MessageSending organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'whatsapp' && <AdminWhatsApp organizations={[organization]} userEmail={userEmail} userMode={true} />}
    </>
  )
}

function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {
  const [section, setSection] = useState('leads')
  return (
    <>
      <div className="workspace-tabs">
        <button className={section === 'leads' ? 'active' : ''} onClick={() => setSection('leads')}>Leads</button>
        <button className={section === 'clients' ? 'active' : ''} onClick={() => setSection('clients')}>Clientes</button>
      </div>
      {section === 'leads' && <Leads organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'clients' && <Clients organization={organization} userEmail={userEmail} userId={userId} />}
    </>
  )
}

'''
text = text[:insert_at] + hubs + text[insert_at:]

# 5) Menu principal reduzido a Dashboard, Campanhas e Funil de vendas.
nav_start = '        <nav>\n          <button className={`nav-item ${page === \'dashboard\' ? \'active\' : \'\'}`}'
nav_pos = text.find(nav_start)
if nav_pos < 0:
    raise SystemExit('Menu principal do usuário não encontrado.')
nav_end = text.find('        </nav>', nav_pos)
if nav_end < 0:
    raise SystemExit('Fim do menu principal não encontrado.')
nav_end += len('        </nav>')
new_nav = r'''        <nav>
          <button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => { setPage('dashboard'); setMobileMenuOpen(false) }}>
            <Building2 size={18}/> Dashboard
          </button>
          <button className={`nav-item ${page === 'campaign-workspace' ? 'active' : ''}`} onClick={() => { setPage('campaign-workspace'); setMobileMenuOpen(false) }}>
            <Target size={18}/> Campanhas
          </button>
          <button className={`nav-item ${page === 'sales-funnel' ? 'active' : ''}`} onClick={() => { setPage('sales-funnel'); setMobileMenuOpen(false) }}>
            <Users size={18}/> Funil de vendas
          </button>

          {isSystemAdmin && (
            <button className={`nav-item ${page === 'administration' ? 'active' : ''}`} onClick={() => { setPage('administration'); setMobileMenuOpen(false) }}>
              <Shield size={18}/> Administração
            </button>
          )}
        </nav>'''
text = text[:nav_pos] + new_nav + text[nav_end:]

# 6) Conteúdo principal ligado aos novos hubs.
main_start = text.rfind('      <main className="content">')
main_end = text.find('      </main>', main_start)
if main_start < 0 or main_end < 0:
    raise SystemExit('Conteúdo principal do usuário não encontrado.')
main_end += len('      </main>')
new_main = r'''      <main className="content">
        {page === 'dashboard' && (
          <Dashboard
            organization={organization}
            settings={settings}
            userEmail={userEmail}
            onGoCampaigns={() => setPage('campaign-workspace')}
          />
        )}
        {page === 'campaign-workspace' && (
          <CampaignWorkspace organization={organization} settings={settings} userEmail={userEmail} />
        )}
        {page === 'sales-funnel' && settings?.feature_flags?.leads !== false && (
          <SalesFunnelWorkspace
            organization={organization}
            settings={settings}
            userEmail={userEmail}
            userId={session.user.id}
          />
        )}
        {page === 'administration' && isSystemAdmin && (
          <Administration
            organizations={adminOrganizations}
            reloadOrganizations={loadAdminOrganizations}
            userEmail={userEmail}
          />
        )}
      </main>'''
text = text[:main_start] + new_main + text[main_end:]

# 7) CSS do submenu e Kanban. Sem drag-and-drop.
css_marker = '/* V31 - reorganização CRM */'
if css_marker not in css:
    css += r'''

/* V31 - reorganização CRM */
.workspace-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 20px;
  padding: 8px;
  background: var(--panel, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px;
}
.workspace-tabs button {
  border: 0;
  background: transparent;
  padding: 10px 14px;
  border-radius: 9px;
  cursor: pointer;
  font-weight: 600;
}
.workspace-tabs button.active {
  background: #111827;
  color: #fff;
}
.dashboard-commercial-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.dashboard-shortcut { margin-top: 18px; }
.sales-kanban-wrap { overflow-x: auto; padding-bottom: 14px; }
.sales-kanban {
  display: grid;
  grid-template-columns: repeat(9, minmax(285px, 1fr));
  gap: 14px;
  min-width: max-content;
  align-items: start;
}
.kanban-column {
  width: 285px;
  background: #f5f6f8;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  min-height: 280px;
  overflow: hidden;
}
.kanban-column-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}
.kanban-column-head span {
  min-width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: #eef0f3;
  font-size: 12px;
  font-weight: 700;
}
.kanban-column-cards { display: grid; gap: 10px; padding: 10px; }
.kanban-empty { padding: 24px 10px; text-align: center; color: #6b7280; font-size: 13px; }
.kanban-lead-card { padding: 12px; display: grid; gap: 11px; }
.kanban-card-top { display: grid; grid-template-columns: 20px 1fr; gap: 8px; align-items: start; }
.kanban-card-top h3 { margin: 2px 0 0; font-size: 15px; line-height: 1.25; }
.kanban-card-meta { display: grid; gap: 3px; font-size: 12px; color: #667085; }
.kanban-lead-card label { display: grid; gap: 5px; font-size: 11px; font-weight: 600; }
.kanban-lead-card input, .kanban-lead-card select, .kanban-lead-card textarea { width: 100%; }
.kanban-two-fields { display: grid; grid-template-columns: 1fr; gap: 8px; }
.kanban-card-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.sending-toolbar { display: flex; gap: 18px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.sending-list { display: grid; gap: 10px; margin-top: 14px; }
.sending-row { display: grid; grid-template-columns: 28px minmax(180px, 1fr) minmax(140px, .7fr) auto; gap: 12px; align-items: center; }
.sending-row > div { display: grid; gap: 3px; }
.sending-row > div span { color: #667085; font-size: 12px; }

@media (max-width: 1180px) {
  .dashboard-commercial-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .workspace-tabs { overflow-x: auto; flex-wrap: nowrap; }
  .workspace-tabs button { white-space: nowrap; }
  .dashboard-commercial-grid { grid-template-columns: 1fr; }
  .sales-kanban { grid-template-columns: repeat(9, minmax(260px, 1fr)); }
  .kanban-column { width: 260px; }
  .sending-row { grid-template-columns: 28px 1fr; }
  .sending-row > span { grid-column: 2; }
}
'''

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V31 aplicada com sucesso.')
