#!/usr/bin/env python3
"""Apply a narrowly scoped dashboard replacement; abort on repository drift."""
from pathlib import Path

app_path = Path('src/App.jsx')
app = app_path.read_text(encoding='utf-8')
import_anchor = "import { EmailMarketing, AdminEmailMarketing } from './email-marketing'\n"
start_anchor = 'function Dashboard({ organization, userEmail, onGoCampaigns }) {'
end_anchor = '\n\nfunction CatalogAdmin({ userEmail }) {'
if app.count(import_anchor) != 1 or app.count(start_anchor) != 1 or app.count(end_anchor) != 1:
    raise SystemExit('Dashboard integration anchors changed; no files edited')
start = app.index(start_anchor)
end = app.index(end_anchor, start)
if 'get_dashboard_stats' not in app[start:end] or '<TeamPerformance organization={organization} />' not in app[start:end]:
    raise SystemExit('Unexpected dashboard implementation; no files edited')
replacement = """function Dashboard({ organization, userEmail, onGoCampaigns }) {
  return <DashboardVisual organization={organization} userEmail={userEmail} onGoCampaigns={onGoCampaigns} />
}
"""
app = app.replace(import_anchor, import_anchor + "import DashboardVisual from './dashboard-visual'\n", 1)
app = app[:app.index(start_anchor)] + replacement + app[app.index(end_anchor, app.index(start_anchor)):]

# Follow-up counts must be complete even when the agenda contains more than 50 rows.
component_path = Path('src/dashboard-visual.jsx')
component = component_path.read_text(encoding='utf-8')
fixes = [
    ("          supabase.from('leads').select('id,business_name,contact_name,next_contact_date,status,last_contact_date').eq('organization_id', organization.id).is('deleted_at', null).not('next_contact_date', 'is', null).in('status', [...ACTIVE]).order('next_contact_date', { ascending: true }).limit(50)",
     "          allRows(() => supabase.from('leads').select('id,business_name,contact_name,next_contact_date,status,last_contact_date').eq('organization_id', organization.id).is('deleted_at', null).not('next_contact_date', 'is', null).in('status', [...ACTIVE]).order('next_contact_date', { ascending: true }))"),
    ("        if (contactsResult.error) throw contactsResult.error\n", ""),
    ("upcoming: contactsResult.data || []", "upcoming: contactsResult"),
    ("const upcoming = showAllContacts ? state.upcoming : state.upcoming.slice(0, 5)", "const upcoming = showAllContacts ? state.upcoming.slice(0, 50) : state.upcoming.slice(0, 5)"),
    ("{showAllContacts ? 'Ver menos' : 'Ver todos'} <ChevronRight size={15}/>", "{showAllContacts ? 'Ver menos' : 'Ver até 50'} <ChevronRight size={15}/>")
]
for old, new in fixes:
    if component.count(old) != 1:
        raise SystemExit(f'Dashboard data-fix anchor differs ({old[:50]}); no files edited')
    component = component.replace(old, new, 1)
# Do not let imported customers masquerade as leads captured through the funnel.
if component.count("lead.source === 'import' && lead.status === 'won'") < 2:
    raise SystemExit('Imported customer guard missing; no files edited')
app_path.write_text(app, encoding='utf-8')
component_path.write_text(component, encoding='utf-8')
print('Dashboard updated for both sandbox admin and regular company users; no database changes')
