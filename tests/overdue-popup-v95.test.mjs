import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const testMode = app.slice(app.indexOf("if (isSystemAdmin && !organization) {"), app.indexOf("if (!organization) {", app.indexOf("if (isSystemAdmin && !organization) {")))
const customerMode = app.slice(app.indexOf("if (!organization) {", app.indexOf("if (isSystemAdmin && !organization) {")))

test('admin sandbox uses popup only in commercial test mode and only for the sandbox organization', () => {
  assert.match(testMode, /commercialMode && sandboxOrganization && adminSandboxSettings && \(\s*<OverdueReturnsAlert\s+organization=\{sandboxOrganization\}/)
  assert.match(testMode, /onOpen=\{\(\) => \{ setAdminCommercialPage\('overdue-returns'\); setMobileMenuOpen\(false\) \}\}/)
  assert.equal((testMode.match(/<OverdueReturnsAlert/g) || []).length, 1)
})

test('regular client organizations retain their original organization-scoped popup', () => {
  assert.match(customerMode, /<OverdueReturnsAlert organization=\{organization\} userId=\{session\.user\.id\} onOpen=\{\(\) => setPage\('overdue-returns'\)\} \/>/)
  assert.equal((customerMode.match(/<OverdueReturnsAlert/g) || []).length, 1)
})

test('popup queries only current organization and retains existing overdue criteria', () => {
  const popup = app.slice(app.indexOf('function OverdueReturnsAlert('), app.indexOf('function OverdueReturnsPage('))
  assert.match(popup, /\.eq\('organization_id', organization\.id\)/)
  assert.match(popup, /\.lt\('next_contact_date', currentBrazilDate\(\)\)/)
  assert.match(popup, /filter\(isOverdueReturn\)/)
  assert.match(popup, /crm_overdue_login_alert_\$\{userId\}_\$\{organization\.id\}/)
})
