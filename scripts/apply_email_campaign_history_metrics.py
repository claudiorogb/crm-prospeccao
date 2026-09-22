from pathlib import Path

app = Path('src/email-marketing.jsx')
css = Path('src/email-marketing.css')
s = app.read_text(encoding='utf-8')
style = css.read_text(encoding='utf-8')

old_import = "import NewsletterMailingPanel from './newsletter-mailing-panel'\n"
assert s.count(old_import) == 1, 'Import anchor changed; refusing to patch'
s = s.replace(old_import, old_import + "import EmailCampaignHistory from './email-campaign-history'\n", 1)

old_select = "'id,name,subject,body_text,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at'"
assert s.count(old_select) == 1, 'Campaign select anchor changed; refusing to patch'
s = s.replace(old_select, "'id,name,subject,body_text,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at,metrics_enabled'", 1)

start = '            {campaigns.map(campaign => (\n              <article className="email-campaign-row" key={campaign.id}>'
end = '            ))}\n          </div>\n        )}'
assert s.count(start) == 1 and s.count(end) >= 1, 'History anchors changed; refusing to patch'
i = s.index(start)
j = s.index(end, i) + len('            ))}')
replacement = '''            {campaigns.map(campaign => (
              <EmailCampaignHistory
                key={campaign.id}
                campaign={campaign}
                organizationId={organization.id}
                busy={loading}
                onContinue={continueDraft}
                onCancel={cancelCampaign}
                onResend={resendCampaign}
              />
            ))}'''
s = s[:i] + replacement + s[j:]
app.write_text(s, encoding='utf-8')

style += '''
/* Campaign history: compact title/date only until expanded. */
.email-campaign-history-item { border: 1px solid var(--border, #e2e8f0); border-radius: 10px; background: #fff; overflow: hidden; }
.email-campaign-history-summary { display: flex; justify-content: space-between; align-items: center; gap: 12px; cursor: pointer; padding: 14px 16px; list-style: none; }
.email-campaign-history-summary::-webkit-details-marker { display: none; }
.email-campaign-history-summary strong { min-width: 0; overflow-wrap: anywhere; }
.email-campaign-history-summary time { color: #475569; font-size: .85rem; text-align: right; white-space: nowrap; }
.email-campaign-history-body { border-top: 1px solid #e2e8f0; padding: 16px; }
.email-campaign-history-body p { margin: 0 0 10px; overflow-wrap: anywhere; }
.email-campaign-history-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 16px 0; }
.email-campaign-history-metrics > div { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; display: grid; gap: 5px; }
.email-campaign-history-metrics span { font-size: .82rem; color: #475569; }
.email-campaign-history-metrics strong { font-size: 1.1rem; }
.email-campaign-history-scroll { overflow-x: auto; max-height: 440px; overflow-y: auto; }
.email-campaign-history-scroll table { width: 100%; border-collapse: collapse; text-align: left; }
.email-campaign-history-scroll th, .email-campaign-history-scroll td { padding: 9px; border-bottom: 1px solid #e2e8f0; overflow-wrap: anywhere; }
.email-campaign-history-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
@media(max-width:600px) { .email-campaign-history-summary { align-items: flex-start; } .email-campaign-history-summary time { white-space: normal; } }
'''
css.write_text(style, encoding='utf-8')
print('History UI patch applied only to src/email-marketing.jsx and src/email-marketing.css')
