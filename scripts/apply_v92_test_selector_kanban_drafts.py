"""V92: reveal Teste in operational admin selectors and preserve unsaved Kanban edits.

Small, guarded source replacements only. Existing tenant data, roles, quotas and
production configuration remain unchanged. Abort before writing if App changed.
"""
from pathlib import Path

app = Path('src/App.jsx')
text = app.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}; App.jsx unchanged')
    text = text.replace(old, new, 1)


replace_once(
    "import CustomerImportPanel from './customer-import'\n",
    "import CustomerImportPanel from './customer-import'\nimport { mergeLeadsWithLocalDrafts } from './kanban-draft-merge.js'\n",
    'Kanban draft merge import'
)

# Scope the change to the Kanban loader. Polling must not override unsaved fields
# while still accepting updates to the other fields and leads from the server.
start = text.index('  async function loadAllLeads(currentFilter = filter) {')
end = text.index('\n  async function loadData() {', start)
kanban_loader = text[start:end]
old = '      setLeads(rows)\n      setTotalLeads(rows.length)'
new = '''      setLeads(previous => mergeLeadsWithLocalDrafts(rows, previous, dirtyLeadFieldsRef.current))
      setTotalLeads(rows.length)'''
if kanban_loader.count(old) != 1:
    raise SystemExit('Kanban reload anchor changed; App.jsx unchanged')
text = text[:start] + kanban_loader.replace(old, new, 1) + text[end:]

# Operational selectors show all organizations, including Teste. Keep the
# administration overview, general user assignment and organization maintenance
# scoped to production to avoid accidental cross-tenant edits or mixed metrics.
start = text.index('function Administration({ organizations, reloadOrganizations, userEmail, userId }) {')
end = text.index('\nexport default function App() {', start)
admin = text[start:end]
operations = {
    'whatsapp': 'AdminWhatsApp',
    'email': 'AdminEmailMarketing',
    'queue': 'AdminQueue',
    'google': 'AdminGooglePlaces',
    'integrations': 'AdminIntegrations',
    'defaults': 'AdminDefaults',
    'messages': 'AdminMessages',
}
for section, component in operations.items():
    old = f"{{section === '{section}' && <{component} organizations={{productionOrganizations}}"
    new = f"{{section === '{section}' && <{component} organizations={{organizations}}"
    if admin.count(old) != 1:
        raise SystemExit(f'Admin {section} selector anchor changed; App.jsx unchanged')
    admin = admin.replace(old, new, 1)

for section, component in [('overview', 'AdminOverview'), ('users', 'AdminUsers'), ('clients', 'AdminClients'), ('audit', 'AdminAudit')]:
    marker = f"{{section === '{section}' && <{component} organizations={{productionOrganizations}}"
    if admin.count(marker) != 1:
        raise SystemExit(f'Protected production-only {section} changed; App.jsx unchanged')

text = text[:start] + admin + text[end:]
assert text.count("import { mergeLeadsWithLocalDrafts } from './kanban-draft-merge.js'") == 1
assert text.count('setLeads(previous => mergeLeadsWithLocalDrafts(rows, previous, dirtyLeadFieldsRef.current))') == 1
assert all(f"{{section === '{key}' && <{component} organizations={{organizations}}" in text for key, component in operations.items())
app.write_text(text, encoding='utf-8')
print('V92 guarded UI patch applied: Teste selectors visible; Kanban drafts preserved; administrative totals unchanged.')
