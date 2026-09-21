from pathlib import Path

path = Path('src/email-marketing.jsx')
source = path.read_text(encoding='utf-8')
old = "        .select('lead_id,marketing_contact_id')\n        .eq('campaign_id', campaign.id)\n"
new = "        .select('lead_id,marketing_contact_id')\n        .eq('campaign_id', campaign.id)\n        .eq('status', 'draft')\n"
if source.count(old) != 1:
    raise SystemExit('Expected single draft recipient loading query not found; refusing change')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
print('Draft now loads only currently selected recipients; archived entries remain preserved.')
