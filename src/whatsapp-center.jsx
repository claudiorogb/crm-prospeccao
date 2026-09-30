import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CheckCheck, Link2, MessageSquareText, RefreshCw, Send, Smartphone, UserPlus } from 'lucide-react'
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
  return provider === 'meta' ? 'Meta oficial' : 'Evolution'
}

function messageFallback(message) {
  const type = String(message?.message_type || 'unknown')
  if (type === 'audio') return 'Áudio'
  if (type === 'image') return 'Imagem'
  if (type === 'video') return 'Vídeo'
  if (type === 'document') return 'Documento'
  if (type === 'sticker') return 'Figurinha'
  return 'Mensagem'
}

export default function WhatsAppCenter({ organization }) {
  const [tab, setTab] = useState('inbox')
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [numbers, setNumbers] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState('open')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [metaConfig, setMetaConfig] = useState(null)
  const selected = useMemo(() => conversations.find(item => item.id === selectedId) || null, [conversations, selectedId])
  const endRef = useRef(null)

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
      .select('id,organization_id,whatsapp_number_id,lead_id,provider,contact_phone,contact_name,status,unread_count,last_message_at,last_message_preview,last_inbound_at,last_outbound_at,leads(id,business_name,status,contact_name)')
      .eq('organization_id', organization.id)
      .eq('status', filter)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    if (error) {
      setNotice(error.message)
      return
    }

    const rows = data || []
    setConversations(rows)
    if (!keepSelection || !rows.some(item => item.id === selectedId)) {
      setSelectedId(rows[0]?.id || '')
    }
  }

  async function loadMessages(conversationId) {
    if (!conversationId) {
      setMessages([])
      return
    }
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id,conversation_id,provider,provider_message_id,direction,message_type,text_body,media_metadata,delivery_status,is_automatic,occurred_at')
      .eq('organization_id', organization.id)
      .eq('conversation_id', conversationId)
      .order('occurred_at', { ascending: true })

    if (error) {
      setNotice(error.message)
      return
    }
    setMessages(data || [])
    const messagesContainer = endRef.current?.parentElement
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  async function loadNumbers() {
    const { data } = await supabase
      .from('whatsapp_numbers')
      .select('id,alias,phone_e164,provider,connection_status,is_active,is_default,provider_phone_number_id,credential_configured,last_connection_test_at,last_connection_test_ok')
      .eq('organization_id', organization.id)
      .is('deleted_at', null)
      .order('created_at')
    setNumbers(data || [])
  }

  async function loadMetaConfig() {
    const { data, error } = await supabase.functions.invoke('whatsapp-meta-connect', {
      body: { action: 'config', organization_id: organization.id }
    })
    if (!error && data) setMetaConfig(data)
  }

  useEffect(() => {
    loadConversations(false)
    loadNumbers()
    loadMetaConfig()
  }, [organization.id, filter])

  useEffect(() => {
    if (!selectedId) return undefined
    loadMessages(selectedId)
    invoke('mark_read', { conversation_id: selectedId }).then(() => {
      setConversations(current => current.map(item => item.id === selectedId ? { ...item, unread_count: 0 } : item))
    }).catch(() => {})
    return undefined
  }, [selectedId])

  useEffect(() => {
    let active = true
    const timer = setInterval(async () => {
      if (!active) return
      await loadConversations(true)
      if (selectedId) await loadMessages(selectedId)
    }, 4000)
    return () => { active = false; clearInterval(timer) }
  }, [organization.id, selectedId, filter])

  async function sendMessage(e) {
    e.preventDefault()
    if (!selected || !draft.trim() || loading) return
    setLoading(true)
    setNotice('')
    try {
      await invoke('send_message', { conversation_id: selected.id, text: draft.trim() })
      setDraft('')
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
      setNotice('Contato enviado ao CRM na etapa Novo.')
      await loadConversations(true)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function toggleArchive() {
    if (!selected || loading) return
    setLoading(true)
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

  function loadFacebookSdk(appId, version) {
    return new Promise((resolve, reject) => {
      if (window.FB) {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version })
        resolve(window.FB)
        return
      }
      window.fbAsyncInit = () => {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version })
        resolve(window.FB)
      }
      const current = document.getElementById('facebook-jssdk')
      if (current) return
      const script = document.createElement('script')
      script.id = 'facebook-jssdk'
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js'
      script.async = true
      script.defer = true
      script.onerror = () => reject(new Error('Não foi possível carregar a conexão da Meta.'))
      document.body.appendChild(script)
    })
  }

  async function connectMeta() {
    if (!metaConfig?.configured || loading) return
    setLoading(true)
    setNotice('')
    let signupInfo = null
    let authCode = null
    let completed = false

    const complete = async () => {
      if (completed || !signupInfo?.waba_id || !signupInfo?.phone_number_id || !authCode) return
      completed = true
      try {
        const { data, error } = await supabase.functions.invoke('whatsapp-meta-connect', {
          body: {
            action: 'complete_signup',
            organization_id: organization.id,
            code: authCode,
            waba_id: signupInfo.waba_id,
            phone_number_id: signupInfo.phone_number_id
          }
        })
        if (error) throw new Error(error.message)
        if (data?.error) throw new Error(data.error)
        setNotice('WhatsApp oficial conectado com sucesso.')
        await loadNumbers()
      } catch (error) {
        setNotice(error.message || 'Não foi possível concluir a conexão oficial.')
      } finally {
        window.removeEventListener('message', listener)
        setLoading(false)
      }
    }

    const listener = event => {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return
      let data = event.data
      try {
        if (typeof data === 'string') data = JSON.parse(data)
      } catch {
        return
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (data?.event === 'FINISH') {
        signupInfo = {
          waba_id: data?.data?.waba_id,
          phone_number_id: data?.data?.phone_number_id
        }
        complete()
      } else if (data?.event === 'CANCEL' || data?.event === 'ERROR') {
        setNotice('Conexão com a Meta cancelada ou não concluída.')
        window.removeEventListener('message', listener)
        setLoading(false)
      }
    }

    window.addEventListener('message', listener)

    try {
      const FB = await loadFacebookSdk(metaConfig.app_id, metaConfig.graph_version)
      FB.login(response => {
        authCode = response?.authResponse?.code || null
        if (!authCode) {
          setNotice('A Meta não retornou autorização para concluir a conexão.')
          window.removeEventListener('message', listener)
          setLoading(false)
          return
        }
        complete()
      }, {
        config_id: metaConfig.config_id,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3'
        }
      })
    } catch (error) {
      window.removeEventListener('message', listener)
      setNotice(error.message)
      setLoading(false)
    }
  }

  async function testMeta(number) {
    setLoading(true)
    setNotice('')
    const { data, error } = await supabase.functions.invoke('whatsapp-meta-connect', {
      body: { action: 'test_connection', organization_id: organization.id, number_id: number.id }
    })
    if (error || data?.error) setNotice(data?.error || error?.message || 'Falha no teste.')
    else setNotice('Conexão oficial validada com a Meta.')
    await loadNumbers()
    setLoading(false)
  }

  return (
    <section className="wa-center">
      <header className="wa-center-header">
        <div>
          <span className="eyebrow">WHATSAPP</span>
          <h1>Central de conversas</h1>
          <p className="muted">Receba e responda mensagens sem misturar este atendimento com o disparo de campanhas.</p>
        </div>
        <button className="secondary" type="button" onClick={() => { loadConversations(true); loadNumbers() }}>
          <RefreshCw size={16}/> Atualizar
        </button>
      </header>

      <div className="wa-center-tabs">
        <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}><MessageSquareText size={16}/> Conversas</button>
        <button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}><Link2 size={16}/> Conexões</button>
      </div>

      {notice && <div className="notice">{notice}</div>}

      {tab === 'connections' ? (
        <div className="wa-connections">
          <article className="panel wa-provider-card">
            <div>
              <span className="eyebrow">API OFICIAL</span>
              <h2>Meta Cloud API</h2>
              <p className="muted">Cada cliente conecta a própria conta WhatsApp Business pelo fluxo oficial da Meta.</p>
            </div>
            {metaConfig?.configured ? (
              <button className="primary" type="button" onClick={connectMeta} disabled={loading}>
                <Smartphone size={16}/> {loading ? 'Conectando...' : 'Conectar WhatsApp oficial'}
              </button>
            ) : (
              <div className="wa-config-pending">Configuração do aplicativo Meta da AXIVA pendente no servidor.</div>
            )}
          </article>

          <article className="panel">
            <span className="eyebrow">NÚMEROS</span>
            <h2>Números conectados</h2>
            <div className="wa-number-list">
              {numbers.length === 0 && <p className="muted">Nenhum número conectado.</p>}
              {numbers.map(number => (
                <div className="wa-number-row" key={number.id}>
                  <div>
                    <strong>{number.alias}</strong>
                    <span>{number.phone_e164} • {providerLabel(number.provider)}</span>
                  </div>
                  <div className="wa-number-actions">
                    <span className={number.connection_status === 'connected' ? 'wa-status ok' : 'wa-status'}>{number.connection_status}</span>
                    {number.provider === 'meta' && (
                      <button className="secondary mini" type="button" onClick={() => testMeta(number)} disabled={loading}>Testar</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="muted wa-qr-note">A conexão não oficial por QR Code continua disponível separadamente em <strong>Cadastrar WhatsApp</strong>.</p>
          </article>
        </div>
      ) : (
        <>
          <div className="wa-inbox-filter">
            <button className={filter === 'open' ? 'active' : ''} onClick={() => { setFilter('open'); setSelectedId('') }}>Abertas</button>
            <button className={filter === 'archived' ? 'active' : ''} onClick={() => { setFilter('archived'); setSelectedId('') }}>Arquivadas</button>
          </div>

          <div className="wa-inbox">
            <aside className="wa-conversation-list">
              {conversations.length === 0 ? (
                <div className="wa-empty"><MessageSquareText size={28}/><strong>Nenhuma conversa</strong><span>As mensagens recebidas aparecerão aqui.</span></div>
              ) : conversations.map(item => (
                <button key={item.id} type="button" className={item.id === selectedId ? 'wa-conversation active' : 'wa-conversation'} onClick={() => setSelectedId(item.id)}>
                  <div className="wa-conversation-top">
                    <strong>{item.leads?.business_name || item.contact_name || item.contact_phone}</strong>
                    {item.unread_count > 0 && <span className="wa-unread">{item.unread_count}</span>}
                  </div>
                  <span>{item.contact_phone} • {providerLabel(item.provider)}</span>
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
                    <div>
                      <strong>{selected.leads?.business_name || selected.contact_name || selected.contact_phone}</strong>
                      <span>{selected.contact_phone} • {providerLabel(selected.provider)}</span>
                    </div>
                    <div className="wa-thread-actions">
                      {!selected.lead_id && (
                        <button type="button" className="secondary mini" onClick={createLead} disabled={loading}><UserPlus size={15}/> Criar oportunidade</button>
                      )}
                      <button type="button" className="secondary mini" onClick={toggleArchive} disabled={loading}><Archive size={15}/> {selected.status === 'archived' ? 'Reabrir' : 'Arquivar'}</button>
                    </div>
                  </header>

                  <div className="wa-messages">
                    {messages.map(message => (
                      <div className={message.direction === 'outbound' ? 'wa-message outbound' : 'wa-message inbound'} key={message.id}>
                        <div>
                          {message.text_body || <em>{messageFallback(message)}</em>}
                          {message.is_automatic && <span className="wa-auto">Resposta automática</span>}
                        </div>
                        <small>{formatTime(message.occurred_at)} {message.direction === 'outbound' && <><CheckCheck size={13}/> {message.delivery_status}</>}</small>
                      </div>
                    ))}
                    <div ref={endRef}/>
                  </div>

                  <form className="wa-compose" onSubmit={sendMessage}>
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Escreva uma mensagem..." maxLength={4096}/>
                    <button className="primary" disabled={loading || !draft.trim()}><Send size={16}/> Enviar</button>
                  </form>
                </>
              )}
            </main>
          </div>
        </>
      )}
    </section>
  )
}
