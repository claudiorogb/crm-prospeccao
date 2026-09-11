import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const sessions = JSON.parse(readFileSync('loadtest/.sessions.json', 'utf8'))
if (!sessions.length) throw new Error('No authenticated staging sessions found')

const session = sessions[0]
const storageKey = 'sb-ovenrdiykmfnjtvqnalz-auth-token'
const summary = { ok: false, steps: {} }

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  await context.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value)
  }, { key: storageKey, value: JSON.stringify(session) })

  const page = await context.newPage()

  let started = performance.now()
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 30000 })
  summary.steps.dashboard_ms = Math.round(performance.now() - started)

  started = performance.now()
  await page.locator('button.nav-item').filter({ hasText: 'Campanhas' }).click()
  await page.getByRole('heading', { name: 'Campanhas' }).waitFor({ timeout: 30000 })
  summary.steps.campaigns_ms = Math.round(performance.now() - started)

  started = performance.now()
  await page.locator('button.nav-item').filter({ hasText: 'Funil de vendas' }).click()
  await page.getByRole('button', { name: 'Leads', exact: true }).waitFor({ timeout: 30000 })
  summary.steps.funnel_ms = Math.round(performance.now() - started)

  started = performance.now()
  await page.getByRole('button', { name: 'Clientes', exact: true }).click()
  await page.getByRole('heading', { name: 'Clientes' }).waitFor({ timeout: 30000 })
  summary.steps.clients_ms = Math.round(performance.now() - started)

  summary.ok = true
  writeFileSync('loadtest/browser-smoke.json', JSON.stringify(summary, null, 2))
  console.log('Browser smoke flow passed:', JSON.stringify(summary.steps))
} finally {
  await browser.close()
}
