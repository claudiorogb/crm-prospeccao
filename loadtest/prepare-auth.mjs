import { writeFileSync } from 'node:fs'

const baseUrl = process.env.SUPABASE_URL
const apiKey = process.env.SUPABASE_KEY
const sessionFile = process.env.SESSIONS_FILE || '/tmp/crm-loadtest-sessions.json'
const sessionCount = Number(process.env.SESSION_COUNT || 20)

if (!baseUrl || !apiKey) {
  throw new Error('SUPABASE_URL and SUPABASE_KEY are required')
}

const sessions = []
const signupDurations = []

for (let i = 0; i < sessionCount; i += 1) {
  const started = performance.now()
  const signup = await fetch(`${baseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data: { loadtest: true, slot: i + 1 } })
  })

  const payload = await signup.json().catch(() => ({}))
  if (!signup.ok || !payload?.access_token || !payload?.user?.id) {
    throw new Error(`Anonymous signup ${i + 1} failed: HTTP ${signup.status} ${JSON.stringify(payload)}`)
  }

  signupDurations.push(performance.now() - started)

  const join = await fetch(`${baseUrl}/rest/v1/rpc/loadtest_join`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${payload.access_token}`,
      'Content-Type': 'application/json'
    },
    body: '{}'
  })

  if (!join.ok) {
    const text = await join.text()
    throw new Error(`loadtest_join ${i + 1} failed: HTTP ${join.status} ${text}`)
  }

  sessions.push({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: payload.expires_at,
    expires_in: payload.expires_in,
    token_type: payload.token_type,
    user: payload.user
  })

  await new Promise(resolve => setTimeout(resolve, 120))
}

writeFileSync(sessionFile, JSON.stringify(sessions), { mode: 0o600 })

const sorted = [...signupDurations].sort((a, b) => a - b)
const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
const avg = signupDurations.reduce((a, b) => a + b, 0) / signupDurations.length

writeFileSync('loadtest/auth-summary.json', JSON.stringify({
  sessions_created: sessions.length,
  signup_avg_ms: Math.round(avg),
  signup_p95_ms: Math.round(sorted[p95Index] || 0)
}, null, 2))

console.log(`Created ${sessions.length} isolated authenticated test sessions.`)
console.log(`Anonymous signup avg=${Math.round(avg)}ms p95=${Math.round(sorted[p95Index] || 0)}ms`)
