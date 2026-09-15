from pathlib import Path
import re

p = Path('src/email-marketing.jsx')
s = p.read_text(encoding='utf-8')

old = "  const [loading, setLoading] = useState(false)\n"
new = "  const [loading, setLoading] = useState(false)\n  const [draftCampaignId, setDraftCampaignId] = useState(null)\n"
assert old in s
s = s.replace(old, new, 1)

old = "supabase.from('email_campaigns').select('id,name,subject,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at')"
new = "supabase.from('email_campaigns').select('id,name,subject,body_text,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at')"
assert old in s
s = s.replace(old, new, 1)

pattern = re.compile(r"  async function createCampaign\(event\) \{.*?\n  async function cancelCampaign", re.S)
replacement = '''  async function createCampaign(event) {
    event.preventDefault()
    if (draftCampaignId) return setMessage('Esta campanha já foi salva. Escolha os destinatários e depois inicie o envio.')
    if (connection?.status !== 'connected') return setMessage('Conecte uma conta Gmail ou Resend antes de criar uma campanha.')
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) return setMessage('Nome da campanha, assunto e mensagem são obrigatórios.')
    if (filesTotal > MAX_TOTAL_BYTES) return setMessage('O total de anexos excede 15 MB.')

    setLoading(true); setMessage('')
    let campaignId = null
    const uploaded = []
    try {
      const { data, error } = await supabase.rpc('create_email_campaign_v2', {
        p_organization_id: organization.id,
        p_name: form.name.trim(),
        p_subject: form.subject.trim(),
        p_body_text: form.body,
        p_client_ids: [],
        p_marketing_contact_ids: []
      })
      if (error) throw error
      campaignId = data

      for (const file of files) {
        const path = `${organization.id}/${campaignId}/${crypto.randomUUID()}-${cleanFilename(file.name)}`
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
        if (uploadError) throw uploadError
        uploaded.push(path)
        const { error: registerError } = await supabase.rpc('register_email_campaign_attachment', {
          p_campaign_id: campaignId,
          p_storage_path: path,
          p_file_name: file.name,
          p_mime_type: file.type || 'application/octet-stream',
          p_size_bytes: file.size
        })
        if (registerError) throw registerError
      }

      setDraftCampaignId(campaignId)
      setSelected(new Set())
      setSelectedMarketing(new Set())
      setFiles([])
      setMessage('Campanha salva como rascunho. Agora escolha os destinatários e, quando estiver pronto, inicie o envio.')
      await loadData()
    } catch (error) {
      if (campaignId) {
        try { await supabase.rpc('cancel_email_campaign', { p_campaign_id: campaignId }) } catch {}
      }
      if (uploaded.length) {
        try { await supabase.storage.from(BUCKET).remove(uploaded) } catch {}
      }
      setMessage(error.message || 'Não foi possível salvar a campanha.')
    } finally {
      setLoading(false)
    }
  }

  async function saveRecipients(startSending = false) {
    if (!draftCampaignId) return setMessage('Salve a campanha antes de escolher os destinatários.')
    if (!selectedTotal) return setMessage('Selecione pelo menos um destinatário.')
    setLoading(true); setMessage('')
    try {
      const { data, error } = await supabase.rpc('set_email_campaign_recipients', {
        p_campaign_id: draftCampaignId,
        p_client_ids: selectedClients.map(c => c.id),
        p_marketing_contact_ids: selectedMarketingContacts.map(c => c.id)
      })
      if (error) throw error
      const savedCount = Number(data || 0)
      if (startSending) {
        const { error: queueError } = await supabase.rpc('queue_email_campaign', { p_campaign_id: draftCampaignId })
        if (queueError) throw queueError
        setMessage(`Campanha iniciada com ${savedCount} destinatário${savedCount === 1 ? '' : 's'}.`)
        setDraftCampaignId(null)
        setForm({ name: '', subject: '', body: '' })
        setSelected(new Set())
        setSelectedMarketing(new Set())
      } else {
        setMessage(`${savedCount} destinatário${savedCount === 1 ? '' : 's'} salvo${savedCount === 1 ? '' : 's'} no rascunho.`)
      }
      await loadData()
    } catch (error) {
      setMessage(error.message || 'Não foi possível salvar os destinatários.')
    } finally {
      setLoading(false)
    }
  }

  async function continueDraft(campaign) {
    setLoading(true); setMessage('')
    try {
      const { data, error } = await supabase
        .from('email_campaign_recipients')
        .select('lead_id,marketing_contact_id')
        .eq('campaign_id', campaign.id)
      if (error) throw error
      setDraftCampaignId(campaign.id)
      setForm({ name: campaign.name || '', subject: campaign.subject || '', body: campaign.body_text || '' })
      setSelected(new Set((data || []).map(r => r.lead_id).filter(Boolean)))
      setSelectedMarketing(new Set((data || []).map(r => r.marketing_contact_id).filter(Boolean)))
      setFiles([])
      setMessage('Rascunho aberto. Revise ou escolha os destinatários e inicie o envio quando estiver pronto.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setMessage(error.message || 'Não foi possível abrir o rascunho.')
    } finally {
      setLoading(false)
    }
  }

  async function cancelCampaign'''

