// Motivos estruturados de perda e de não interesse. Funções puras.
export const LOSS_REASONS = [
  ['price', 'Preço'],
  ['competitor', 'Fechou com concorrente'],
  ['no_budget', 'Sem orçamento'],
  ['no_response', 'Parou de responder'],
  ['timing', 'Não é o momento'],
  ['no_need', 'Não tem necessidade'],
  ['has_crm', 'Já tem CRM de outra empresa'],
  ['other', 'Outro']
]

export const LOSS_REASON_LABEL = Object.fromEntries(LOSS_REASONS)

export function lossReasonLabel(code) {
  return LOSS_REASON_LABEL[code] || ''
}

export function lossReasonPromptText(title) {
  const lines = LOSS_REASONS.map(([, label], index) => `${index + 1} - ${label}`)
  return `${title}\n\n${lines.join('\n')}\n\nDigite o número (pode acrescentar uma observação depois, ex.: "1 achou caro").`
}

// Interpreta a resposta: "2", "2 observação" ou texto livre (vira "Outro" com a nota).
export function parseLossReasonAnswer(answer) {
  const text = String(answer ?? '').trim()
  if (!text) return null
  const match = text.match(/^(\d+)\s*[-:.]?\s*(.*)$/s)
  if (match) {
    const entry = LOSS_REASONS[Number(match[1]) - 1]
    if (entry) return { code: entry[0], note: match[2].trim() }
  }
  return { code: 'other', note: text }
}
