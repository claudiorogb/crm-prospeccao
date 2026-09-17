"""Apply a narrowly scoped per-login overdue notice change.

No schema, RLS, database data, overdue eligibility, or business features change.
The script refuses to write if the expected V95 code has changed.
"""
from pathlib import Path

app_path = Path('src/App.jsx')
test_path = Path('tests/overdue-popup-v95.test.mjs')
app = app_path.read_text(encoding='utf-8')
test = test_path.read_text(encoding='utf-8')

patches = [
    (
        'function formatPhone(value) {',
        '''function resetOverdueLoginAlerts() {
  // These flags are UI-only; never store tokens or other credentials here.
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index)
    if (key?.startsWith('crm_overdue_login_alert_') || key?.startsWith('crm_overdue_alert_')) {
      sessionStorage.removeItem(key)
    }
  }
}

function formatPhone(value) {''',
    ),
    (
        '''      } else {
        const { error } = await supabase.auth.signInWithPassword({''',
        '''      } else {
        // Reset before auth emits SIGNED_IN, so a fresh login can show its notice.
        resetOverdueLoginAlerts()
        const { error } = await supabase.auth.signInWithPassword({''',
    ),
    (
        '''    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)''',
        '''    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') resetOverdueLoginAlerts()
      setSession(newSession)''',
    ),
    (
        'function OverdueReturnsAlert({ organization, onOpen }) {',
        'function OverdueReturnsAlert({ organization, onOpen, userId }) {',
    ),
    (
        '''      const key = `crm_overdue_alert_${organization.id}_${currentBrazilDate()}`
      if (sessionStorage.getItem(key)) return''',
        '''      if (!userId) return
      const key = `crm_overdue_login_alert_${userId}_${organization.id}`
      if (sessionStorage.getItem(key)) return''',
    ),
    (
        '''  }, [organization.id])

  if (!visible) return null

  return (
    <aside className="overdue-alert-v45" role="status">''',
        '''  }, [organization.id, userId])

  if (!visible) return null

  return (
    <aside className="overdue-alert-v45" role="status">''',
    ),
    (
        '''              organization={sandboxOrganization}
              onOpen={() => { setAdminCommercialPage('overdue-returns'); setMobileMenuOpen(false) }}
            />''',
        '''              organization={sandboxOrganization}
              userId={session.user.id}
              onOpen={() => { setAdminCommercialPage('overdue-returns'); setMobileMenuOpen(false) }}
            />''',
    ),
    (
        '''<OverdueReturnsAlert organization={organization} onOpen={() => setPage('overdue-returns')} />''',
        '''<OverdueReturnsAlert organization={organization} userId={session.user.id} onOpen={() => setPage('overdue-returns')} />''',
    ),
]

old_test = "  assert.match(popup, /crm_overdue_alert_\\$\\{organization\\.id\\}_\\$\\{currentBrazilDate\\(\\)\\}/)"
new_test = "  assert.match(popup, /crm_overdue_login_alert_\\$\\{userId\\}_\\$\\{organization\\.id\\}/)"
old_customer_test = "  assert.match(customerMode, /<OverdueReturnsAlert organization=\\{organization\\} onOpen=\\{\\(\\) => setPage\\('overdue-returns'\\)\\} \\/>/)"
new_customer_test = "  assert.match(customerMode, /<OverdueReturnsAlert organization=\\{organization\\} userId=\\{session\\.user\\.id\\} onOpen=\\{\\(\\) => setPage\\('overdue-returns'\\)\\} \\/>/)"

# Validate every anchor first: never write a partial patch.
for before, after in patches:
    if app.count(before) != 1 or (after in app and before != after):
        raise SystemExit(f'V96 stopped: expected exactly one unchanged App.jsx anchor: {before[:95]!r}')
for before in (old_test, old_customer_test):
    if test.count(before) != 1:
        raise SystemExit(f'V96 stopped: V95 regression test changed: {before[:90]!r}')

for before, after in patches:
    app = app.replace(before, after, 1)
test = test.replace(old_test, new_test, 1).replace(old_customer_test, new_customer_test, 1)

app_path.write_text(app, encoding='utf-8')
test_path.write_text(test, encoding='utf-8')
print('V96 patched only App.jsx and the existing popup regression assertions')
