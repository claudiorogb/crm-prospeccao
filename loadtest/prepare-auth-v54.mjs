import { writeFileSync } from 'node:fs'

const baseUrl = 'https://ovenrdiykmfnjtvqnalz.supabase.co'
const apiKey = 'sb_publishable_Q2F3ab3kHYpI_RZfrhdEfA_49dQEm9G'
const sessionFile = process.env.SESSIONS_FILE || 'loadtest/.sessions-v54.json'
const sessionCount = Number(process.env.SESSION_COUNT || 5)
const orgId = '11111111-1111-4111-8111-111111111111'

const sessions = []
const signupDurations = []

for (let i = 0; i < sessionCount; i += 1) {
  const started = performance.now()
  const signup = await fetch(`${baseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { loadtest: true, version: 'v54', slot: i + 1 } })
  })

  const payload = await signup.json().catch(() => ({}))
  if (!signup.ok || !payload?.access_token || !payload?.user?.id) {
    throw new Error(`Anonymous signup ${i + 1} failed: HTTP ${signup.status} ${JSON.stringify(payload)}`)
  }

  signupDurations.push(performance.now() - started)

  const prepare = await fetch(`${baseUrl}/rest/v1/rpc/loadtest_prepare`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${payload.access_token}`,
      'Content-Type': 'application/json'
    },
    body: '{}'
  })

  if (!prepare.ok) {
    throw new Error(`loadtest_prepare ${i + 1} failed: HTTP ${prepare.status} ${await prepare.text()}`)
  }

  sessions.push({ access_token: payload.access_token, user: { id: payload.user.id } })
  await new Promise(resolve => setTimeout(resolve, 150))
}

const first = sessions[0]
const authHeaders = {
  apikey: apiKey,
  Authorization: `Bearer ${first.access_token}`,
  'Content-Type': 'application/json'
}

const dashboard = await fetch(`${baseUrl}/rest/v1/rpc/get_dashboard_stats`, {
  method: 'POST', headers: authHeaders, body: JSON.stringify({ p_organization_id: orgId })
})
if (!dashboard.ok) throw new Error(`Dashboard preflight failed: HTTP ${dashboard.status} ${await dashboard.text()}`)

const page = await fetch(`${baseUrl}/rest/v1/rpc/get_leads_page`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    p_organization_id: orgId,
    p_search: null,
    p_target_segment_id: null,
    p_status: null,
    p_limit: 50,
    p_offset: 0
  })
})
if (!page.ok) throw new Error(`Leads preflight failed: HTTP ${page.status} ${await page.text()}`)
const pagePayload = await page.json()
if (Number(pagePayload?.total || 0) !== 1000 || !Array.isArray(pagePayload?.rows) || pagePayload.rows.length !== 50) {
  throw new Error(`Unexpected V54 payload: total=${pagePayload?.total} rows=${pagePayload?.rows?.length}`)
}

writeFileSync(sessionFile, JSON.stringify(sessions), { mode: 0o600 })

const sorted = [...signupDurations].sort((a, b) => a - b)
const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
const avg = signupDurations.reduce((a, b) => a + b, 0) / signupDurations.length
writeFileSync('loadtest/auth-summary-v54.json', JSON.stringify({
  sessions_created: sessions.length,
  signup_avg_ms: Math.round(avg),
  signup_p95_ms: Math.round(sorted[p95Index] || 0),
  preflight_total_leads: Number(pagePayload.total),
  preflight_page_rows: pagePayload.rows.length
}, null, 2))

console.log(`Created ${sessions.length} isolated authenticated V54 test sessions.`)
console.log(`V54 preflight OK: total=${pagePayload.total}, first_page=${pagePayload.rows.length}`)
