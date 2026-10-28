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

// O que falta escolher em um par Campanha + Mensagem ('' quando está tudo certo).
export function templateSelectionProblem(templates, targetSegmentId, templateId, missingBothText) {
  if (!targetSegmentId) return missingBothText
  const options = templatesForCampaign(templates, targetSegmentId)
  if (!options.length) return 'Esta campanha não tem mensagens ativas. Escolha outra campanha.'
  if (!templateId) return 'Escolha qual mensagem desta campanha será enviada.'
  if (!options.some(template => template.id === templateId)) return 'A mensagem escolhida não está mais disponível. Escolha outra.'
  return ''
}

// O que falta para liberar o reenvio ('' quando está tudo certo).
export function resendSelectionProblem(templates, targetSegmentId, templateId) {
  return templateSelectionProblem(templates, targetSegmentId, templateId, 'Escolha a campanha e a mensagem do reenvio para poder enviar.')
}

// Formulário "Adicionar destinatário manualmente": diz exatamente o que falta preencher.
export function manualRecipientProblem(form, templates) {
  const missing = [
    ['nome', form?.contact_name],
    ['telefone', form?.phone],
    ['empresa', form?.business_name],
    ['campanha', form?.target_segment_id],
    ['mensagem', form?.template_id]
  ].filter(([, value]) => !String(value || '').trim()).map(([label]) => label)
  if (missing.length) {
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} e ${missing.at(-1)}`
    return `Para adicionar o destinatário, preencha: ${list}.`
  }
  return templateSelectionProblem(templates, form.target_segment_id, form.template_id, '')
}

// A mensagem escolhida para o lead (send_template_id) ainda pode ser usada?
export function chosenTemplateAvailable(templates, lead) {
  return templatesForCampaign(templates, lead?.target_segment_id).some(template => template.id === lead?.send_template_id)
}

// Separa os leads do envio normal: sem mensagem escolhida (servidor usa a da campanha, como sempre)
// e com mensagem escolhida (agrupados por template_id). Mensagens indisponíveis bloqueiam o envio.
export function planChosenTemplateSend(leads, templates) {
  const campaignLeadIds = []
  const groups = new Map()
  const unavailable = []
  for (const lead of leads || []) {
    if (!lead?.send_template_id) {
      campaignLeadIds.push(lead.id)
      continue
    }
    if (!chosenTemplateAvailable(templates, lead)) {
      unavailable.push(lead)
      continue
    }
    const key = `${lead.send_template_id}|${lead.target_segment_id}`
    if (!groups.has(key)) {
      groups.set(key, { templateId: lead.send_template_id, targetSegmentId: lead.target_segment_id, ids: [] })
    }
    groups.get(key).ids.push(lead.id)
  }
  return { campaignLeadIds, templateGroups: [...groups.values()], unavailable }
}
