import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, CheckCheck, Edit3, FileText, Image as ImageIcon, Link2,
  MessageSquareText, Mic, Paperclip, RefreshCw, Save, Send,
  Smartphone, Trash2, UserCheck, UserPlus, Users, Video, X
} from 'lucide-react'
import { supabase } from './lib/supabase'
import './whatsapp-center.css'

function formatTime(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return ''
  }
}

function providerLabel(provider) {
  return provider === 'evolution' ? 'Evolution API' : 'Meta oficial'
}

function messageFallback(message) {
  const type = String(message?.message_type || 'unknown')
  if (type === 'audio') return 'Áudio'
  if (type === 'image') return 'Imagem'
  if (type === 'video') return 'Vídeo'
  if (type === 'document') return 'Documento'
  if (type === 'sticker') return 'Figurinha'
  if (type === 'contact') return 'Contato'
  if (type === 'location') return 'Localização'
  return 'Mensagem'
}

function mediaTypeFromMime(mime) {
  const value = String(mime || '').toLowerCase()
  if (value.startsWith('image/')) return 'image'
  if (value.startsWith('video/')) return 'video'
  if (value.startsWith('audio/')) return 'audio'
  return 'document'
}

function deliveryLabel(value) {
  const labels = {
    pending: 'Pendente',
    sent: 'Enviada',
    delivered: 'Entregue',
    read: 'Lida',
    played: 'Ouvida',
    received: 'Recebida',
    failed: 'Falhou',
  }
  return labels[String(value || '').toLowerCase()] || value || ''
}

function mediaIcon(type, size = 16) {
  if (type === 'image') return <ImageIcon size={size}/>
  if (type === 'video') return <Video size={size}/>
  if (type === 'audio') return <Mic size={size}/>
  return <FileText size={size}/>
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.includes(',') ? value.split(',')[1] : value)
    }
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
    reader.readAsDataURL(file)
  })
}

function MessageBubble({ message, media, onOpenMedia }) {
  const isMedia = ['image','video','audio','document','sticker'].includes(message.message_type)
  const meta = message.media_metadata || {}
  return (
    <div className={message.direction === 'outbound' ? 'wa-message outbound' : 'wa-message inbound'}>
      <div>
        {message.text_body && <div className="wa-message-text">{message.text_body}</div>}
        {!message.text_body && !isMedia && <em>{messageFallback(message)}</em>}

        {isMedia && (
          <div className="wa-media-block">
            {media?.url ? (
              <>
                {message.message_type === 'image' && <img src={media.url} alt={meta.file_name || 'Imagem recebida'} />}
                {message.message_type === 'video' && <video src={media.url} controls />}
                {message.message_type === 'audio' && <audio src={media.url} controls />}
                {['document','sticker'].includes(message.message_type) && (
                  <a href={media.url} target="_blank" rel="noreferrer" download={media.file_name || meta.file_name || undefined}>
                    {mediaIcon(message.message_type)} Abrir {media.file_name || meta.file_name || messageFallback(message)}
                  </a>
                )}
              </>
            ) : (
              <button type="button" className="wa-media-open" onClick={() => onOpenMedia(message)}>
                {mediaIcon(message.message_type)}
                <span>{meta.file_name || `Abrir ${messageFallback(message).toLowerCase()}`}</span>
              </button>
            )}
          </div>
        )}

        {message.is_automatic && <span className="wa-auto">Resposta automática</span>}
        {message.source === 'phone' && <span className="wa-phone-source">Enviado pelo celular</span>}
      </div>
      <small>
        {formatTime(message.occurred_at)}
        {message.direction === 'outbound' && <><CheckCheck size={13}/> {deliveryLabel(message.delivery_status)}</>}
      </small>
    </div>
  )
}

function ConversationMessages({ messages, mediaCache, onOpenMedia, endRef }) {
  return (
    <div className="wa-messages">
      {messages.length === 0 && <div className="wa-empty wa-empty-thread"><MessageSquareText size={28}/><span>Nenhuma mensagem nesta conversa.</span></div>}
      {messages.map(message => (
        <MessageBubble
          key={message.id}
          message={message}
          media={mediaCache[message.id]}
          onOpenMedia={onOpenMedia}
        />
      ))}
      <div ref={endRef}/>
    </div>
  )
}

