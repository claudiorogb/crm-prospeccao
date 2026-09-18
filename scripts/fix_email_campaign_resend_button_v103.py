from pathlib import Path

page = Path('src/email-marketing.jsx')
css = Path('src/email-marketing.css')
source = page.read_text(encoding='utf-8')
old = '''                ) : campaign.status === 'completed' ? (
                  <button type="button" className="secondary" disabled={loading} onClick={() => resendCampaign(campaign)}>Reenviar</button>
                ) : ['queued','sending','paused','failed'].includes(campaign.status) ? ('''
new = '''                ) : campaign.status === 'completed' ? (
                  <div className="email-campaign-actions">
                    <button type="button" className="secondary email-resend-campaign-button" disabled={loading} onClick={() => resendCampaign(campaign)}>Reenviar campanha</button>
                  </div>
                ) : ['queued','sending','paused','failed'].includes(campaign.status) ? ('''
assert source.count(old) == 1, 'O trecho de reenvio mudou; abortando sem alterar funcionalidades.'
assert 'async function resendCampaign(campaign)' in source
assert "supabase.rpc('clone_email_campaign_for_resend'" in source
assert 'await continueDraft(draft)' in source
page.write_text(source.replace(old, new, 1), encoding='utf-8')

style = css.read_text(encoding='utf-8')
addition = '''\n/* V103: ação de reenvio identificável e alinhada ao histórico, sem alterar a lógica. */
.email-history-panel .email-campaign-row > .email-campaign-actions {
  justify-self: end;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: max-content;
}
.email-history-panel .email-campaign-actions .email-resend-campaign-button {
  display: inline-flex !important;
  visibility: visible !important;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  min-width: 145px;
}
@media (max-width: 700px) {
  .email-history-panel .email-campaign-row > .email-campaign-actions {
    justify-self: start;
    min-width: 0;
    justify-content: flex-start;
  }
}
'''
assert '/* V103: ação de reenvio' not in style, 'Estilo já aplicado; abortando.'
css.write_text(style + addition, encoding='utf-8')
print('V103: somente botão e alinhamento do histórico alterados.')
