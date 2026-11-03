import React, { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { supabase } from './lib/supabase'

// "Responder com IA": a IA só SUGERE um texto. O texto vai para a caixa de mensagem
// e o usuário decide se edita e envia. Nunca envia sozinho.
export async function requestAiReplySuggestion(conversationId) {
  const { data, error } = await supabase.functions.invoke('whatsapp-ai-reply', {
    body: { conversation_id: conversationId }
  })
  if (error) {
    let message = ''
    try {
      const payload = await error.context?.json?.()
      message = payload?.error || ''
    } catch {
      message = ''
    }
    throw new Error(message || 'Não foi possível gerar a sugestão agora.')
  }
  if (data?.error) throw new Error(data.error)
  const suggestion = String(data?.suggestion || '').trim()
  if (!suggestion) throw new Error('A IA não retornou uma sugestão.')
  return suggestion
}

export default function AiReplyButton({ conversationId, disabled, onSuggestion, onError, onStart }) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    if (busy || disabled || !conversationId) return
    setBusy(true)
    onStart?.()
    try {
      const suggestion = await requestAiReplySuggestion(conversationId)
      onSuggestion(suggestion)
    } catch (error) {
      onError?.(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="secondary mini wa-ai-reply-btn"
      onClick={handleClick}
      disabled={busy || disabled || !conversationId}
      title="A IA sugere uma resposta curta. Você revisa e decide se envia."
    >
      <Sparkles size={15}/> {busy ? 'Pensando...' : 'Responder com IA'}
    </button>
  )
}
