import React, { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { askAxivaAi, loadAxivaAiHistory } from './ai-client'

function InlineText({ text }) {
  const value = String(text || '')
  const parts = value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        return <React.Fragment key={index}>{part}</React.Fragment>
      })}
    </>
  )
}

function AiMessageContent({ content }) {
  const lines = String(content || '').replace(/\r/g, '').split('\n')

  return (
    <div className="ai-message-content">
      {lines.map((line, index) => {
        const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/)
        const bullet = line.match(/^\s*[-•]\s+(.*)$/)

        if (numbered) {
          return (
            <div className="ai-content-line ai-content-list" key={index}>
              <span className="ai-list-marker">{numbered[1]}.</span>
              <span><InlineText text={numbered[2]} /></span>
            </div>
          )
        }

        if (bullet) {
          return (
            <div className="ai-content-line ai-content-list" key={index}>
              <span className="ai-list-marker">•</span>
              <span><InlineText text={bullet[1]} /></span>
            </div>
          )
        }

        if (!line.trim()) return <div className="ai-content-spacer" key={index} />

        return (
          <div className="ai-content-line" key={index}>
            <InlineText text={line} />
          </div>
        )
      })}
    </div>
  )
}

function aiStorageKey(userKey) {
  const safeKey = encodeURIComponent(String(userKey || 'current-user'))
  return `axiva_ai_conversation_v1_${safeKey}`
}

function readStoredConversation(userKey) {
  try {
    const raw = localStorage.getItem(aiStorageKey(userKey))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.messages)) return null
    return {
      conversationId: parsed.conversationId || null,
      messages: parsed.messages.slice(-100),
    }
  } catch {
    return null
  }
}

function writeStoredConversation(userKey, conversationId, messages) {
  try {
    localStorage.setItem(aiStorageKey(userKey), JSON.stringify({
      conversationId: conversationId || null,
      messages: Array.isArray(messages) ? messages.slice(-100) : [],
      updatedAt: new Date().toISOString(),
    }))
  } catch {
    // O histórico da interface é apenas um cache. Se o navegador não permitir armazenamento,
    // a conversa continua funcionando normalmente pelo backend.
  }
}

function useAiConversation(userKey) {
  const initial = useRef(null)
  if (initial.current === null) initial.current = readStoredConversation(userKey)

  const [messages, setMessages] = useState(() => initial.current?.messages || [])
  const [message, setMessage] = useState('')
  const [conversationId, setConversationId] = useState(() => initial.current?.conversationId || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const shouldScrollRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function restoreFromBackend() {
      if (initial.current?.messages?.length || initial.current?.conversationId) return

      try {
        const data = await loadAxivaAiHistory()
        if (cancelled) return
        if (data?.conversation_id) setConversationId(data.conversation_id)
        if (Array.isArray(data?.messages) && data.messages.length) {
          setMessages(data.messages)
          writeStoredConversation(userKey, data.conversation_id, data.messages)
        }
      } catch {
        // Falha no carregamento do histórico não impede novas perguntas.
      }
    }

    restoreFromBackend()
    return () => { cancelled = true }
  }, [userKey])

  useEffect(() => {
    writeStoredConversation(userKey, conversationId, messages)
  }, [userKey, conversationId, messages])

  async function submit(e) {
    e?.preventDefault?.()
    const text = message.trim()
    if (!text || loading) return

    setLoading(true)
    setError('')
    shouldScrollRef.current = true
    const nextUserMessages = [...messages, { role: 'user', content: text }]
    setMessages(nextUserMessages)
    setMessage('')

    try {
      const data = await askAxivaAi({ message: text, conversationId })
      const nextConversationId = data?.conversation_id || conversationId
      const answer = data?.answer || 'Não foi possível gerar uma resposta.'
      if (nextConversationId) setConversationId(nextConversationId)
      setMessages(old => [...old, { role: 'assistant', content: answer }])
    } catch (err) {
      setError(err?.message || 'A IA está temporariamente indisponível.')
    } finally {
      setLoading(false)
    }
  }

  return {
    messages,
    message,
    setMessage,
    loading,
    error,
    submit,
    shouldScrollRef,
  }
}

