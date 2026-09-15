from pathlib import Path

APP = Path('src/email-marketing.jsx')
CSS = Path('src/email-marketing.css')

s = APP.read_text(encoding='utf-8')


def replace_one(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, found {count}')
    s = s.replace(old, new, 1)

replace_one(
    "import { supabase } from './lib/supabase'\nimport './email-marketing.css'",
    "import { supabase } from './lib/supabase'\nimport MarketingListImport from './marketing-list-import'\nimport './email-marketing.css'",
    'import MarketingListImport'
)

replace_one(
    "  const [clients, setClients] = useState([])\n  const [campaigns, setCampaigns] = useState([])\n  const [selected, setSelected] = useState(() => new Set())\n  const [search, setSearch] = useState('')",
    "  const [clients, setClients] = useState([])\n  const [marketingContacts, setMarketingContacts] = useState([])\n  const [campaigns, setCampaigns] = useState([])\n  const [selected, setSelected] = useState(() => new Set())\n  const [selectedMarketing, setSelectedMarketing] = useState(() => new Set())\n  const [search, setSearch] = useState('')",
    'state sources'
)

start = s.index("    const [connectionResult, limitResult, clientsResult, campaignResult] = await Promise.all([")
end = s.index("    ])", start) + len("    ])")
s = s[:start] + """    const [connectionResult, limitResult, clientsResult, marketingResult, campaignResult] = await Promise.all([
      supabase.from('email_connections').select('organization_id,provider,email_address,sender_email,sender_name,status,last_error,connected_at').eq('organization_id', organization.id).maybeSingle(),
      supabase.from('organization_email_limits').select('*').eq('organization_id', organization.id).maybeSingle(),
      supabase.from('leads').select('id,business_name,contact_name,email,city,state,email_marketing_opt_out').eq('organization_id', organization.id).eq('status', 'won').is('deleted_at', null).order('business_name'),
      supabase.from('email_marketing_contacts').select('id,email,contact_name,company_name,source,status,consent_confirmed,unsubscribed_at').eq('organization_id', organization.id).order('email'),
      supabase.from('email_campaigns').select('id,name,subject,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at').eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(30)
    ])""" + s[end:]

replace_one(
    "    if (clientsResult.error) setMessage(`Não foi possível carregar os clientes: ${clientsResult.error.message}`)\n    if (campaignResult.error) setMessage(`Não foi possível carregar as campanhas: ${campaignResult.error.message}`)",
    "    if (clientsResult.error) setMessage(`Não foi possível carregar os clientes: ${clientsResult.error.message}`)\n    if (marketingResult.error) setMessage(`Não foi possível carregar a lista de e-mail marketing: ${marketingResult.error.message}`)\n    if (campaignResult.error) setMessage(`Não foi possível carregar as campanhas: ${campaignResult.error.message}`)",
    'load errors'
)

replace_one(
    "    setClients(clientsResult.data || [])\n    setCampaigns(campaignResult.data || [])",
    "    setClients(clientsResult.data || [])\n    setMarketingContacts(marketingResult.data || [])\n    setCampaigns(campaignResult.data || [])",
    'load state'
)

start = s.index("  const eligibleClients = useMemo")
end = s.index("  const filesTotal =", start)
s = s[:start] + """  const eligibleClients = useMemo(() => clients.filter(c => validEmail(c.email) && !c.email_marketing_opt_out), [clients])
  const unavailableCount = clients.length - eligibleClients.length
  const eligibleMarketingContacts = useMemo(
    () => marketingContacts.filter(c => validEmail(c.email) && c.status === 'active' && c.consent_confirmed),
    [marketingContacts]
  )
  const unavailableMarketingCount = marketingContacts.length - eligibleMarketingContacts.length
  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return eligibleClients
    return eligibleClients.filter(c => [c.business_name, c.contact_name, c.email, c.city, c.state].some(v => String(v || '').toLowerCase().includes(q)))
  }, [eligibleClients, search])
  const filteredMarketingContacts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return eligibleMarketingContacts
    return eligibleMarketingContacts.filter(c => [c.company_name, c.contact_name, c.email, c.source].some(v => String(v || '').toLowerCase().includes(q)))
  }, [eligibleMarketingContacts, search])

  const selectedClients = useMemo(() => eligibleClients.filter(c => selected.has(c.id)), [eligibleClients, selected])
  const selectedMarketingContacts = useMemo(() => eligibleMarketingContacts.filter(c => selectedMarketing.has(c.id)), [eligibleMarketingContacts, selectedMarketing])
  const selectedTotal = selectedClients.length + selectedMarketingContacts.length
""" + s[end:]

start = s.index("  function toggleClient(id) {")
end = s.index("  function chooseFiles(event) {", start)
s = s[:start] + """  function toggleClient(id) {
    setSelected(old => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleMarketingContact(id) {
    setSelectedMarketing(old => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setSelected(old => {
      const next = new Set(old)
      const allSelected = filteredClients.length > 0 && filteredClients.every(c => next.has(c.id))
      filteredClients.forEach(c => allSelected ? next.delete(c.id) : next.add(c.id))
      return next
    })
  }

  function toggleAllFilteredMarketing() {
    setSelectedMarketing(old => {
      const next = new Set(old)
      const allSelected = filteredMarketingContacts.length > 0 && filteredMarketingContacts.every(c => next.has(c.id))
      filteredMarketingContacts.forEach(c => allSelected ? next.delete(c.id) : next.add(c.id))
      return next
    })
  }

""" + s[end:]

replace_one(
    "    if (!selectedClients.length) return setMessage('Selecione pelo menos um cliente da base de Clientes.')",
    "    if (!selectedTotal) return setMessage('Selecione pelo menos um destinatário entre Clientes do CRM ou Lista de E-mail Marketing.')",
    'campaign selection validation'
)

rpc_start = s.index("      const { data, error } = await supabase.rpc('create_email_campaign', {")
rpc_end = s.index("      if (error) throw error", rpc_start) + len("      if (error) throw error")
s = s[:rpc_start] + """      const { data, error } = await supabase.rpc('create_email_campaign_v2', {
        p_organization_id: organization.id,
        p_name: form.name.trim(),
        p_subject: form.subject.trim(),
        p_body_text: form.body,
        p_client_ids: selectedClients.map(c => c.id),
        p_marketing_contact_ids: selectedMarketingContacts.map(c => c.id)
      })
      if (error) throw error""" + s[rpc_end:]

replace_one(
    "      setSelected(new Set())\n      setFiles([])\n      setMessage(`Campanha criada para ${selectedClients.length} cliente${selectedClients.length === 1 ? '' : 's'}. Os envios respeitarão o limite diário definido pelo administrador.`)",
    "      setSelected(new Set())\n      setSelectedMarketing(new Set())\n      setFiles([])\n      setMessage('Campanha criada e colocada na fila. E-mails duplicados entre as duas bases são enviados apenas uma vez.')",
    'campaign reset'
)

replace_one(
    "          <p className=\"muted\">Campanhas enviadas exclusivamente para a base de Clientes. Leads do Funil não aparecem como destinatários.</p>",
    "          <p className=\"muted\">Envie para Clientes do CRM e para listas próprias de e-mail marketing. Leads frios do Funil não são usados como destinatários.</p>",
    'page description'
)

replace_one(
    "          <span className=\"email-client-only-badge\">Somente Clientes</span>",
    "          <span className=\"email-client-only-badge\">Clientes + Lista própria</span>",
    'compose badge'
)

recipient_start = s.index('        <div className="email-recipient-box">')
recipient_end = s.index('\n\n        <div className="form-actions">', recipient_start)
recipient_block = """        <div className=\"email-recipient-box\">
          <div className=\"email-recipient-head\">
            <div>
              <strong>Destinatários autorizados</strong>
              <span>{eligibleClients.length} cliente{eligibleClients.length === 1 ? '' : 's'} do CRM • {eligibleMarketingContacts.length} contato{eligibleMarketingContacts.length === 1 ? '' : 's'} em listas próprias</span>
            </div>
            <strong>{selectedTotal} selecionado{selectedTotal === 1 ? '' : 's'}</strong>
          </div>

          <MarketingListImport organization={organization} onImported={loadData} />

          <div className=\"email-recipient-tools\">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder=\"Buscar cliente, contato, empresa, origem ou e-mail\" />
          </div>

          <div className=\"email-recipient-source\">
            <div className=\"email-recipient-source-head\">
              <div><strong>Clientes do CRM</strong><span>{eligibleClients.length} disponível{eligibleClients.length === 1 ? '' : 'is'} • {unavailableCount} indisponível{unavailableCount === 1 ? '' : 'is'}</span></div>
              <button type=\"button\" className=\"secondary\" onClick={toggleAllFiltered}>{filteredClients.length && filteredClients.every(c => selected.has(c.id)) ? 'Desmarcar exibidos' : 'Selecionar exibidos'}</button>
            </div>
            <div className=\"email-recipient-list\">
              {filteredClients.length === 0 ? <p className=\"muted email-empty-list\">Nenhum cliente elegível encontrado.</p> : filteredClients.map(client => (
                <label className=\"email-recipient-row\" key={client.id}>
                  <input type=\"checkbox\" checked={selected.has(client.id)} onChange={() => toggleClient(client.id)} />
                  <span><strong>{client.business_name}</strong><small>{client.contact_name || 'Contato não informado'} • {client.email}{client.city ? ` • ${client.city}${client.state ? `/${client.state}` : ''}` : ''}</small></span>
                </label>
              ))}
            </div>
          </div>

          <div className=\"email-recipient-source\">
            <div className=\"email-recipient-source-head\">
              <div><strong>Lista de E-mail Marketing</strong><span>{eligibleMarketingContacts.length} disponível{eligibleMarketingContacts.length === 1 ? '' : 'is'} • {unavailableMarketingCount} indisponível{unavailableMarketingCount === 1 ? '' : 'is'}</span></div>
              <button type=\"button\" className=\"secondary\" onClick={toggleAllFilteredMarketing}>{filteredMarketingContacts.length && filteredMarketingContacts.every(c => selectedMarketing.has(c.id)) ? 'Desmarcar exibidos' : 'Selecionar exibidos'}</button>
            </div>
            <div className=\"email-recipient-list\">
              {filteredMarketingContacts.length === 0 ? <p className=\"muted email-empty-list\">Nenhum contato de lista elegível encontrado.</p> : filteredMarketingContacts.map(contact => (
                <label className=\"email-recipient-row\" key={contact.id}>
                  <input type=\"checkbox\" checked={selectedMarketing.has(contact.id)} onChange={() => toggleMarketingContact(contact.id)} />
                  <span><strong>{contact.company_name || contact.contact_name || contact.email}</strong><small>{contact.contact_name && contact.company_name ? `${contact.contact_name} • ` : ''}{contact.email}{contact.source ? ` • ${contact.source}` : ''}</small></span>
                </label>
              ))}
            </div>
          </div>

          <p className=\"muted email-compliance-note\">Leads do Funil continuam excluídos. Descadastros valem para as duas bases. Se o mesmo e-mail estiver nas duas, ele recebe apenas uma mensagem por campanha.</p>
        </div>"""
s = s[:recipient_start] + recipient_block + s[recipient_end:]

replace_one(
    "          <button className=\"primary\" disabled={loading || connection?.status !== 'connected' || selectedClients.length === 0}>{loading ? 'Processando...' : 'Criar campanha e iniciar fila'}</button>",
    "          <button className=\"primary\" disabled={loading || connection?.status !== 'connected' || selectedTotal === 0}>{loading ? 'Processando...' : 'Criar campanha e iniciar fila'}</button>",
    'campaign button'
)

APP.write_text(s, encoding='utf-8')

css = CSS.read_text(encoding='utf-8')
extra = """
.email-marketing-import-box{border:1px dashed #cbd5e1;border-radius:12px;padding:14px;background:#fff;display:grid;gap:12px}.email-marketing-import-head,.email-recipient-source-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.email-marketing-import-head>div,.email-recipient-source-head>div{display:grid;gap:3px}.email-marketing-import-head span,.email-recipient-source-head span,.email-marketing-import-summary span{font-size:12px;color:#64748b}.email-marketing-import-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end}.email-marketing-import-file{align-self:end;min-height:42px;align-items:center}.email-marketing-import-summary{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.email-marketing-confirm{display:flex!important;align-items:flex-start;gap:9px;margin:0!important;font-size:13px;line-height:1.45}.email-marketing-confirm input{margin-top:3px}.email-recipient-source{display:grid;gap:8px}.email-empty-list{padding:12px;margin:0}@media(max-width:700px){.email-marketing-import-head,.email-recipient-source-head{flex-direction:column}.email-marketing-import-grid{grid-template-columns:1fr}.email-marketing-import-file{width:100%}}
"""
if '.email-marketing-import-box' not in css:
    css = css.rstrip() + extra
CSS.write_text(css, encoding='utf-8')

print('V85 marketing list patch applied')
