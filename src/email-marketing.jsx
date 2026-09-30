import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import MarketingListImport from './marketing-list-import'
import NewsletterMailingPanel from './newsletter-mailing-panel'
import EmailCampaignHistory from './email-campaign-history'
import './email-marketing.css'

const BUCKET = 'email-campaign-attachments'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 15 * 1024 * 1024
const CAMPAIGN_PAGE_SIZE = 20

function providerLabel(provider) {
  if (provider === 'gmail') return 'Gmail'
  if (provider === 'resend') return 'Resend'
  return 'Não conectado'
}

function campaignStatusLabel(status) {
  return {
    draft: 'Rascunho', queued: 'Na fila', sending: 'Enviando', paused: 'Pausada',
    completed: 'Concluída', cancelled: 'Cancelada', failed: 'Falhou'
  }[status] || status
}

function bytesLabel(value) {
  const n = Number(value || 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function currentBrazilDate() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function cleanFilename(name) {
  return String(name || 'arquivo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(-120)
}

async function invokeEmailProvider(body) {
  const { data, error } = await supabase.functions.invoke('email-provider-oauth', { body })
  if (error) {
    let message = error.message || 'Não foi possível concluir.'
    try {
      const context = error.context
      if (context?.json) {
        const payload = await context.json()
        if (payload?.error) message = payload.error
      }
    } catch {}
    throw new Error(data?.error || message)
  }
  if (data?.error) throw new Error(data.error)
  return data || {}
}


function EmailProspectingSequence({ organization, connection }) {
  const [leads, setLeads] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [form, setForm] = useState({ name: '', subject: '', first: '', followup1: '', followup2: '' })
  const [basisConfirmed, setBasisConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [prospectingState, setProspectingState] = useState({})
  const [manualEmail, setManualEmail] = useState('')

  async function loadProspects() {
    if (!organization?.id) return
    const [leadsResult, sequenceResult] = await Promise.all([
      supabase
        .from('leads')
        .select('id,business_name,contact_name,email,website,city,state,status,email_marketing_opt_out')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .order('business_name'),
      supabase
        .from('email_campaign_recipients')
        .select('lead_id,status,sequence_step,next_attempt_at,replied_at,sent_at,created_at')
        .eq('organization_id', organization.id)
        .eq('recipient_source', 'crm_prospecting')
        .not('lead_id', 'is', null)
        .order('created_at', { ascending: false })
    ])

    if (leadsResult.error) setMessage(leadsResult.error.message)
    else setLeads((leadsResult.data || []).filter(item => validEmail(item.email)))

    if (!sequenceResult.error) {
      const latestByLead = {}
      for (const row of sequenceResult.data || []) {
        if (row.lead_id && !latestByLead[row.lead_id]) latestByLead[row.lead_id] = row
      }
      setProspectingState(latestByLead)
    }
  }

  function prospectingLabel(leadId) {
    const row = prospectingState[leadId]
    if (!row) return 'Não iniciado'
    if (row.replied_at || row.status === 'replied') return 'Respondeu'
    if (row.status === 'failed') return 'Falhou'
    if (row.status === 'sent' && Number(row.sequence_step || 0) >= 3) return 'D8 enviado'
    if (Number(row.sequence_step || 0) >= 3) return 'D4 enviado'
    if (Number(row.sequence_step || 0) >= 2) return 'D1 enviado'
    return 'D1 agendado'
  }

  function nextProspectingSend(leadId) {
    const row = prospectingState[leadId]
    if (!row?.next_attempt_at || row.replied_at || row.status === 'replied' || row.status === 'sent' || row.status === 'failed') return '—'
    return new Date(row.next_attempt_at).toLocaleString('pt-BR')
  }

  useEffect(() => {
    setSelected(new Set())
    setMessage('')
    loadProspects()
  }, [organization?.id])

  function toggle(id, checked) {
    const lead = leads.find(item => item.id === id)
    if (lead?.email_marketing_opt_out) return
    setSelected(current => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function addManualProspect() {
    const email = manualEmail.trim().toLowerCase()
    if (!validEmail(email)) return setMessage('Informe um e-mail válido.')
    setLoading(true); setMessage('')
    try {
      const { data, error } = await supabase.rpc('add_manual_email_prospect', {
        p_organization_id: organization.id,
        p_email: email,
        p_contact_name: null,
        p_business_name: null
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (row?.lead_id) {
        setSelected(current => {
          const next = new Set(current)
          next.add(row.lead_id)
          return next
        })
      }
      setManualEmail('')
      setMessage(row?.created ? 'E-mail adicionado à base e selecionado para prospecção.' : 'Este e-mail já estava na base e foi selecionado.')
      await loadProspects()
    } catch (error) {
      setMessage(error.message || 'Não foi possível adicionar o e-mail.')
    } finally {
      setLoading(false)
    }
  }

  async function authorizeProspecting() {
    sessionStorage.setItem('crm_campaign_workspace_section', 'email-prospecting')
    setLoading(true); setMessage('')
    try {
      const { data, error } = await supabase.functions.invoke('email-prospecting-oauth', {
        body: { organization_id: organization.id, return_url: window.location.origin }
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      if (!data?.authorization_url) throw new Error('O Google não retornou a autorização.')
      window.location.href = data.authorization_url
    } catch (error) {
      setMessage(error.message || 'Não foi possível iniciar a autorização do Gmail.')
      setLoading(false)
    }
  }

  async function startSequence(event) {
    event.preventDefault()
    if (connection?.status !== 'connected' || !['gmail', 'resend'].includes(connection?.provider)) return setMessage('Conecte uma conta Gmail ou Resend antes de iniciar a prospecção.')
    if (!basisConfirmed) return setMessage('Confirme a base legítima e a relevância comercial dos destinatários.')
    if (!selected.size) return setMessage('Selecione pelo menos um lead com e-mail.')
    if (!form.name.trim() || !form.subject.trim() || !form.first.trim() || !form.followup1.trim() || !form.followup2.trim()) return setMessage('Preencha o nome, assunto e as três mensagens da sequência.')

    setLoading(true); setMessage('')
    try {
      const { data, error } = await supabase.rpc('create_email_prospecting_sequence', {
        p_organization_id: organization.id,
        p_name: form.name.trim(),
        p_subject: form.subject.trim(),
        p_body_text: form.first,
        p_followup1_body: form.followup1,
        p_followup2_body: form.followup2,
        p_lead_ids: [...selected]
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      setMessage(`Sequência iniciada para ${row?.recipient_count || selected.size} lead(s). D1 agora, D4 em 3 dias e D8 em 7 dias, salvo se houver resposta.`)
      setSelected(new Set())
      setForm({ name: '', subject: '', first: '', followup1: '', followup2: '' })
      setBasisConfirmed(false)
      await loadProspects()
    } catch (error) {
      setMessage(error.message || 'Não foi possível iniciar a sequência.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel email-prospecting-panel">
      <div className="email-section-title">
        <div>
          <span className="eyebrow">PROSPECÇÃO POR E-MAIL</span>
          <h2>Sequência automática D1 · D4 · D8</h2>
          <p className="muted">Primeiro contato no Dia 1, follow-up no Dia 4 e último contato no Dia 8. Se o lead responder, os próximos envios são cancelados e ele vai para Respondeu.</p>
        </div>
        {connection?.provider === 'gmail' && (
          <button type="button" className="secondary" onClick={authorizeProspecting} disabled={loading}>
            Autorizar leitura de respostas do Gmail
          </button>
        )}
        {connection?.provider === 'resend' && <span className="email-connected-badge">Respostas monitoradas pelo Resend</span>}
      </div>

      {connection?.status !== 'connected' && (
        <div className="notice">Conecte uma conta Gmail ou Resend para usar a sequência automática.</div>
      )}
      {connection?.provider === 'resend' && (
        <div className="notice">As respostas desta prospecção serão identificadas automaticamente pelo CRM e interromperão os próximos follow-ups.</div>
      )}
      {message && <div className="notice">{message}</div>}

      <form onSubmit={startSequence}>
        <div className="field-grid two">
          <label>Nome da sequência<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Prospecção contabilidades Campinas" /></label>
          <label>Assunto<input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Assunto do e-mail" /></label>
        </div>
        <div className="field-grid three">
          <label>Dia 1 — primeiro contato<textarea rows="6" value={form.first} onChange={e => setForm({ ...form, first: e.target.value })} /></label>
          <label>Dia 4 — follow-up<textarea rows="6" value={form.followup1} onChange={e => setForm({ ...form, followup1: e.target.value })} /></label>
          <label>Dia 8 — último contato<textarea rows="6" value={form.followup2} onChange={e => setForm({ ...form, followup2: e.target.value })} /></label>
        </div>

        <div className="email-manual-prospect-add">
          <div>
            <strong>Adicionar e-mail manualmente</strong>
            <span>Use quando o contato ainda não estiver na base. Se já existir, o CRM reaproveita o mesmo cadastro.</span>
          </div>
          <div className="email-manual-prospect-actions">
            <input type="email" value={manualEmail} onChange={e => setManualEmail(e.target.value)} placeholder="nome@empresa.com.br" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManualProspect() } }} />
            <button type="button" className="secondary" onClick={addManualProspect} disabled={loading || !manualEmail.trim()}>Adicionar e-mail</button>
          </div>
        </div>

        <div className="email-prospect-list">
          <div className="panel-head">
            <div><h3>Contatos do CRM</h3><p className="muted">A mesma base pode ser usada aqui e em E-mail marketing. Quem cancelou o recebimento permanece bloqueado para envio.</p></div>
            <strong>{selected.size} selecionado(s)</strong>
          </div>
          {leads.length === 0 ? (
            <p className="muted">Nenhum lead elegível com e-mail no momento.</p>
          ) : leads.map(lead => (
            <label className={`email-prospect-row ${lead.email_marketing_opt_out ? 'disabled' : ''}`} key={lead.id}>
              <input type="checkbox" disabled={Boolean(lead.email_marketing_opt_out)} checked={selected.has(lead.id)} onChange={e => toggle(lead.id, e.target.checked)} />
              <span><strong>{lead.business_name}</strong><small>{lead.email}{lead.city ? ` • ${lead.city}${lead.state ? `/${lead.state}` : ''}` : ''}{lead.email_marketing_opt_out ? ' • Recebimento cancelado' : ''}</small></span>
              <span className="email-prospect-progress"><strong>{prospectingLabel(lead.id)}</strong><small>Próximo envio: {nextProspectingSend(lead.id)}</small></span>
              {lead.website && <a href={/^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>Site</a>}
            </label>
          ))}
        </div>

        <label className="email-consent-check">
          <input type="checkbox" checked={basisConfirmed} onChange={e => setBasisConfirmed(e.target.checked)} />
          Confirmo que estes contatos têm relação comercial plausível com esta prospecção, que a abordagem é relevante e que o cancelamento de recebimento será respeitado.
        </label>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={loading || connection?.status !== 'connected' || !['gmail', 'resend'].includes(connection?.provider)}>{loading ? 'Processando...' : 'Iniciar sequência'}</button>
        </div>
      </form>
    </section>
  )
}

export function EmailProspecting({ organization, userEmail }) {
  const [connection, setConnection] = useState(null)
  const [message, setMessage] = useState('')

  async function loadConnection() {
    if (!organization?.id) return
    const { data, error } = await supabase
      .from('email_connections')
      .select('organization_id,provider,email_address,sender_email,sender_name,status,last_error,connected_at')
      .eq('organization_id', organization.id)
      .maybeSingle()
    if (error) setMessage(`Não foi possível carregar a conta de e-mail: ${error.message}`)
    else setConnection(data || null)
  }

  useEffect(() => { loadConnection() }, [organization?.id])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauth = params.get('email_oauth')
    if (!oauth) return
    const provider = providerLabel(params.get('provider'))
    if (oauth === 'success') setMessage(`${provider} conectado com sucesso para prospecção.`)
    else setMessage(params.get('message') || `Não foi possível conectar ${provider}.`)
    params.delete('email_oauth'); params.delete('provider'); params.delete('message')
    const next = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash || ''}`)
    loadConnection()
  }, [])

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <h1>Prospecção por e-mail</h1>
          <p className="muted">Use a mesma base de contatos do CRM para iniciar e acompanhar abordagens comerciais por e-mail.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>
      <div className="email-purpose-note">
        <strong>Quando usar esta aba</strong>
        <span>Para primeiro contato comercial e follow-ups automáticos. O mesmo contato também pode ser usado em E-mail marketing.</span>
      </div>
      {message && <div className="notice">{message}</div>}
      <EmailProspectingSequence organization={organization} connection={connection} />
    </>
  )
}

export function EmailMarketing({ organization, userEmail }) {
  const [connection, setConnection] = useState(null)
  const [limits, setLimits] = useState(null)
  const [clients, setClients] = useState([])
  const [marketingContacts, setMarketingContacts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [campaignPage, setCampaignPage] = useState(0)
  const [campaignTotal, setCampaignTotal] = useState(0)
  const [campaignListLoading, setCampaignListLoading] = useState(false)
  const loadSequence = useRef(0)
  const [selected, setSelected] = useState(() => new Set())
  const [selectedMarketing, setSelectedMarketing] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [files, setFiles] = useState([])
  const [providerChoice, setProviderChoice] = useState('gmail')
  const [senderEmail, setSenderEmail] = useState('')
  const [senderName, setSenderName] = useState('')
  const [form, setForm] = useState({ name: '', subject: '', body: '' })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [draftCampaignId, setDraftCampaignId] = useState(null)
  const [commercialConsentConfirmed, setCommercialConsentConfirmed] = useState(false)

  async function loadData(nextCampaignPage = campaignPage) {
    if (!organization?.id) return
    const sequence = ++loadSequence.current
    setCampaignListLoading(true)
    const [connectionResult, limitResult, clientsResult, marketingResult, campaignResult] = await Promise.all([
      supabase.from('email_connections').select('organization_id,provider,email_address,sender_email,sender_name,status,last_error,connected_at').eq('organization_id', organization.id).maybeSingle(),
      supabase.from('organization_email_limits').select('*').eq('organization_id', organization.id).maybeSingle(),
      supabase.from('leads').select('id,business_name,contact_name,email,city,state,status,email_marketing_opt_out').eq('organization_id', organization.id).is('deleted_at', null).order('business_name'),
      supabase.from('email_marketing_contacts').select('id,email,contact_name,company_name,source,status,consent_confirmed,unsubscribed_at').eq('organization_id', organization.id).order('email'),
      supabase.from('email_campaigns').select('id,name,subject,body_text,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at,metrics_enabled', { count: 'exact' }).eq('organization_id', organization.id).order('created_at', { ascending: false }).order('id', { ascending: false }).range(nextCampaignPage * CAMPAIGN_PAGE_SIZE, (nextCampaignPage + 1) * CAMPAIGN_PAGE_SIZE - 1)
    ])
    if (sequence !== loadSequence.current) return
    setCampaignListLoading(false)

    if (connectionResult.error) setMessage(`Não foi possível carregar a conta de e-mail: ${connectionResult.error.message}`)
    if (limitResult.error) setMessage(`Não foi possível carregar o limite de envio: ${limitResult.error.message}`)
    if (clientsResult.error) setMessage(`Não foi possível carregar os clientes: ${clientsResult.error.message}`)
    if (marketingResult.error) setMessage(`Não foi possível carregar a lista de e-mail marketing: ${marketingResult.error.message}`)
    if (campaignResult.error) setMessage(`Não foi possível carregar as campanhas: ${campaignResult.error.message}`)

    setConnection(connectionResult.data || null)
    setLimits(limitResult.data || null)
    setClients(clientsResult.data || [])
    setMarketingContacts(marketingResult.data || [])
    if (!campaignResult.error) {
      setCampaigns(campaignResult.data || [])
      setCampaignTotal(campaignResult.count || 0)
    }
    if (connectionResult.data?.sender_email) setSenderEmail(connectionResult.data.sender_email)
    if (connectionResult.data?.sender_name) setSenderName(connectionResult.data.sender_name)
  }

  useEffect(() => {
    setCampaignPage(0)
    setCampaigns([])
    setCampaignTotal(0)
    setSelected(new Set())
    setSelectedMarketing(new Set())
    setDraftCampaignId(null)
    setCommercialConsentConfirmed(false)
    loadData(0)
    return () => { loadSequence.current += 1 }
  }, [organization?.id])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauth = params.get('email_oauth')
    if (!oauth) return
    const provider = providerLabel(params.get('provider'))
    if (oauth === 'success') setMessage(`${provider} conectado com sucesso.`)
    else setMessage(params.get('message') || `Não foi possível conectar ${provider}.`)
    params.delete('email_oauth'); params.delete('provider'); params.delete('message')
    const next = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash || ''}`)
    loadData()
  }, [])

  const eligibleClients = useMemo(() => clients.filter(c => validEmail(c.email) && !c.email_marketing_opt_out), [clients])
  const unavailableCount = clients.length - eligibleClients.length
  const eligibleMarketingContacts = useMemo(
    () => marketingContacts.filter(c => validEmail(c.email) && c.status === 'active' && c.consent_confirmed && !c.unsubscribed_at),
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
  const campaignPageCount = Math.ceil(campaignTotal / CAMPAIGN_PAGE_SIZE)
  const campaignPageNumbers = [...new Set([0, campaignPageCount - 1, ...Array.from({ length: 5 }, (_, i) => campaignPage + i - 2)])]
    .filter(page => page >= 0 && page < campaignPageCount).sort((a, b) => a - b)

  async function changeCampaignPage(nextPage) {
    if (nextPage < 0 || nextPage >= campaignPageCount || nextPage === campaignPage || campaignListLoading) return
    setCampaignPage(nextPage)
    await loadData(nextPage)
  }
  const filesTotal = files.reduce((sum, file) => sum + Number(file.size || 0), 0)
  const todayUsage = limits?.usage_date === currentBrazilDate() ? Number(limits?.sent_today || 0) : 0
  const dailyLimit = Number(limits?.daily_send_limit || 0)

  function toggleClient(id) {
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

  async function includeMarketingList() {
    if (!draftCampaignId) return setMessage('Salve a campanha antes de incluir a lista.')
    if (!eligibleMarketingContacts.length) return setMessage('Não há e-mails autorizados disponíveis para incluir.')
    setLoading(true)
    setMessage('')
    try {
      const { data, error } = await supabase.rpc('set_email_campaign_recipients', {
        p_campaign_id: draftCampaignId,
        p_client_ids: selectedClients.map(c => c.id),
        p_marketing_contact_ids: eligibleMarketingContacts.map(c => c.id)
      })
      if (error) throw error
      setSelectedMarketing(new Set(eligibleMarketingContacts.map(c => c.id)))
      setCommercialConsentConfirmed(false)
      setMessage(`${Number(data || 0)} destinatário(s) salvo(s) no rascunho. A lista foi incluída, mas o envio ainda não foi iniciado.`)
      await loadData()
    } catch (error) {
      setMessage(error.message || 'Não foi possível incluir a lista de e-mail marketing.')
    } finally {
      setLoading(false)
    }
  }

  function chooseFiles(event) {
    const incoming = Array.from(event.target.files || [])
    event.target.value = ''
    if (!incoming.length) return
    if (incoming.some(file => file.size > MAX_FILE_BYTES)) {
      setMessage('Cada anexo pode ter no máximo 10 MB.')
      return
    }
    const next = [...files, ...incoming]
    const total = next.reduce((sum, file) => sum + file.size, 0)
    if (total > MAX_TOTAL_BYTES) {
      setMessage('O total de anexos da campanha pode ter no máximo 15 MB.')
      return
    }
    setFiles(next)
  }

  async function connectProvider(provider) {
    setLoading(true); setMessage('')
    try {
      const payload = {
        action: 'start', organization_id: organization.id, provider,
        return_url: window.location.origin,
        sender_email: provider === 'resend' ? senderEmail.trim() : null,
        sender_name: provider === 'resend' ? senderName.trim() : null
      }
      const data = await invokeEmailProvider(payload)
      if (!data.authorization_url) throw new Error('O provedor não retornou a página de autorização.')
      window.location.assign(data.authorization_url)
    } catch (error) {
      setMessage(error.message || 'Não foi possível iniciar a conexão.')
      setLoading(false)
    }
  }

  async function disconnectProvider() {
    if (!window.confirm('Desconectar a conta de e-mail desta empresa? Campanhas já registradas serão preservadas.')) return
    setLoading(true); setMessage('')
    try {
      await invokeEmailProvider({ action: 'disconnect', organization_id: organization.id })
      setMessage('Conta desconectada.')
      await loadData()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function saveResendSender() {
    setLoading(true); setMessage('')
    try {
      await invokeEmailProvider({ action: 'update_sender', organization_id: organization.id, sender_email: senderEmail.trim(), sender_name: senderName.trim() })
      setMessage('Remetente atualizado.')
      await loadData()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleManualRecipientAdded(contact) {
    if (contact?.id) {
      setSelectedMarketing(old => {
        const next = new Set(old)
        next.add(contact.id)
        return next
      })
    }
    await loadData()
  }

  async function createCampaign(event) {
    event.preventDefault()
    if (draftCampaignId) return setMessage('Esta campanha já foi salva. Escolha os destinatários e depois inicie o envio.')
    if (connection?.status !== 'connected') return setMessage('Conecte uma conta Gmail ou Resend antes de criar uma campanha.')
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) return setMessage('Nome da campanha, assunto e mensagem são obrigatórios.')
    if (filesTotal > MAX_TOTAL_BYTES) return setMessage('O total de anexos excede 15 MB.')

    setLoading(true); setMessage('')
    let campaignId = null
    const uploaded = []
    try {
      const { data, error } = await supabase.rpc('create_email_campaign_v2', {
        p_organization_id: organization.id,
        p_name: form.name.trim(),
        p_subject: form.subject.trim(),
        p_body_text: form.body,
        p_client_ids: [],
        p_marketing_contact_ids: []
      })
      if (error) throw error
      campaignId = data

      for (const file of files) {
        const path = `${organization.id}/${campaignId}/${crypto.randomUUID()}-${cleanFilename(file.name)}`
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
        if (uploadError) throw uploadError
        uploaded.push(path)
        const { error: registerError } = await supabase.rpc('register_email_campaign_attachment', {
          p_campaign_id: campaignId,
          p_storage_path: path,
          p_file_name: file.name,
          p_mime_type: file.type || 'application/octet-stream',
          p_size_bytes: file.size
        })
        if (registerError) throw registerError
      }

      setDraftCampaignId(campaignId)
      setSelected(new Set())
      setSelectedMarketing(new Set())
      setFiles([])
      setMessage('Campanha salva como rascunho. Agora escolha os destinatários e, quando estiver pronto, inicie o envio.')
      setCampaignPage(0)
      await loadData(0)
    } catch (error) {
      if (campaignId) {
        try { await supabase.rpc('cancel_email_campaign', { p_campaign_id: campaignId }) } catch {}
      }
      if (uploaded.length) {
        try { await supabase.storage.from(BUCKET).remove(uploaded) } catch {}
      }
      setMessage(error.message || 'Não foi possível salvar a campanha.')
    } finally {
      setLoading(false)
    }
  }

  async function saveRecipients(startSending = false) {
    if (!draftCampaignId) return setMessage('Salve a campanha antes de escolher os destinatários.')
    if (!selectedTotal) return setMessage('Selecione pelo menos um destinatário.')
    if (startSending && !commercialConsentConfirmed) return setMessage('Confirme a autorização dos destinatários antes de iniciar o envio.')
    setLoading(true); setMessage('')
    try {
      const { data, error } = await supabase.rpc('set_email_campaign_recipients', {
        p_campaign_id: draftCampaignId,
        p_client_ids: selectedClients.map(c => c.id),
        p_marketing_contact_ids: selectedMarketingContacts.map(c => c.id)
      })
      if (error) throw error
      const savedCount = Number(data || 0)
      if (startSending) {
        const { error: consentError } = await supabase.rpc('confirm_email_campaign_compliance', { p_campaign_id: draftCampaignId })
        if (consentError) throw consentError
        const { error: queueError } = await supabase.rpc('queue_email_campaign', { p_campaign_id: draftCampaignId })
        if (queueError) throw queueError
        setMessage(`Campanha iniciada com ${savedCount} destinatário${savedCount === 1 ? '' : 's'}.`)
        setDraftCampaignId(null)
        setForm({ name: '', subject: '', body: '' })
        setSelected(new Set())
        setSelectedMarketing(new Set())
        setCommercialConsentConfirmed(false)
      } else {
        setCommercialConsentConfirmed(false)
        setMessage(`${savedCount} destinatário${savedCount === 1 ? '' : 's'} salvo${savedCount === 1 ? '' : 's'} no rascunho.`)
      }
      await loadData()
    } catch (error) {
      setMessage(error.message || 'Não foi possível salvar os destinatários.')
    } finally {
      setLoading(false)
    }
  }

  async function continueDraft(campaign) {
    setLoading(true); setMessage('')
    try {
      const { data, error } = await supabase
        .from('email_campaign_recipients')
        .select('lead_id,marketing_contact_id')
        .eq('campaign_id', campaign.id)
        .eq('status', 'draft')
      if (error) throw error
      setDraftCampaignId(campaign.id)
      setForm({ name: campaign.name || '', subject: campaign.subject || '', body: campaign.body_text || '' })
      setSelected(new Set((data || []).map(r => r.lead_id).filter(Boolean)))
      setSelectedMarketing(new Set((data || []).map(r => r.marketing_contact_id).filter(Boolean)))
      setCommercialConsentConfirmed(false)
      setFiles([])
      setMessage('Rascunho aberto. Revise ou escolha os destinatários e inicie o envio quando estiver pronto.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setMessage(error.message || 'Não foi possível abrir o rascunho.')
    } finally {
      setLoading(false)
    }
  }

  async function resendCampaign(campaign) {
    if (draftCampaignId) {
      setMessage('Finalize o rascunho atualmente aberto antes de preparar outro reenvio.')
      return
    }
    if (!window.confirm('Criar um novo rascunho desta campanha para revisar os destinatários antes de reenviar?')) return
    setLoading(true); setMessage('')
    try {
      const { data: newCampaignId, error } = await supabase.rpc('clone_email_campaign_for_resend', { p_campaign_id: campaign.id })
      if (error) throw error
      const { data: draft, error: draftError } = await supabase
        .from('email_campaigns')
        .select('id,name,subject,body_text,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at,source_campaign_id')
        .eq('id', newCampaignId)
        .single()
      if (draftError) throw draftError
      await continueDraft(draft)
      await loadData()
      setMessage('Reenvio preparado como rascunho. Revise os destinatários e clique em Iniciar envio quando estiver pronto. Os anexos da campanha original serão mantidos.')
    } catch (error) {
      setMessage(error.message || 'Não foi possível preparar o reenvio desta campanha.')
    } finally {
      setLoading(false)
    }
  }

  async function cancelCampaign(id) {
    if (!window.confirm('Cancelar os envios ainda pendentes desta campanha?')) return
    setLoading(true); setMessage('')
    const { error } = await supabase.rpc('cancel_email_campaign', { p_campaign_id: id })
    if (error) setMessage(error.message)
    else setMessage('Campanha cancelada. E-mails já enviados não são afetados.')
    await loadData()
    setLoading(false)
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          
          <h1>E-mail Marketing</h1>
          <p className="muted">Envie campanhas e comunicados para contatos do CRM e para suas listas próprias.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <div className="email-purpose-note">
        <strong>Quando usar esta aba</strong>
        <span>Para campanhas, novidades, conteúdos e comunicados. Um contato usado em Prospecção por e-mail também pode ser selecionado aqui.</span>
      </div>
      {message && <div className="notice">{message}</div>}

      <section className="panel email-connection-panel">
        <div className="email-section-title">
          <div><span className="eyebrow">CONTA DE ENVIO</span><h2>Escolha como enviar</h2></div>
          {connection?.status === 'connected' && <span className="email-connected-badge">Conectado</span>}
        </div>

        {connection?.status === 'connected' ? (
          <div className="email-connected-grid">
            <div><span>Provedor</span><strong>{providerLabel(connection.provider)}</strong></div>
            <div><span>Remetente</span><strong>{connection.sender_email || connection.email_address}</strong></div>
            <div><span>Limite diário AXIVA</span><strong>{todayUsage} / {dailyLimit || '—'}</strong></div>
            <div><span>Fila</span><strong>{limits?.sending_paused ? 'Pausada pelo administrador' : 'Ativa'}</strong></div>
          </div>
        ) : (
          <div className="email-provider-grid">
            <article className={`email-provider-card ${providerChoice === 'gmail' ? 'selected' : ''}`}>
              <button type="button" className="email-provider-select" onClick={() => setProviderChoice('gmail')}>
                <strong>Gmail</strong><span>Conecte sua conta Google. Recomendado para volumes menores.</span>
              </button>
              <button type="button" className="primary" disabled={loading} onClick={() => connectProvider('gmail')}>Conectar Gmail</button>
            </article>
            <article className={`email-provider-card ${providerChoice === 'resend' ? 'selected' : ''}`}>
              <button type="button" className="email-provider-select" onClick={() => setProviderChoice('resend')}>
                <strong>Resend</strong><span>Use um domínio próprio verificado para campanhas profissionais.</span>
              </button>
              <label>Nome do remetente<input value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Ex.: AXIVA" /></label>
              <label>E-mail remetente<input type="email" value={senderEmail} onChange={e => setSenderEmail(e.target.value)} placeholder="contato@empresa.com.br" /></label>
              <button type="button" className="primary" disabled={loading} onClick={() => connectProvider('resend')}>Conectar Resend</button>
            </article>
          </div>
        )}

        {connection?.status === 'connected' && (
          <div className="form-actions email-connection-actions">
            {connection.provider === 'resend' && (
              <>
                <input value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Nome do remetente" />
                <input type="email" value={senderEmail} onChange={e => setSenderEmail(e.target.value)} placeholder="remetente@empresa.com.br" />
                <button type="button" className="secondary" onClick={saveResendSender} disabled={loading}>Salvar remetente</button>
              </>
            )}
            <button type="button" className="secondary" onClick={disconnectProvider} disabled={loading}>Desconectar conta</button>
          </div>
        )}
        {connection?.status === 'error' && <div className="notice error">A conexão precisa de atenção: {connection.last_error || 'reconecte a conta.'}</div>}
      </section>

      <NewsletterMailingPanel organization={organization} onChanged={loadData} />

      <form className="panel email-compose-panel" onSubmit={createCampaign}>
        <div className="email-section-title">
          <div><span className="eyebrow">NOVA CAMPANHA</span><h2>Criar e-mail</h2></div>
          <span className="email-client-only-badge">Contatos do CRM + Lista própria</span>
        </div>

        <div className="field-grid">
          <label>Nome da campanha<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Novidades de setembro" required /></label>
          <label>Assunto<input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Assunto do e-mail" required /></label>
        </div>
        <label>Mensagem<textarea className="email-body-textarea" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="Escreva a mensagem da campanha..." required /></label>

        <div className="email-attachments-box">
          <div><strong>Anexos</strong><span>Até 10 MB por arquivo e 15 MB no total.</span></div>
          <label className="secondary email-file-button">Anexar arquivo<input type="file" multiple onChange={chooseFiles} /></label>
          {files.length > 0 && (
            <div className="email-file-list">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`}><span>{file.name} • {bytesLabel(file.size)}</span><button type="button" onClick={() => setFiles(old => old.filter((_, i) => i !== index))}>Remover</button></div>
              ))}
              <strong>Total: {bytesLabel(filesTotal)}</strong>
            </div>
          )}
        </div>

        {draftCampaignId && (
        <div className="email-recipient-box">
          <div className="email-recipient-head">
            <div>
              <strong>Destinatários autorizados</strong>
              <span>{eligibleClients.length} contato{eligibleClients.length === 1 ? '' : 's'} do CRM • {eligibleMarketingContacts.length} contato{eligibleMarketingContacts.length === 1 ? '' : 's'} em listas próprias</span>
            </div>
            <strong>{selectedTotal} selecionado{selectedTotal === 1 ? '' : 's'}</strong>
          </div>

          <MarketingListImport organization={organization} mode="manual" onManualAdded={handleManualRecipientAdded} />

          <div className="email-recipient-tools">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, contato, empresa, origem ou e-mail" />
          </div>

          <div className="email-recipient-source">
            <div className="email-recipient-source-head">
              <div><strong>Lista de E-mail Marketing</strong><span>{eligibleMarketingContacts.length} disponível{eligibleMarketingContacts.length === 1 ? '' : 'is'} • {unavailableMarketingCount} indisponível{unavailableMarketingCount === 1 ? '' : 'is'}</span></div>
              <div className="mailing-source-actions">
                <button type="button" className="primary" disabled={loading || eligibleMarketingContacts.length === 0} onClick={includeMarketingList}>Incluir lista de e-mail mkt</button>
                <button type="button" className="secondary" onClick={toggleAllFilteredMarketing}>{filteredMarketingContacts.length && filteredMarketingContacts.every(c => selectedMarketing.has(c.id)) ? 'Desmarcar exibidos' : 'Selecionar exibidos'}</button>
              </div>
            </div>
            <div className="email-recipient-list">
              {filteredMarketingContacts.length === 0 ? <p className="muted email-empty-list">Nenhum contato de lista elegível encontrado.</p> : filteredMarketingContacts.map(contact => (
                <label className="email-recipient-row" key={contact.id}>
                  <input type="checkbox" checked={selectedMarketing.has(contact.id)} onChange={() => toggleMarketingContact(contact.id)} />
                  <span><strong>{contact.company_name || contact.contact_name || contact.email}</strong><small>{contact.contact_name && contact.company_name ? `${contact.contact_name} • ` : ''}{contact.email}{contact.source ? ` • ${contact.source}` : ''}</small></span>
                </label>
              ))}
            </div>
          </div>

          <div className="email-recipient-source">
            <div className="email-recipient-source-head">
              <div><strong>Contatos do CRM</strong><span>{eligibleClients.length} disponível{eligibleClients.length === 1 ? '' : 'is'} • {unavailableCount} indisponível{unavailableCount === 1 ? '' : 'is'}</span></div>
              <button type="button" className="secondary" onClick={toggleAllFiltered}>{filteredClients.length && filteredClients.every(c => selected.has(c.id)) ? 'Desmarcar exibidos' : 'Selecionar exibidos'}</button>
            </div>
            <div className="email-recipient-list">
              {filteredClients.length === 0 ? <p className="muted email-empty-list">Nenhum contato elegível encontrado.</p> : filteredClients.map(client => (
                <label className="email-recipient-row" key={client.id}>
                  <input type="checkbox" checked={selected.has(client.id)} onChange={() => toggleClient(client.id)} />
                  <span><strong>{client.business_name}</strong><small>{client.contact_name || 'Contato não informado'} • {client.email}{client.city ? ` • ${client.city}${client.state ? `/${client.state}` : ''}` : ''}</small></span>
                </label>
              ))}
            </div>
          </div>

        </div>

        )}

        {draftCampaignId && (
          <label className="email-recipient-row">
            <input type="checkbox" checked={commercialConsentConfirmed} onChange={e => setCommercialConsentConfirmed(e.target.checked)} />
            <span><strong>Confirmação obrigatória antes do envio</strong><small>Confirmo que este envio não é para prospecção não solicitada e que os destinatários selecionados já fazem parte da base autorizada da empresa para receber comunicações comerciais.</small></span>
          </label>
        )}

        <div className="form-actions email-draft-actions">
          {!draftCampaignId ? (
            <>
              <button className="primary" disabled={loading || connection?.status !== 'connected'}>{loading ? 'Salvando...' : 'Salvar campanha'}</button>
              <span className="muted">Depois de salvar, você escolherá os destinatários antes de iniciar o envio.</span>
            </>
          ) : (
            <>
              <button type="button" className="secondary" disabled={loading || selectedTotal === 0} onClick={() => saveRecipients(false)}>Salvar destinatários</button>
              <button type="button" className="primary" disabled={loading || selectedTotal === 0 || !commercialConsentConfirmed} onClick={() => saveRecipients(true)}>{loading ? 'Processando...' : 'Iniciar envio'}</button>
              <span className="muted">{selectedTotal} destinatário{selectedTotal === 1 ? '' : 's'} selecionado{selectedTotal === 1 ? '' : 's'}.</span>
            </>
          )}
        </div>
      </form>

      <section className="panel email-history-panel">
        <div className="email-section-title"><div><span className="eyebrow">HISTÓRICO</span><h2>Campanhas de e-mail</h2></div><button type="button" className="secondary" onClick={() => loadData()}>Atualizar</button></div>
        {campaigns.length === 0 ? <p className="muted">Nenhuma campanha de e-mail criada.</p> : (
          <div className="email-campaign-list">
            {campaigns.map(campaign => (
              <EmailCampaignHistory
                key={campaign.id}
                campaign={campaign}
                organizationId={organization.id}
                busy={loading}
                onContinue={continueDraft}
                onCancel={cancelCampaign}
                onResend={resendCampaign}
              />
            ))}
          </div>
        )}
        {campaignTotal > 0 && <p className="muted email-history-count">Exibindo {campaigns.length} de {campaignTotal} campanha{campaignTotal === 1 ? '' : 's'}.</p>}
        {campaignPageCount > 1 && (
          <nav className="email-history-pages" aria-label="Páginas do histórico de campanhas">
            <button type="button" className="secondary" disabled={campaignListLoading || campaignPage === 0} onClick={() => changeCampaignPage(campaignPage - 1)}>Anterior</button>
            {campaignPageNumbers.map((page, index) => <React.Fragment key={page}>
              {index > 0 && page - campaignPageNumbers[index - 1] > 1 && <span aria-hidden="true">…</span>}
              <button type="button" className="secondary" aria-label={`Página ${page + 1}`} aria-current={page === campaignPage ? 'page' : undefined} disabled={campaignListLoading} onClick={() => changeCampaignPage(page)}>{page + 1}</button>
            </React.Fragment>)}
            <button type="button" className="secondary" disabled={campaignListLoading || campaignPage >= campaignPageCount - 1} onClick={() => changeCampaignPage(campaignPage + 1)}>Próxima</button>
          </nav>
        )}
      </section>
    </>
  )
}

export function AdminEmailMarketing({ organizations, userEmail }) {
  const [limits, setLimits] = useState({})
  const [connections, setConnections] = useState({})
  const [drafts, setDrafts] = useState({})
  const [platform, setPlatform] = useState(null)
  const [googleForm, setGoogleForm] = useState({ client_id: '', client_secret: '' })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function loadData() {
    const ids = (organizations || []).map(o => o.id)
    if (!ids.length) return
    const [limitResult, connectionResult] = await Promise.all([
      supabase.from('organization_email_limits').select('*').in('organization_id', ids),
      supabase.from('email_connections').select('organization_id,provider,email_address,sender_email,status,last_error,connected_at').in('organization_id', ids)
    ])
    const lm = Object.fromEntries((limitResult.data || []).map(row => [row.organization_id, row]))
    const cm = Object.fromEntries((connectionResult.data || []).map(row => [row.organization_id, row]))
    setLimits(lm); setConnections(cm)
    setDrafts(Object.fromEntries(ids.map(id => [id, {
      daily_send_limit: lm[id]?.daily_send_limit ?? 100,
      send_interval_seconds: lm[id]?.send_interval_seconds ?? 60,
      sending_paused: Boolean(lm[id]?.sending_paused)
    }])))
    try {
      const data = await invokeEmailProvider({ action: 'platform_status' })
      setPlatform(data)
      if (data.google_client_id) setGoogleForm(old => ({ ...old, client_id: data.google_client_id }))
    } catch (error) {
      setMessage(error.message)
    }
  }

  useEffect(() => { loadData() }, [organizations?.map(o => o.id).join(',')])

  async function saveLimit(orgId) {
    const row = drafts[orgId]
    if (!row) return
    setLoading(true); setMessage('')
    const { error } = await supabase.from('organization_email_limits').update({
      daily_send_limit: Math.max(0, Number(row.daily_send_limit || 0)),
      send_interval_seconds: Math.max(0, Number(row.send_interval_seconds || 0)),
      sending_paused: Boolean(row.sending_paused), updated_at: new Date().toISOString()
    }).eq('organization_id', orgId)
    if (error) setMessage(error.message)
    else setMessage('Limite de e-mail atualizado.')
    await loadData(); setLoading(false)
  }

  async function configureGoogle(event) {
    event.preventDefault()
    setLoading(true); setMessage('')
    try {
      const data = await invokeEmailProvider({ action: 'configure_google', client_id: googleForm.client_id.trim(), client_secret: googleForm.client_secret.trim() })
      setMessage(`Integração Gmail configurada. Cadastre esta URI de redirecionamento no Google: ${data.google_redirect_uri}`)
      setGoogleForm(old => ({ ...old, client_secret: '' }))
      await loadData()
    } catch (error) {
      setMessage(error.message)
    } finally { setLoading(false) }
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div><span className="eyebrow">ADMINISTRAÇÃO</span><h1>E-mail Marketing</h1><p className="muted">Controle de limites por empresa e configuração dos provedores de envio.</p></div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>
      {message && <div className="notice">{message}</div>}

      <section className="panel">
        <div className="email-section-title"><div><span className="eyebrow">PROVEDORES</span><h2>Configuração da plataforma</h2></div></div>
        <div className="email-admin-provider-grid">
          <article className="email-provider-card">
            <strong>Resend</strong>
            <p className="muted">OAuth com PKCE e Client ID Metadata Document. Não exige API Key do cliente.</p>
            <span className="email-connected-badge">Pronto para conectar</span>
            {platform?.resend_redirect_uri && <small>Callback: {platform.resend_redirect_uri}</small>}
          </article>
          <form className="email-provider-card" onSubmit={configureGoogle}>
            <strong>Gmail / Google OAuth</strong>
            <p className="muted">Configuração única da plataforma. Depois disso, cada cliente usa apenas “Conectar Gmail”.</p>
            <label>Google Client ID<input value={googleForm.client_id} onChange={e => setGoogleForm({ ...googleForm, client_id: e.target.value })} required /></label>
            <label>Google Client Secret<input type="password" value={googleForm.client_secret} onChange={e => setGoogleForm({ ...googleForm, client_secret: e.target.value })} placeholder={platform?.google_configured ? 'Já configurado — preencha somente para substituir' : ''} required /></label>
            {platform?.google_redirect_uri && <small>URI de redirecionamento: {platform.google_redirect_uri}</small>}
            <button className="primary" disabled={loading}>{platform?.google_configured ? 'Atualizar configuração Gmail' : 'Configurar Gmail'}</button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="email-section-title"><div><span className="eyebrow">LIMITES</span><h2>Envios por empresa</h2></div></div>
        <div className="email-admin-list">
          {(organizations || []).map(org => {
            const limit = limits[org.id]
            const connection = connections[org.id]
            const draft = drafts[org.id] || { daily_send_limit: 100, send_interval_seconds: 60, sending_paused: false }
            const usage = limit?.usage_date === currentBrazilDate() ? Number(limit?.sent_today || 0) : 0
            return (
              <article className="email-admin-row" key={org.id}>
                <div className="email-admin-org"><strong>{org.name}</strong><span>{connection?.status === 'connected' ? `${providerLabel(connection.provider)} • ${connection.sender_email || connection.email_address}` : 'Nenhum e-mail conectado'}</span>{connection?.last_error && <small>{connection.last_error}</small>}</div>
                <label>Máximo/dia<input type="number" min="0" max="100000" value={draft.daily_send_limit} onChange={e => setDrafts(old => ({ ...old, [org.id]: { ...draft, daily_send_limit: e.target.value } }))} /></label>
                <label>Intervalo (s)<input type="number" min="0" max="86400" value={draft.send_interval_seconds} onChange={e => setDrafts(old => ({ ...old, [org.id]: { ...draft, send_interval_seconds: e.target.value } }))} /></label>
                <label className="email-admin-toggle"><input type="checkbox" checked={draft.sending_paused} onChange={e => setDrafts(old => ({ ...old, [org.id]: { ...draft, sending_paused: e.target.checked } }))} />Pausar envios</label>
                <div className="email-admin-usage"><span>Hoje</span><strong>{usage} / {limit?.daily_send_limit ?? draft.daily_send_limit}</strong></div>
                <button type="button" className="primary" disabled={loading} onClick={() => saveLimit(org.id)}>Salvar</button>
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}
