// Sincronia imediata entre Kanban, página Hoje e contadores:
// qualquer alteração de lead avisa as outras telas para recarregarem na hora
// (além das atualizações automáticas periódicas que já existiam).
export const LEADS_CHANGED = 'crm:leads-changed'

export function notifyLeadsChanged() {
  try { window.dispatchEvent(new Event(LEADS_CHANGED)) } catch { /* sem window: ignora */ }
}

export function onLeadsChanged(handler) {
  try {
    window.addEventListener(LEADS_CHANGED, handler)
    return () => window.removeEventListener(LEADS_CHANGED, handler)
  } catch {
    return () => {}
  }
}
