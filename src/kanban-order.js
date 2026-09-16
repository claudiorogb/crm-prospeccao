// Um cartão permanece na posição definida pela entrada na fase atual.
// Editar outros campos não altera a posição; empate usa o ID para ordem estável.
export function compareLeadsByStageArrival(a, b) {
  const dateOf = lead => {
    const value = Date.parse(lead.status_changed_at || lead.created_at || '')
    return Number.isFinite(value) ? value : 0
  }
  const difference = dateOf(a) - dateOf(b)
  if (difference !== 0) return difference
  const aId = String(a.id || '')
  const bId = String(b.id || '')
  return aId < bId ? -1 : aId > bId ? 1 : 0
}

export function sortKanbanColumn(leads) {
  return [...leads].sort(compareLeadsByStageArrival)
}
