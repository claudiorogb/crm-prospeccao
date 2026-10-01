import React, { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { askAxivaAi } from './ai-client'

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

function useAiConversation() {
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [conversationId, setConversationId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e?.preventDefault?.()
    const text = message.trim()
    if (!text || loading) return

    setLoading(true)
    setError('')
    setMessages(old => [...old, { role: 'user', content: text }])
    setMessage('')

    try {
      const data = await askAxivaAi({ message: text, conversationId })
      if (data?.conversation_id) setConversationId(data.conversation_id)
      setMessages(old => [...old, { role: 'assistant', content: data?.answer || 'Não foi possível gerar uma resposta.' }])
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
  }
}

function AiChatBody({ compact = false }) {
  const chat = useAiConversation()
  const messagesRef = useRef(null)

  useEffect(() => {
    const element = messagesRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [chat.messages, chat.loading])

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
            <p className="muted">Pergunte sobre esta tela, o CRM ou seus dados comerciais autorizados.</p>
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
          <AiChatBody compact />
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
        {!open && <span>AXIVA IA</span>}
      </button>
    </div>
  )
}

export default function AiAssistant({ userEmail }) {
  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">ASSISTENTE</span>
          <h1>IA do AXIVA CRM</h1>
          <p className="muted">Tire dúvidas sobre o CRM e consulte informações autorizadas da sua empresa.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      <section className="panel ai-assistant-panel">
        <div className="notice">
          A IA está em modo somente leitura. Ela não cria campanhas, não envia mensagens e não altera dados do CRM.
        </div>
        <AiChatBody />
      </section>
    </>
  )
}
