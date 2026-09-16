// Mescla atualizações do servidor sem apagar campos editados e ainda não salvos.
// A proteção é por campo e por lead: mudanças remotas em outros campos continuam visíveis.
export function mergeLeadsWithLocalDrafts(remoteLeads, currentLeads, dirtyByLead) {
  if (!dirtyByLead || !Object.keys(dirtyByLead).length) return remoteLeads

  const currentById = new Map(currentLeads.map(lead => [lead.id, lead]))
  return remoteLeads.map(remoteLead => {
    const currentLead = currentById.get(remoteLead.id)
    const dirtyFields = dirtyByLead[remoteLead.id]
    if (!currentLead || !dirtyFields) return remoteLead

    const localFields = {}
    for (const [field, dirty] of Object.entries(dirtyFields)) {
      if (dirty && Object.prototype.hasOwnProperty.call(currentLead, field)) {
        localFields[field] = currentLead[field]
      }
    }
    return { ...remoteLead, ...localFields }
  })
}