function AiChatBody({ compact = false, userKey = '' }) {
  const chat = useAiConversation(userKey)
  const messagesRef = useRef(null)

  useEffect(() => {
    const element = messagesRef.current
    if (!element) return

    // Only scroll automatically after the user sends a new message.
    // Manual scrolling through the history must never be interrupted.
    if (!chat.shouldScrollRef.current) return undefined

    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
      chat.shouldScrollRef.current = false
    })

    return () => window.cancelAnimationFrame(frame)
  }, [chat.messages])

  return (
    <>
      <div
        ref={messagesRef}
        className={`ai-assistant-messages ${compact ? 'compact' : ''}`}
        aria-live="polite"
      >
        {!chat.messages.length && (
          <div className="ai-assistant-empty">
            <strong>Como posso ajudar?</strong>
            <p className="muted">Posso mostrar como usar o CRM, ser sua analista comercial e sales coach e analisar oportunidades para te ajudar a vender melhor.</p>
          </div>
        )}

        {chat.messages.map((item, index) => (
          <div key={index} className={`ai-message ${item.role}`}>
            <strong>{item.role === 'assistant' ? 'AXIVA IA' : 'Você'}</strong>
            <AiMessageContent content={item.content} />
          </div>
        ))}

        {chat.loading && (
          <div className="ai-message assistant">
            <strong>AXIVA IA</strong>
            <div className="ai-message-content">Consultando...</div>
          </div>
        )}
      </div>

      {chat.error && <div className="notice error ai-floating-error">{chat.error}</div>}

      <form className={`ai-assistant-form ${compact ? 'compact' : ''}`} onSubmit={chat.submit}>
        <textarea
          value={chat.message}
          onChange={e => chat.setMessage(e.target.value)}
          placeholder="Digite sua pergunta"
          maxLength={4000}
          rows={compact ? 2 : 3}
          onKeyDown={e => {
            if (compact && e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              chat.submit(e)
            }
          }}
        />
        <div className="form-actions">
          <button
            className="primary inline-btn ai-send-button"
            disabled={chat.loading || !chat.message.trim()}
            aria-label="Enviar pergunta para AXIVA IA"
          >
            <Send size={16} />
            {chat.loading ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </form>
    </>
  )
}

export function AiFloatingAssistant({ userEmail }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`ai-floating-root ${open ? 'open' : ''}`}>
      {open && (
        <section className="ai-floating-window" role="dialog" aria-label="AXIVA IA">
          <header className="ai-floating-header">
            <div>
              <strong>AXIVA IA</strong>
              <span>Assistente do AXIVA CRM</span>
            </div>
            <button
              type="button"
              className="ai-floating-close"
              onClick={() => setOpen(false)}
              aria-label="Fechar AXIVA IA"
            >
              <X size={19} />
            </button>
          </header>

          <div className="ai-floating-user">{userEmail}</div>
          <AiChatBody compact userKey={userEmail} />
        </section>
      )}

      <button
        type="button"
        className="ai-floating-trigger"
        onClick={() => setOpen(value => !value)}
        aria-label={open ? 'Fechar AXIVA IA' : 'Abrir AXIVA IA'}
        aria-expanded={open}
      >
        {open ? <X size={24} /> : <MessageCircle size={26} />}
        {!open && (
          <>
            <span className="ai-floating-compact-label" aria-hidden="true">IA</span>
            <img className="ai-floating-wordmark" src="/axiva-ia-wordmark.webp" alt="AXIVA IA" />
          </>
        )}
      </button>
    </div>
  )
}

export default function AiAssistant({ userEmail }) {
  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">ASSISTENTE DE IA DO CRM</span>
          <p className="muted"></p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <section className="panel ai-assistant-panel">
        <div className="notice">
          A IA Axiva não cria campanhas, não envia mensagens e não altera dados do CRM.
        </div>
        <AiChatBody userKey={userEmail} />
      </section>
    </>
  )
}
