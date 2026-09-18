"""Install AXIVA monitoring in the system administrator navigation only.

Fails before writing if any App.jsx anchor changed. Never touches customer/tenant views,
credentials, existing data permissions, or business records.
"""
from pathlib import Path

app = Path('src/App.jsx')
original = app.read_text(encoding='utf-8')
text = original


def replace_once(old, new, label):
    global text
    found = text.count(old)
    if found != 1:
        raise SystemExit(f'{label}: expected exactly one anchor; found {found}; App.jsx unchanged')
    text = text.replace(old, new, 1)


replace_once(
    "import CustomerImportPanel from './customer-import'\n",
    "import CustomerImportPanel from './customer-import'\nimport AdminHealthMonitor from './admin-health-monitor'\n",
    'admin monitoring import',
)
replace_once(
    "    ['audit', 'Auditoria', History]\n",
    "    ['audit', 'Auditoria', History],\n    ['health', 'Saúde do sistema', Activity]\n",
    'platform administration menu',
)
replace_once(
    "          {section === 'audit' && <AdminAudit organizations={productionOrganizations} userEmail={userEmail} />}\n",
    "          {section === 'audit' && <AdminAudit organizations={productionOrganizations} userEmail={userEmail} />}\n          {section === 'health' && <AdminHealthMonitor />}\n",
    'platform administration route',
)

assert text.count('import AdminHealthMonitor') == 1
assert text.count("['health', 'Saúde do sistema', Activity]") == 1
assert text.count("{section === 'health' && <AdminHealthMonitor />}") == 1
app.write_text(text, encoding='utf-8')
print('AXIVA V104: administrative monitoring navigation installed safely.')
