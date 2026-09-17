import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const part = (start, end) => {
  const first = app.indexOf(start)
  assert.notEqual(first, -1, `Missing: ${start}`)
  const last = app.indexOf(end, first + start.length)
  assert.notEqual(last, -1, `Missing: ${end}`)
  return app.slice(first, last)
}
const popup = part('function OverdueReturnsAlert(', 'function OverdueReturnsPage(')
const auth = part('function AuthScreen()', 'function ResetPasswordScreen(')
const lifecycle = part('supabase.auth.getSession()', 'return () => listener.subscription.unsubscribe()')
const admin = part('if (isSystemAdmin && !organization) {', 'if (!organization) {')
const tenants = app.slice(app.indexOf('if (!organization) {', app.indexOf('if (isSystemAdmin && !organization) {')))

test('each explicit successful password login resets alerts before SIGNED_IN can render', () => {
  assert.match(auth, /resetOverdueLoginAlerts\(\)\s*const \{ error \} = await supabase\.auth\.signInWithPassword\(/)
  assert.match(lifecycle, /if \(event === 'SIGNED_OUT'\) resetOverdueLoginAlerts\(\)/)
  assert.doesNotMatch(lifecycle, /if \(event === 'TOKEN_REFRESHED'\) resetOverdueLoginAlerts\(\)/)
})

test('alert marker is unique per authenticated user and organization, not per day', () => {
  assert.match(popup, /function OverdueReturnsAlert\(\{ organization, onOpen, userId \}\)/)
  assert.match(popup, /if \(!userId\) return/)
  assert.match(popup, /`crm_overdue_login_alert_\$\{userId\}_\$\{organization\.id\}`/)
  assert.doesNotMatch(popup, /`crm_overdue_alert_\$\{organization\.id\}_\$\{currentBrazilDate\(\)\}`/)
  assert.match(popup, /if \(sessionStorage\.getItem\(key\)\) return/)
  assert.match(popup, /if \(!mounted \|\| !total\) return\s*sessionStorage\.setItem\(key, '1'\)/)
  assert.match(popup, /\}, \[organization\.id, userId\]\)/)
})

test('reset clears only old and current popup markers, not unrelated application state', () => {
  const helper = part('function resetOverdueLoginAlerts()', 'function formatPhone(')
  const entries = new Map([
    ['crm_overdue_alert_org_2026-09-17', '1'],
    ['crm_overdue_login_alert_user_org', '1'],
    ['crm_focus_lead', '{"id":"sample"}'],
    ['other_app_state', 'keep'],
  ])
  const sessionStorage = {
    get length() { return entries.size },
    key(index) { return [...entries.keys()][index] ?? null },
    removeItem(key) { entries.delete(key) },
  }
  vm.runInNewContext(`${helper}\nresetOverdueLoginAlerts()`, { sessionStorage })
  assert.deepEqual([...entries], [['crm_focus_lead', '{"id":"sample"}'], ['other_app_state', 'keep']])
})

test('system admin test workspace and all tenant users receive their own identity-scoped popup', () => {
  assert.match(admin, /commercialMode && sandboxOrganization && adminSandboxSettings && \(\s*<OverdueReturnsAlert\s+organization=\{sandboxOrganization\}\s+userId=\{session\.user\.id\}/)
  assert.match(tenants, /<OverdueReturnsAlert organization=\{organization\} userId=\{session\.user\.id\}/)
  assert.equal((admin.match(/<OverdueReturnsAlert/g) || []).length, 1)
  assert.equal((tenants.match(/<OverdueReturnsAlert/g) || []).length, 1)
})

test('existing overdue and tenant isolation criteria remain unchanged', () => {
  assert.match(popup, /\.eq\('organization_id', organization\.id\)/)
  assert.match(popup, /\.lt\('next_contact_date', currentBrazilDate\(\)\)/)
  assert.match(popup, /filter\(isOverdueReturn\)/)
  assert.match(popup, /setCount\(total\)\s*setVisible\(true\)/)
})