export default function WhatsAppCenter({ organization }) {
  const [view, setView] = useState('inbox')
  const [statusFilter, setStatusFilter] = useState('open')
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [numbers, setNumbers] = useState([])
  const [members, setMembers] = useState([])
  const [leads, setLeads] = useState([])
  const [quickReplies, setQuickReplies] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [showAssociate, setShowAssociate] = useState(false)
  const [associateQuery, setAssociateQuery] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [mediaCache, setMediaCache] = useState({})
  const [quickForm, setQuickForm] = useState({ id: null, name: '', body: '' })
  const endRef = useRef(null)
  const fileRef = useRef(null)

  const selected = useMemo(
    () => conversations.find(item => item.id === selectedId) || null,
    [conversations, selectedId]
  )

  const visibleConversations = useMemo(() => {
    if (view === 'unread') return conversations.filter(item => Number(item.unread_count || 0) > 0)
    if (view === 'unknown') return conversations.filter(item => !item.lead_id)
    return conversations
  }, [conversations, view])

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0),
    [conversations]
  )
  const unknownTotal = useMemo(() => conversations.filter(item => !item.lead_id).length, [conversations])

  const filteredLeads = useMemo(() => {
    const q = associateQuery.trim().toLowerCase()
    if (!q) return leads.slice(0, 30)
    return leads.filter(lead =>
      [lead.business_name, lead.contact_name, lead.phone, lead.whatsapp_phone]
        .some(value => String(value || '').toLowerCase().includes(q))
    ).slice(0, 30)
  }, [leads, associateQuery])

  async function invoke(action, extra = {}) {
    const { data, error } = await supabase.functions.invoke('whatsapp-conversation-api', {
      body: { action, organization_id: organization.id, ...extra }
    })
    if (error) throw new Error(error.message || 'Não foi possível concluir a ação.')
    if (data?.error) throw new Error(data.error)
    return data || {}
  }

  async function loadConversations(keepSelection = true) {
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('id,organization_id,whatsapp_number_id,lead_id,provider,contact_phone,contact_name,status,unread_count,last_message_at,last_message_preview,last_inbound_at,last_outbound_at,assigned_to,last_read_at,leads(id,business_name,status,contact_name)')
      .eq('organization_id', organization.id)
      .eq('provider', 'evolution')
      .eq('status', statusFilter)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    if (error) {
      setNotice(error.message)
      return
    }

    const rows = data || []
    setConversations(rows)
    if (!keepSelection || !rows.some(item => item.id === selectedId)) {
      const firstVisible = view === 'unread'
        ? rows.find(item => Number(item.unread_count || 0) > 0)
        : view === 'unknown'
          ? rows.find(item => !item.lead_id)
          : rows[0]
      setSelectedId(firstVisible?.id || '')
    }
  }

  async function loadMessages(conversationId) {
    if (!conversationId) {
      setMessages([])
      return
    }
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id,conversation_id,provider,provider_message_id,direction,message_type,text_body,media_metadata,delivery_status,is_automatic,source,sent_by_user_id,occurred_at')
      .eq('organization_id', organization.id)
      .eq('conversation_id', conversationId)
      .order('occurred_at', { ascending: true })

    if (error) {
      setNotice(error.message)
      return
    }
    setMessages(data || [])
    requestAnimationFrame(() => {
      const container = endRef.current?.parentElement
      if (container) container.scrollTop = container.scrollHeight
    })
  }

  async function loadNumbers() {
    const { data } = await supabase
      .from('whatsapp_numbers')
      .select('id,alias,phone_e164,provider,connection_status,is_active,is_default,evolution_instance_name,evolution_last_sync_at')
      .eq('organization_id', organization.id)
      .eq('provider', 'evolution')
      .is('deleted_at', null)
      .order('created_at')

    const rows = data || []
    setNumbers(rows)

    // Para administradores, a consulta também mantém o webhook Evolution
    // sincronizado com os eventos necessários da Central. Para atendentes,
    // uma eventual negativa de permissão é silenciosa e não interfere no uso.
    const syncable = rows.filter(number => number.is_active && number.evolution_instance_name)
    if (!syncable.length) return

    const results = await Promise.all(syncable.map(async number => {
      const { data: state, error } = await supabase.functions.invoke('evolution_gateway', {
        body: {
          action: 'connection_state',
          organization_id: organization.id,
          number_id: number.id
        }
      })
      if (error || state?.error) return null
      return {
        id: number.id,
        connection_status: state?.state === 'open' ? 'connected' : (state?.state || number.connection_status),
        evolution_last_sync_at: new Date().toISOString()
      }
    }))

    const patches = new Map(results.filter(Boolean).map(item => [item.id, item]))
    if (patches.size) {
      setNumbers(current => current.map(number => patches.has(number.id) ? { ...number, ...patches.get(number.id) } : number))
    }
  }

  async function loadMembers() {
    const { data } = await supabase
      .from('organization_members')
      .select('user_id,display_name')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('display_name')
    setMembers(data || [])
  }

  async function loadLeads() {
    const { data } = await supabase
      .from('leads')
      .select('id,business_name,contact_name,phone,whatsapp_phone,status')
      .eq('organization_id', organization.id)
      .is('deleted_at', null)
      .neq('status', 'discarded')
      .order('updated_at', { ascending: false })
      .limit(500)
    setLeads(data || [])
  }

  async function loadQuickReplies() {
    const { data, error } = await supabase
      .from('whatsapp_quick_replies')
      .select('id,name,body,is_active,created_at,updated_at')
      .eq('organization_id', organization.id)
      .is('deleted_at', null)
      .order('name')
    if (!error) setQuickReplies(data || [])
  }

  async function loadAll() {
    await Promise.all([
      loadConversations(false),
      loadNumbers(),
      loadMembers(),
      loadLeads(),
      loadQuickReplies()
    ])
  }

  useEffect(() => {
    loadAll()
  }, [organization.id, statusFilter])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    loadMessages(selectedId)
    invoke('mark_read', { conversation_id: selectedId }).then(() => {
      setConversations(current => current.map(item =>
        item.id === selectedId ? { ...item, unread_count: 0, last_read_at: new Date().toISOString() } : item
      ))
    }).catch(() => {})
  }, [selectedId])

  useEffect(() => {
    if (!['inbox','unread','unknown'].includes(view)) return undefined
    let active = true
    const timer = setInterval(async () => {
      if (!active) return
      await loadConversations(true)
      if (selectedId) await loadMessages(selectedId)
    }, 4000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [organization.id, selectedId, statusFilter, view])

  useEffect(() => {
    if (selected) {
      setNameDraft(selected.contact_name || selected.leads?.contact_name || selected.leads?.business_name || '')
      setEditingName(false)
      setShowAssociate(false)
      setAssociateQuery('')
      setAttachment(null)
    }
  }, [selectedId])

  useEffect(() => {
    if (!visibleConversations.some(item => item.id === selectedId)) {
      setSelectedId(visibleConversations[0]?.id || '')
    }
  }, [view])

  async function openMedia(message) {
    if (mediaCache[message.id]?.url || loading) return
    setLoading(true)
    setNotice('')
    try {
      const data = await invoke('get_media', { conversation_id: message.conversation_id, message_id: message.id })
      if (!data.base64) throw new Error('A mídia não está mais disponível no provedor.')
      const mime = data.mimetype || message.media_metadata?.mime_type || 'application/octet-stream'
      setMediaCache(current => ({
        ...current,
        [message.id]: {
          url: `data:${mime};base64,${data.base64}`,
          mimetype: mime,
          file_name: data.file_name || message.media_metadata?.file_name || null,
        }
      }))
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFile(file) {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setNotice('O anexo deve ter no máximo 8 MB.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    try {
      const base64 = await fileToBase64(file)
      setAttachment({
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        base64,
        size: file.size,
      })
      setNotice('')
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function sendCurrent(e) {
    e.preventDefault()
    if (!selected || loading || (!draft.trim() && !attachment)) return
    setLoading(true)
    setNotice('')
    try {
      if (attachment) {
        await invoke('send_media', {
          conversation_id: selected.id,
          file_name: attachment.file_name,
          mime_type: attachment.mime_type,
          base64: attachment.base64,
          caption: draft.trim(),
        })
      } else {
        await invoke('send_message', { conversation_id: selected.id, text: draft.trim() })
      }
      setDraft('')
      setAttachment(null)
      if (fileRef.current) fileRef.current.value = ''
      await Promise.all([loadMessages(selected.id), loadConversations(true)])
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function createLead() {
    if (!selected || loading) return
    setLoading(true)
    setNotice('')
    try {
      await invoke('create_lead', { conversation_id: selected.id })
      setNotice('Contato enviado ao Kanban na etapa Novo.')
      await Promise.all([loadConversations(true), loadLeads()])
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function associateLead(leadId) {
    if (!selected || !leadId || loading) return
    setLoading(true)
    setNotice('')
    try {
      await invoke('associate_lead', { conversation_id: selected.id, lead_id: leadId })
      setNotice('Conversa associada ao lead.')
      setShowAssociate(false)
      await loadConversations(true)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function saveContactName() {
    if (!selected || !nameDraft.trim() || loading) return
    setLoading(true)
    setNotice('')
    try {
      await invoke('rename_contact', { conversation_id: selected.id, name: nameDraft.trim() })
      setEditingName(false)
      setNotice('Nome atualizado no WhatsApp do CRM e no lead vinculado.')
      await Promise.all([loadConversations(true), loadLeads()])
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function assignConversation(userId) {
    if (!selected || loading) return
    setLoading(true)
    setNotice('')
    try {
      await invoke('assign_to', { conversation_id: selected.id, user_id: userId || null })
      setConversations(current => current.map(item =>
        item.id === selected.id ? { ...item, assigned_to: userId || null } : item
      ))
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function toggleArchive() {
    if (!selected || loading) return
    setLoading(true)
    setNotice('')
    try {
      const next = selected.status === 'archived' ? 'open' : 'archived'
      await invoke('set_status', { conversation_id: selected.id, status: next })
      setSelectedId('')
      await loadConversations(false)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function saveQuickReply(e) {
    e.preventDefault()
    const name = quickForm.name.trim()
    const body = quickForm.body.trim()
    if (!name || !body) return
    setLoading(true)
    setNotice('')
    try {
      if (quickForm.id) {
        const { error } = await supabase
          .from('whatsapp_quick_replies')
          .update({ name, body, updated_at: new Date().toISOString() })
          .eq('id', quickForm.id)
          .eq('organization_id', organization.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('whatsapp_quick_replies')
          .insert({ organization_id: organization.id, name, body })
        if (error) throw error
      }
      setQuickForm({ id: null, name: '', body: '' })
      await loadQuickReplies()
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function deleteQuickReply(item) {
    setLoading(true)
    const { error } = await supabase
      .from('whatsapp_quick_replies')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('organization_id', organization.id)
    if (error) setNotice(error.message)
    await loadQuickReplies()
    setLoading(false)
  }

  function applyQuickReply(id) {
    const item = quickReplies.find(reply => reply.id === id)
    if (item) setDraft(item.body)
  }

  const isConversationView = ['inbox','unread','unknown'].includes(view)

  return (
    <section className="wa-center">
      <header className="wa-center-header">
        <div>
          <span className="eyebrow">WHATSAPP</span>
          <h1>Central de conversas</h1>
          <p className="muted">Receba, responda e organize conversas sem misturar este atendimento com o disparo de campanhas.</p>
        </div>
        <button className="secondary" type="button" onClick={loadAll}>
          <RefreshCw size={16}/> Atualizar
        </button>
      </header>

      <div className="wa-center-tabs">
        <button className={view === 'inbox' ? 'active' : ''} onClick={() => setView('inbox')}><MessageSquareText size={16}/> Conversas</button>
        <button className={view === 'unread' ? 'active' : ''} onClick={() => setView('unread')}>
          <MessageSquareText size={16}/> Não lidas {unreadTotal > 0 && <span className="wa-tab-count">{unreadTotal}</span>}
        </button>
        <button className={view === 'unknown' ? 'active' : ''} onClick={() => setView('unknown')}>
          <UserPlus size={16}/> Não cadastrados {unknownTotal > 0 && <span className="wa-tab-count">{unknownTotal}</span>}
        </button>
        <button className={view === 'templates' ? 'active' : ''} onClick={() => setView('templates')}><FileText size={16}/> Modelos</button>
        <button className={view === 'connections' ? 'active' : ''} onClick={() => setView('connections')}><Link2 size={16}/> Números</button>
      </div>

      {notice && <div className="notice">{notice}</div>}

      {isConversationView && (
        <>
          <div className="wa-inbox-filter">
            <button className={statusFilter === 'open' ? 'active' : ''} onClick={() => { setStatusFilter('open'); setSelectedId('') }}>Abertas</button>
            <button className={statusFilter === 'archived' ? 'active' : ''} onClick={() => { setStatusFilter('archived'); setSelectedId('') }}>Arquivadas</button>
          </div>

          <div className="wa-inbox">
            <aside className="wa-conversation-list">
              {visibleConversations.length === 0 ? (
                <div className="wa-empty"><MessageSquareText size={28}/><strong>Nenhuma conversa</strong><span>As mensagens recebidas aparecerão aqui.</span></div>
              ) : visibleConversations.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === selectedId ? 'wa-conversation active' : 'wa-conversation'}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="wa-conversation-top">
                    <strong>{item.leads?.business_name || item.contact_name || item.contact_phone}</strong>
                    {item.unread_count > 0 && <span className="wa-unread">{item.unread_count}</span>}
                  </div>
                  <span>{item.contact_phone} • {providerLabel(item.provider)}</span>
                  {!item.lead_id && <span className="wa-unknown-label">Não cadastrado</span>}
                  <p>{item.last_message_preview || 'Sem prévia'}</p>
                  <small>{formatTime(item.last_message_at)}</small>
                </button>
              ))}
            </aside>

            <main className="wa-thread">
              {!selected ? (
                <div className="wa-empty"><MessageSquareText size={34}/><strong>Selecione uma conversa</strong></div>
              ) : (
                <>
                  <header className="wa-thread-header">
                    <div className="wa-thread-identity">
                      {editingName ? (
                        <div className="wa-name-edit">
                          <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={120} autoFocus />
                          <button type="button" className="primary mini" onClick={saveContactName} disabled={loading}><Save size={14}/> Salvar</button>
                          <button type="button" className="secondary mini" onClick={() => setEditingName(false)}><X size={14}/></button>
                        </div>
                      ) : (
                        <div className="wa-name-row">
                          <strong>{selected.leads?.business_name || selected.contact_name || selected.contact_phone}</strong>
                          <button type="button" className="wa-icon-button" onClick={() => setEditingName(true)} title="Editar nome"><Edit3 size={14}/></button>
                        </div>
                      )}
                      <span>{selected.contact_phone} • {providerLabel(selected.provider)}</span>
                      {selected.lead_id && <span className="wa-linked-label">Vinculado ao CRM</span>}
                    </div>

                    <div className="wa-thread-actions">
                      <label className="wa-assignee">
                        <UserCheck size={15}/>
                        <select value={selected.assigned_to || ''} onChange={e => assignConversation(e.target.value)} disabled={loading}>
                          <option value="">Sem responsável</option>
                          {members.map(member => <option value={member.user_id} key={member.user_id}>{member.display_name || 'Usuário'}</option>)}
                        </select>
                      </label>

                      {!selected.lead_id && (
                        <>
                          <button type="button" className="secondary mini" onClick={createLead} disabled={loading}><UserPlus size={15}/> Criar oportunidade</button>
                          <button type="button" className="secondary mini" onClick={() => setShowAssociate(value => !value)} disabled={loading}><Users size={15}/> Associar cliente</button>
                        </>
                      )}
                      <button type="button" className="secondary mini" onClick={toggleArchive} disabled={loading}>
                        <Archive size={15}/> {selected.status === 'archived' ? 'Reabrir' : 'Arquivar'}
                      </button>
                    </div>
                  </header>

                  {showAssociate && !selected.lead_id && (
                    <div className="wa-associate">
                      <input
                        value={associateQuery}
                        onChange={e => setAssociateQuery(e.target.value)}
                        placeholder="Buscar empresa, contato ou telefone"
                      />
                      <div className="wa-associate-results">
                        {filteredLeads.map(lead => (
                          <button type="button" key={lead.id} onClick={() => associateLead(lead.id)}>
                            <strong>{lead.business_name}</strong>
                            <span>{lead.contact_name || 'Sem contato'} • {lead.whatsapp_phone || lead.phone || 'Sem telefone'}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <ConversationMessages
                    messages={messages}
                    mediaCache={mediaCache}
                    onOpenMedia={openMedia}
                    endRef={endRef}
                  />

                  <form className="wa-compose" onSubmit={sendCurrent}>
                    <div className="wa-compose-tools">
                      <select value="" onChange={e => { applyQuickReply(e.target.value); e.target.value = '' }}>
                        <option value="">Modelo de mensagem</option>
                        {quickReplies.filter(item => item.is_active).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
                      </select>
                      <button type="button" className="secondary mini" onClick={() => fileRef.current?.click()} title="Anexar arquivo">
                        <Paperclip size={16}/> Anexar
                      </button>
                      <input
                        ref={fileRef}
                        className="wa-file-input"
                        type="file"
                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                        onChange={e => handleFile(e.target.files?.[0])}
                      />
                    </div>

                    {attachment && (
                      <div className="wa-attachment-chip">
                        {mediaIcon(mediaTypeFromMime(attachment.mime_type))}
                        <span>{attachment.file_name}</span>
                        <button type="button" onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = '' }}><X size={14}/></button>
                      </div>
                    )}

                    <div className="wa-compose-row">
                      <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        placeholder={attachment ? 'Legenda opcional...' : 'Escreva uma mensagem...'}
                        maxLength={4096}
                      />
                      <button className="primary" disabled={loading || (!draft.trim() && !attachment)}>
                        <Send size={16}/> {loading ? 'Enviando...' : 'Enviar'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </main>
          </div>
        </>
      )}

      {view === 'templates' && (
        <div className="wa-template-layout">
          <form className="panel wa-template-form" onSubmit={saveQuickReply}>
            <span className="eyebrow">MODELOS</span>
            <h2>{quickForm.id ? 'Editar modelo' : 'Novo modelo de mensagem'}</h2>
            <label>Nome<input value={quickForm.name} onChange={e => setQuickForm({...quickForm, name:e.target.value})} maxLength={80} required /></label>
            <label>Mensagem<textarea value={quickForm.body} onChange={e => setQuickForm({...quickForm, body:e.target.value})} maxLength={4096} required /></label>
            <div className="form-actions">
              <button className="primary inline-btn" disabled={loading}><Save size={15}/> Salvar</button>
              {quickForm.id && <button type="button" className="secondary inline-btn" onClick={() => setQuickForm({id:null,name:'',body:''})}>Cancelar</button>}
            </div>
          </form>

          <section className="panel">
            <span className="eyebrow">MENSAGENS PRONTAS</span>
            <h2>Modelos cadastrados</h2>
            <div className="wa-template-list">
              {quickReplies.length === 0 && <p className="muted">Nenhum modelo cadastrado.</p>}
              {quickReplies.map(item => (
                <article key={item.id} className="wa-template-item">
                  <div>
                    <strong>{item.name}</strong>
                    <p>{item.body}</p>
                  </div>
                  <div className="wa-template-actions">
                    <button type="button" className="secondary mini" onClick={() => setQuickForm({id:item.id,name:item.name,body:item.body})}><Edit3 size={14}/> Editar</button>
                    <button type="button" className="secondary mini" onClick={() => deleteQuickReply(item)}><Trash2 size={14}/> Excluir</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {view === 'connections' && (
        <div className="wa-connections">
          <article className="panel">
            <div className="wa-number-heading">
              <div>
                <span className="eyebrow">EVOLUTION API</span>
                <h2>Números conectados</h2>
              </div>
              <Smartphone size={24}/>
            </div>
            <div className="wa-number-list">
              {numbers.length === 0 && <p className="muted">Nenhum número Evolution conectado.</p>}
              {numbers.map(number => (
                <div className="wa-number-row" key={number.id}>
                  <div>
                    <strong>{number.alias}</strong>
                    <span>{number.phone_e164} • {number.is_default ? 'Padrão' : 'Secundário'}</span>
                  </div>
                  <div className="wa-number-actions">
                    <span className={number.connection_status === 'connected' ? 'wa-status ok' : 'wa-status'}>{number.connection_status}</span>
                    <small>{number.evolution_last_sync_at ? `Sincronizado ${formatTime(number.evolution_last_sync_at)}` : 'Sem sincronização registrada'}</small>
                  </div>
                </div>
              ))}
            </div>
            <p className="muted wa-qr-note">Adicionar, remover ou reconectar números continua disponível em <strong>Cadastrar WhatsApp</strong>. A integração oficial da Meta permanece preparada no backend e oculta até a liberação futura.</p>
          </article>
        </div>
      )}
    </section>
  )
}

export function WhatsAppLeadPanel({ organization, lead, onClose, onUpdated }) {
  const [conversation, setConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [mediaCache, setMediaCache] = useState({})
  const [quickReplies, setQuickReplies] = useState([])
  const endRef = useRef(null)
  const fileRef = useRef(null)

  async function invoke(action, extra = {}) {
    if (!conversation?.id) throw new Error('Conversa não encontrada.')
    const { data, error } = await supabase.functions.invoke('whatsapp-conversation-api', {
      body: { action, organization_id: organization.id, conversation_id: conversation.id, ...extra }
    })
    if (error) throw new Error(error.message || 'Não foi possível concluir a ação.')
    if (data?.error) throw new Error(data.error)
    return data || {}
  }

  async function loadConversation() {
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('id,lead_id,provider,contact_phone,contact_name,status,unread_count,last_message_at')
      .eq('organization_id', organization.id)
      .eq('provider', 'evolution')
      .eq('lead_id', lead.id)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)

    if (error) {
      setNotice(error.message)
      return
    }
    const row = data?.[0] || null
    setConversation(row)
    if (row?.id) {
      await loadMessages(row.id)
      await supabase.functions.invoke('whatsapp-conversation-api', {
        body: { action:'mark_read', organization_id:organization.id, conversation_id:row.id }
      })
      onUpdated?.()
    } else {
      setMessages([])
    }
  }

  async function loadMessages(conversationId) {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id,conversation_id,provider,provider_message_id,direction,message_type,text_body,media_metadata,delivery_status,is_automatic,source,sent_by_user_id,occurred_at')
      .eq('organization_id', organization.id)
      .eq('conversation_id', conversationId)
      .order('occurred_at', { ascending: true })
    if (error) {
      setNotice(error.message)
      return
    }
    setMessages(data || [])
    requestAnimationFrame(() => {
      const container = endRef.current?.parentElement
      if (container) container.scrollTop = container.scrollHeight
    })
  }

  async function loadQuickReplies() {
    const { data } = await supabase
      .from('whatsapp_quick_replies')
      .select('id,name,body,is_active')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
    setQuickReplies(data || [])
  }

  useEffect(() => {
    loadConversation()
    loadQuickReplies()
  }, [organization.id, lead.id])

  useEffect(() => {
    if (!conversation?.id) return undefined
    let active = true
    const timer = setInterval(async () => {
      if (!active) return
      await loadMessages(conversation.id)
    }, 4000)
    return () => { active = false; clearInterval(timer) }
  }, [conversation?.id])

  async function openMedia(message) {
    if (mediaCache[message.id]?.url || loading) return
    setLoading(true)
    setNotice('')
    try {
      const data = await invoke('get_media', { message_id: message.id })
      if (!data.base64) throw new Error('A mídia não está mais disponível.')
      const mime = data.mimetype || message.media_metadata?.mime_type || 'application/octet-stream'
      setMediaCache(current => ({
        ...current,
        [message.id]: {
          url: `data:${mime};base64,${data.base64}`,
          mimetype: mime,
          file_name: data.file_name || message.media_metadata?.file_name || null,
        }
      }))
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFile(file) {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setNotice('O anexo deve ter no máximo 8 MB.')
      return
    }
    const base64 = await fileToBase64(file)
    setAttachment({ file_name:file.name, mime_type:file.type || 'application/octet-stream', base64 })
  }

  async function sendCurrent(e) {
    e.preventDefault()
    if (!conversation || loading || (!draft.trim() && !attachment)) return
    setLoading(true)
    setNotice('')
    try {
      if (attachment) {
        await invoke('send_media', {
          file_name: attachment.file_name,
          mime_type: attachment.mime_type,
          base64: attachment.base64,
          caption: draft.trim(),
        })
      } else {
        await invoke('send_message', { text: draft.trim() })
      }
      setDraft('')
      setAttachment(null)
      if (fileRef.current) fileRef.current.value = ''
      await loadMessages(conversation.id)
      onUpdated?.()
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wa-side-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <aside className="wa-side-panel">
        <header className="wa-side-header">
          <div>
            <span className="eyebrow">WHATSAPP</span>
            <h2>{lead.business_name}</h2>
            <span>{conversation?.contact_phone || lead.whatsapp_phone || lead.phone || 'Sem número'}</span>
          </div>
          <button type="button" className="wa-icon-button" onClick={onClose}><X size={20}/></button>
        </header>

        {notice && <div className="notice">{notice}</div>}

        {!conversation ? (
          <div className="wa-empty">
            <MessageSquareText size={32}/>
            <strong>Nenhuma conversa vinculada</strong>
            <span>Quando houver uma conversa desse contato na Central WhatsApp, ela aparecerá aqui.</span>
          </div>
        ) : (
          <>
            <ConversationMessages
              messages={messages}
              mediaCache={mediaCache}
              onOpenMedia={openMedia}
              endRef={endRef}
            />

            <form className="wa-compose wa-side-compose" onSubmit={sendCurrent}>
              <div className="wa-compose-tools">
                <select value="" onChange={e => {
                  const item = quickReplies.find(reply => reply.id === e.target.value)
                  if (item) setDraft(item.body)
                  e.target.value = ''
                }}>
                  <option value="">Modelo de mensagem</option>
                  {quickReplies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button type="button" className="secondary mini" onClick={() => fileRef.current?.click()}><Paperclip size={15}/> Anexar</button>
                <input
                  ref={fileRef}
                  className="wa-file-input"
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={e => handleFile(e.target.files?.[0])}
                />
              </div>
              {attachment && (
                <div className="wa-attachment-chip">
                  {mediaIcon(mediaTypeFromMime(attachment.mime_type))}
                  <span>{attachment.file_name}</span>
                  <button type="button" onClick={() => setAttachment(null)}><X size={14}/></button>
                </div>
              )}
              <div className="wa-compose-row">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder={attachment ? 'Legenda opcional...' : 'Responder pelo AXIVA...'}
                  maxLength={4096}
                />
                <button className="primary" disabled={loading || (!draft.trim() && !attachment)}><Send size={16}/> Enviar</button>
              </div>
            </form>
          </>
        )}
      </aside>
    </div>
  )
}
