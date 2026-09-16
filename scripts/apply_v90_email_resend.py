from pathlib import Path

path = Path('src/email-marketing.jsx')
text = path.read_text(encoding='utf-8')

anchor = "  async function cancelCampaign(id) {\n"
insert = """  async function resendCampaign(campaign) {\n    if (draftCampaignId) {\n      setMessage('Finalize o rascunho atualmente aberto antes de preparar outro reenvio.')\n      return\n    }\n    if (!window.confirm('Criar um novo rascunho desta campanha para revisar os destinatários antes de reenviar?')) return\n    setLoading(true); setMessage('')\n    try {\n      const { data: newCampaignId, error } = await supabase.rpc('clone_email_campaign_for_resend', { p_campaign_id: campaign.id })\n      if (error) throw error\n      const { data: draft, error: draftError } = await supabase\n        .from('email_campaigns')\n        .select('id,name,subject,body_text,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at,source_campaign_id')\n        .eq('id', newCampaignId)\n        .single()\n      if (draftError) throw draftError\n      await continueDraft(draft)\n      await loadData()\n      setMessage('Reenvio preparado como rascunho. Revise os destinatários e clique em Iniciar envio quando estiver pronto. Os anexos da campanha original serão mantidos.')\n    } catch (error) {\n      setMessage(error.message || 'Não foi possível preparar o reenvio desta campanha.')\n    } finally {\n      setLoading(false)\n    }\n  }\n\n"""
if 'async function resendCampaign(campaign)' not in text:
    if anchor not in text:
        raise SystemExit('cancelCampaign anchor not found')
    text = text.replace(anchor, insert + anchor, 1)

old = """                ) : ['queued','sending','paused','failed'].includes(campaign.status) ? (\n                  <button type=\"button\" className=\"secondary\" disabled={loading} onClick={() => cancelCampaign(campaign.id)}>Cancelar</button>\n                ) : null}\n"""
new = """                ) : campaign.status === 'completed' ? (\n                  <button type=\"button\" className=\"secondary\" disabled={loading} onClick={() => resendCampaign(campaign)}>Reenviar</button>\n                ) : ['queued','sending','paused','failed'].includes(campaign.status) ? (\n                  <button type=\"button\" className=\"secondary\" disabled={loading} onClick={() => cancelCampaign(campaign.id)}>Cancelar</button>\n                ) : null}\n"""
if 'onClick={() => resendCampaign(campaign)}>Reenviar</button>' not in text:
    if old not in text:
        raise SystemExit('history action anchor not found')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('V90 resend UI patch applied')