s, n = pattern.subn(replacement, s, count=1)
assert n == 1, n

# Recipient selection is only shown after the campaign has been saved.
old = '        <div className="email-recipient-box">\n'
new = '        {draftCampaignId && (\n        <div className="email-recipient-box">\n'
assert old in s
s = s.replace(old, new, 1)

old_actions = '''        <div className="form-actions">
          <button className="primary" disabled={loading || connection?.status !== 'connected' || selectedTotal === 0}>{loading ? 'Processando...' : 'Criar campanha e iniciar fila'}</button>
          <span className="muted">Se a campanha ultrapassar o limite diário, os demais envios continuam automaticamente nos dias seguintes.</span>
        </div>'''
new_actions = '''        )}

        <div className="form-actions email-draft-actions">
          {!draftCampaignId ? (
            <>
              <button className="primary" disabled={loading || connection?.status !== 'connected'}>{loading ? 'Salvando...' : 'Salvar campanha'}</button>
              <span className="muted">Depois de salvar, você escolherá os destinatários antes de iniciar o envio.</span>
            </>
          ) : (
            <>
              <button type="button" className="secondary" disabled={loading || selectedTotal === 0} onClick={() => saveRecipients(false)}>Salvar destinatários</button>
              <button type="button" className="primary" disabled={loading || selectedTotal === 0} onClick={() => saveRecipients(true)}>{loading ? 'Processando...' : 'Iniciar envio'}</button>
              <span className="muted">{selectedTotal} destinatário{selectedTotal === 1 ? '' : 's'} selecionado{selectedTotal === 1 ? '' : 's'}.</span>
            </>
          )}
        </div>'''
assert old_actions in s
s = s.replace(old_actions, new_actions, 1)

old_history = """                {['draft','queued','sending','paused','failed'].includes(campaign.status) && <button type=\"button\" className=\"secondary\" disabled={loading} onClick={() => cancelCampaign(campaign.id)}>Cancelar</button>}"""
new_history = """                {campaign.status === 'draft' ? (
                  <div className=\"email-campaign-actions\">
                    <button type=\"button\" className=\"secondary\" disabled={loading} onClick={() => continueDraft(campaign)}>Continuar</button>
                    <button type=\"button\" className=\"secondary\" disabled={loading} onClick={() => cancelCampaign(campaign.id)}>Cancelar</button>
                  </div>
                ) : ['queued','sending','paused','failed'].includes(campaign.status) ? (
                  <button type=\"button\" className=\"secondary\" disabled={loading} onClick={() => cancelCampaign(campaign.id)}>Cancelar</button>
                ) : null}"""
assert old_history in s
s = s.replace(old_history, new_history, 1)

p.write_text(s, encoding='utf-8')

css = Path('src/email-marketing.css')
c = css.read_text(encoding='utf-8')
append = '''\n/* V89 — campanha em rascunho antes da seleção de destinatários */
.email-draft-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.email-draft-actions .primary,.email-draft-actions .secondary{width:auto!important}.email-campaign-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}@media(max-width:700px){.email-draft-actions .primary,.email-draft-actions .secondary{width:100%!important}.email-campaign-actions{justify-content:flex-start}}\n'''
if 'V89 — campanha em rascunho' not in c:
    c += append
css.write_text(c, encoding='utf-8')

print('V89 patch applied')
