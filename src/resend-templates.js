// Regras do bloco REENVIO: escolher a campanha e, dentro dela, a mensagem exata.

const LABEL_PREVIEW_LENGTH = 60

function isUsable(template) {
  return Boolean(template && template.is_active !== false && !template.deleted_at)
}

// Nome cadastrado da mensagem; se não houver, o começo do texto.
export function templateLabel(template) {
  const name = String(template?.name || '').trim()
  const preview = String(template?.body || '').replace(/\s+/g, ' ').trim()
  const base = name ||
    (preview.length > LABEL_PREVIEW_LENGTH ? `${preview.slice(0, LABEL_PREVIEW_LENGTH).trimEnd()}…` : preview) ||
    'Mensagem sem título'
  return template?.is_default_for_target ? `${base} (padrão)` : base
}

// Todas as mensagens ativas da campanha: a padrão primeiro, depois as mais recentes.
export function templatesForCampaign(templates, targetSegmentId) {
  if (!targetSegmentId) return []
  return (templates || [])
    .filter(template => isUsable(template) && template.target_segment_id === targetSegmentId)
    .sort((a, b) => {
      if (Boolean(a.is_default_for_target) !== Boolean(b.is_default_for_target)) {
        return a.is_default_for_target ? -1 : 1
      }
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })
}

// Com uma única mensagem na campanha ela já vem escolhida; com várias, começa em "Selecione".
export function initialTemplateIdForCampaign(templates, targetSegmentId) {
  const options = templatesForCampaign(templates, targetSegmentId)
  return options.length === 1 ? options[0].id : ''
}

// O que falta para liberar o reenvio ('' quando está tudo certo).
export function resendSelectionProblem(templates, targetSegmentId, templateId) {
  if (!targetSegmentId) return 'Escolha a campanha e a mensagem do reenvio para poder enviar.'
  const options = templatesForCampaign(templates, targetSegmentId)
  if (!options.length) return 'Esta campanha não tem mensagens ativas. Escolha outra campanha.'
  if (!templateId) return 'Escolha qual mensagem desta campanha será enviada.'
  if (!options.some(template => template.id === templateId)) return 'A mensagem escolhida não está mais disponível. Escolha outra.'
  return ''
}
