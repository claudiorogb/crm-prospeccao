import React, { useState } from 'react'
import { askAxivaAi } from './ai-client'

export default function AiAssistant({ userEmail }) {
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [conversationId, setConversationId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
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

        <div className="ai-assistant-messages" aria-live="polite">
          {!messages.length && (
            <div className="ai-assistant-empty">
              <strong>Como posso ajudar?</strong>
              <p className="muted">Ex.: “Quantos leads estão em cada etapa?” ou “Como faço uma campanha de e-mail?”</p>
            </div>
          )}

          {messages.map((item, index) => (
            <div key={index} className={`ai-message ${item.role}`}>
              <strong>{item.role === 'assistant' ? 'AXIVA IA' : 'Você'}</strong>
              <p>{item.content}</p>
            </div>
          ))}

          {loading && <div className="ai-message assistant"><strong>AXIVA IA</strong><p>Consultando...</p></div>}
        </div>

        {error && <div className="notice error">{error}</div>}

        <form className="ai-assistant-form" onSubmit={submit}>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Digite sua pergunta sobre o AXIVA CRM"
            maxLength={4000}
            rows={3}
          />
          <div className="form-actions">
            <button className="primary inline-btn" disabled={loading || !message.trim()}>
              {loading ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </form>
      </section>
    </>
  )
}
