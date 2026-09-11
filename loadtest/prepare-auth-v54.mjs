import { writeFileSync } from 'node:fs'

const baseUrl = process.env.SUPABASE_URL || 'https://ovenrdiykmfnjtvqnalz.supabase.co'
const apiKey = process.env.SUPABASE_KEY || 'sb_publishable_Q2F3ab3kHYpI_RZfrhdEfA_49dQEm9G'
const sessionFile = process.env.SESSIONS_FILE || 'loadtest/.sessions-v54.json'
const sessionCount = Number(process.env.SESSION_COUNT || 5)

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
    throw new Error(`loadtest_join ${i + 1} failed: HTTP ${join.status} ${await join.text()}`)
  }

  sessions.push({ access_token: payload.access_token, user: payload.user })
  await new Promise(resolve => setTimeout(resolve, 150))
}

writeFileSync(sessionFile, JSON.stringify(sessions), { mode: 0o600 })

const sorted = [...signupDurations].sort((a, b) => a - b)
const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
const avg = signupDurations.reduce((a, b) => a + b, 0) / signupDurations.length
writeFileSync('loadtest/auth-summary-v54.json', JSON.stringify({
  sessions_created: sessions.length,
  signup_avg_ms: Math.round(avg),
  signup_p95_ms: Math.round(sorted[p95Index] || 0)
}, null, 2))

console.log(`Created ${sessions.length} isolated authenticated V54 test sessions.`)
