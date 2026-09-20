import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const campaign = readFileSync(new URL('../src/email-marketing.jsx', import.meta.url), 'utf8')
const mailing = readFileSync(new URL('../src/newsletter-mailing-panel.jsx', import.meta.url), 'utf8')
const importer = readFileSync(new URL('../src/marketing-list-import.jsx', import.meta.url), 'utf8')

function after(source, needle) {
  const position = source.indexOf(needle)
  assert.ok(position >= 0, `Missing ${needle}`)
  return position
}

test('marketing-list manager displays the template, import rules and confirmation without opening its table', () => {
  assert.ok(after(mailing, '<MarketingListImport organization={organization} mode="import"') < after(mailing, '{open && ('))
  assert.match(importer, /mode !== 'manual'/)
  assert.match(importer, /mode !== 'import'/)
  assert.match(importer, /Baixar modelo/)
  assert.match(importer, /Origem da lista/)
  assert.match(importer, /confirmado|confirmed/)
  assert.match(importer, /import_email_marketing_contacts/)
  assert.equal((campaign.match(/<MarketingListImport\s/g) || []).length, 1, 'No duplicate import UI inside campaign')
})

test('campaign recipient sources follow manual, marketing list and CRM client order', () => {
  const manual = after(campaign, 'mode="manual"')
  const list = after(campaign, '<strong>Lista de E-mail Marketing</strong>')
  const crm = after(campaign, '<strong>Clientes do CRM</strong>')
  const finalConsent = after(campaign, 'Confirmação obrigatória antes do envio')
  assert.ok(manual < list && list < crm && crm < finalConsent)
  assert.match(campaign, /email_marketing_opt_out/)
  assert.match(campaign, /confirm_email_campaign_compliance/)
  assert.match(campaign, /disabled=\{loading \|\| selectedTotal === 0 \|\| !commercialConsentConfirmed\}/)
})

test('campaign history uses server-side pages of twenty with full total and numbered navigation', () => {
  assert.match(campaign, /const CAMPAIGN_PAGE_SIZE = 20/)
  assert.match(campaign, /email_campaigns'\)\.select\([^\n]+\{ count: 'exact' \}\)\.eq\('organization_id', organization\.id\)/)
  assert.match(campaign, /\.range\(nextCampaignPage \* CAMPAIGN_PAGE_SIZE, \(nextCampaignPage \+ 1\) \* CAMPAIGN_PAGE_SIZE - 1\)/)
  assert.match(campaign, /aria-label="Páginas do histórico de campanhas"/)
  assert.match(campaign, /campaignPageNumbers\.map/)
  assert.match(campaign, /setCampaignPage\(0\)/)
  assert.doesNotMatch(campaign, /email_campaigns[^\n]*\.limit\(30\)/)
  assert.match(campaign, /onClick=\{\(\) => loadData\(\)\}>Atualizar/)
  assert.doesNotMatch(campaign, /onClick=\{loadData\}/)
})
