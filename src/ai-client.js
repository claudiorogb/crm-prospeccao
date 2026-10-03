import { supabase } from './lib/supabase'

/**
 * Cliente preparado para a futura interface da IA.
 * Este módulo não é importado pelo App.jsx na fase de preparação.
 * O tenant nunca é enviado pelo navegador; o backend o resolve pela sessão.
 */
export async function askAxivaAi({ message, conversationId = null }) {
  const text = String(message || '').trim()
  if (!text) throw new Error('Digite uma pergunta.')

  const body = { message: text }
  if (conversationId) body.conversation_id = conversationId

  const { data, error } = await supabase.functions.invoke('crm-ai-chat', { body })

  if (error) {
    try {
      const response = error.context
      if (response && typeof response.clone === 'function') {
        const payload = await response.clone().json()
        if (payload?.error) throw new Error(payload.error)
      }
    } catch (parsedError) {
      if (parsedError?.message) throw parsedError
    }
    throw error
  }

  if (data?.error) throw new Error(data.error)
  return data
}

export async function loadAxivaAiHistory({ conversationId = null } = {}) {
  const body = { action: 'history' }
  if (conversationId) body.conversation_id = conversationId

  const { data, error } = await supabase.functions.invoke('crm-ai-chat', { body })

  if (error) {
    try {
      const response = error.context
      if (response && typeof response.clone === 'function') {
        const payload = await response.clone().json()
        if (payload?.error) throw new Error(payload.error)
      }
    } catch (parsedError) {
      if (parsedError?.message) throw parsedError
    }
    throw error
  }

  if (data?.error) throw new Error(data.error)
  return data
}
