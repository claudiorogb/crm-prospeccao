#!/usr/bin/env python3
"""Apply the requested email marketing UI changes to an isolated checkout.

Guard every anchor; no database/schema/mailer changes or secret access.
"""
from pathlib import Path

ROOT = Path('src')
email_path = ROOT / 'email-marketing.jsx'
import_path = ROOT / 'marketing-list-import.jsx'
mailing_path = ROOT / 'newsletter-mailing-panel.jsx'
css_path = ROOT / 'email-marketing.css'
email = email_path.read_text(encoding='utf-8')
imports = import_path.read_text(encoding='utf-8')
mailing = mailing_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')


def once(src, before, after, label):
    matches = src.count(before)
    if matches != 1:
        raise RuntimeError(f'{label}: expected one anchor; found {matches}: {before[:90]!r}')
    return src.replace(before, after, 1)

# Preserve the existing import and mandatory opt-in validations. A presentational
# mode only determines which of the already-existing form sections is displayed.
imports = once(imports,
    "onManualAdded, standalone = false }) {",
    "onManualAdded, standalone = false, mode = 'both' }) {", 'import mode prop')
imports = once(imports,
    '      <div className="email-manual-recipient-box">',
    '      {mode !== \'import\' && <div className="email-manual-recipient-box">', 'manual-only section')
imports = once(imports,
    '      </div>\n\n      <div className="email-marketing-import-divider"><span>ou importe uma lista</span></div>',
    '      </div>}\n\n      {mode === \'both\' && <div className="email-marketing-import-divider"><span>ou importe uma lista</span></div>}\n\n      {mode !== \'manual\' && <>', 'close manual/open import')
imports = once(imports,
    '      {message && <div className="notice">{message}</div>}\n    </div>\n  )\n}',
    '      {message && <div className="notice">{message}</div>}\n      </>}\n    </div>\n  )\n}', 'close import-only section')

# The spreadsheet template, origin, confirmation and import must live in the
# mailing-list management panel and be visible without expanding the table.
mailing = once(mailing,
    '      {open && (\n        <div className="mailing-management-content">',
    '''      <div className="mailing-management-import">
        <h3>Importar lista de e-mail marketing</h3>
        <p className="muted">Importe uma lista própria autorizada. O modelo, a origem e as regras de importação ficam nesta área.</p>
        <MarketingListImport organization={organization} mode="import" onImported={handleImported} />
      </div>

      {open && (
        <div className="mailing-management-content">''', 'always-visible import')
mailing = once(mailing,
    '''          <div className="mailing-management-import">
            <h3>Incluir novos e-mails</h3>
            <p className="muted">Adicione e-mails individualmente ou importe uma lista autorizada do seu site. Endereços descadastrados não são reativados pela inclusão manual.</p>
            <MarketingListImport organization={organization} standalone onImported={handleImported} onManualAdded={handleImported} />
          </div>
''', '', 'remove hidden duplicate import')

# A real paginated backend query, not a .limit(30) followed by slicing 30 rows.
email = once(email, "import React, { useEffect, useMemo, useState } from 'react'",
    "import React, { useEffect, useMemo, useRef, useState } from 'react'", 'load cancellation ref')
email = once(email, "const MAX_TOTAL_BYTES = 15 * 1024 * 1024",
    "const MAX_TOTAL_BYTES = 15 * 1024 * 1024\nconst CAMPAIGN_PAGE_SIZE = 20", 'history size')
email = once(email,
    '  const [campaigns, setCampaigns] = useState([])',
    '''  const [campaigns, setCampaigns] = useState([])
  const [campaignPage, setCampaignPage] = useState(0)
  const [campaignTotal, setCampaignTotal] = useState(0)
  const [campaignListLoading, setCampaignListLoading] = useState(false)
  const loadSequence = useRef(0)''', 'campaign page state')
email = once(email,
    '''  async function loadData() {
    if (!organization?.id) return
    const [connectionResult, limitResult, clientsResult, marketingResult, campaignResult] = await Promise.all([''',
    '''  async function loadData(nextCampaignPage = campaignPage) {
    if (!organization?.id) return
    const sequence = ++loadSequence.current
    setCampaignListLoading(true)
    const [connectionResult, limitResult, clientsResult, marketingResult, campaignResult] = await Promise.all([''', 'paginated data load')
email = once(email,
    ".from('email_campaigns').select('id,name,subject,body_text,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at').eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(30)",
    ".from('email_campaigns').select('id,name,subject,body_text,status,total_recipients,sent_count,failed_count,provider,from_email,created_at,completed_at,cancelled_at', { count: 'exact' }).eq('organization_id', organization.id).order('created_at', { ascending: false }).order('id', { ascending: false }).range(nextCampaignPage * CAMPAIGN_PAGE_SIZE, (nextCampaignPage + 1) * CAMPAIGN_PAGE_SIZE - 1)", 'backend campaign pagination')
email = once(email,
    '''    ])

    if (connectionResult.error)''',
    '''    ])
    if (sequence !== loadSequence.current) return
    setCampaignListLoading(false)

    if (connectionResult.error)''', 'avoid late results from prior page or organization')
email = once(email,
    '''    setCampaigns(campaignResult.data || [])
    if (connectionResult.data?.sender_email)''',
    '''    if (!campaignResult.error) {
      setCampaigns(campaignResult.data || [])
      setCampaignTotal(campaignResult.count || 0)
    }
    if (connectionResult.data?.sender_email)''', 'campaign total')
email = once(email,
    '''  useEffect(() => {
    loadData()
  }, [organization?.id])''',
    '''  useEffect(() => {
    setCampaignPage(0)
    setCampaigns([])
    setCampaignTotal(0)
    setSelected(new Set())
    setSelectedMarketing(new Set())
    setDraftCampaignId(null)
    setCommercialConsentConfirmed(false)
    loadData(0)
    return () => { loadSequence.current += 1 }
  }, [organization?.id])''', 'reset campaign paging on organization change')
email = once(email,
    '''  const selectedTotal = selectedClients.length + selectedMarketingContacts.length''',
    '''  const selectedTotal = selectedClients.length + selectedMarketingContacts.length
  const campaignPageCount = Math.ceil(campaignTotal / CAMPAIGN_PAGE_SIZE)
  const campaignPageNumbers = [...new Set([0, campaignPageCount - 1, ...Array.from({ length: 5 }, (_, i) => campaignPage + i - 2)])]
    .filter(page => page >= 0 && page < campaignPageCount).sort((a, b) => a - b)

  async function changeCampaignPage(nextPage) {
    if (nextPage < 0 || nextPage >= campaignPageCount || nextPage === campaignPage || campaignListLoading) return
    setCampaignPage(nextPage)
    await loadData(nextPage)
  }''', 'pagination navigation')
email = once(email,
    '''      setMessage('Campanha salva como rascunho. Agora escolha os destinatários e, quando estiver pronto, inicie o envio.')
      await loadData()''',
    '''      setMessage('Campanha salva como rascunho. Agora escolha os destinatários e, quando estiver pronto, inicie o envio.')
      setCampaignPage(0)
      await loadData(0)''', 'show newly created campaign on first page')
email = once(email,
    '''          <MarketingListImport organization={organization} onImported={loadData} onManualAdded={handleManualRecipientAdded} />''',
    '''          <MarketingListImport organization={organization} mode="manual" onManualAdded={handleManualRecipientAdded} />''', 'manual-only in campaign')

# Keep the existing list inclusion button and consent flow; swap only the
# displayed list block so the campaign reads manual > marketing list > CRM.
source_start = email.index('          <div className="email-recipient-source">', email.index('<MarketingListImport organization={organization} mode="manual"'))
first_start = email.index('          <div className="email-recipient-source">', source_start)
second_start = email.index('          <div className="email-recipient-source">', first_start + 1)
end = email.index('\n        </div>\n\n        )}', second_start)
first = email[first_start:second_start]
second = email[second_start:end]
if 'Clientes do CRM' not in first or 'Lista de E-mail Marketing' not in second or first.count('email-recipient-source') != 2 or second.count('email-recipient-source') != 2:
    raise RuntimeError('Recipient source markup changed; refusing unordered replacement')
email = email[:first_start] + second.rstrip() + '\n\n' + first.rstrip() + '\n' + email[end:]

# Existing history remains below creation/recipient selection, now truly paginated.
email = once(email,
    '''        )}
      </section>
    </>
  )
}

export function AdminEmailMarketing''',
    '''        )}
        {campaignTotal > 0 && <p className="muted email-history-count">Exibindo {campaigns.length} de {campaignTotal} campanha{campaignTotal === 1 ? '' : 's'}.</p>}
        {campaignPageCount > 1 && (
          <nav className="email-history-pages" aria-label="Páginas do histórico de campanhas">
            <button type="button" className="secondary" disabled={campaignListLoading || campaignPage === 0} onClick={() => changeCampaignPage(campaignPage - 1)}>Anterior</button>
            {campaignPageNumbers.map((page, index) => <React.Fragment key={page}>
              {index > 0 && page - campaignPageNumbers[index - 1] > 1 && <span aria-hidden="true">…</span>}
              <button type="button" className="secondary" aria-label={`Página ${page + 1}`} aria-current={page === campaignPage ? 'page' : undefined} disabled={campaignListLoading} onClick={() => changeCampaignPage(page)}>{page + 1}</button>
            </React.Fragment>)}
            <button type="button" className="secondary" disabled={campaignListLoading || campaignPage >= campaignPageCount - 1} onClick={() => changeCampaignPage(campaignPage + 1)}>Próxima</button>
          </nav>
        )}
      </section>
    </>
  )
}

export function AdminEmailMarketing''', 'numbered campaign pages')

css += '''
/* Pagination only for the campaign history. */
.email-history-pages{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:16px}
.email-history-pages button[aria-current="page"]{background:#0b192c!important;border-color:#0b192c!important;color:#fff!important}
.email-history-count{margin:12px 0 0;font-size:12px;text-align:right}
'''

# All checks precede writes, so an unexpected change cannot partially edit files.
assert 'mode="import"' in mailing and 'mode="manual"' in email
assert email.index('mode="manual"') < email.index('<strong>Lista de E-mail Marketing</strong>') < email.index('<strong>Clientes do CRM</strong>')
assert "count: 'exact'" in email and '.range(nextCampaignPage * CAMPAIGN_PAGE_SIZE' in email
assert "email_marketing_opt_out" in email and 'confirm_email_campaign_compliance' in email
assert "p_organization_id: organization.id" in email and ".eq('organization_id', organization.id)" in email
assert "set_email_campaign_recipients" in email and "queue_email_campaign" in email
for path, content in [(email_path, email), (import_path, imports), (mailing_path, mailing), (css_path, css)]:
    path.write_text(content, encoding='utf-8')
print('Email marketing: import moved to mailing area, recipient order corrected, paginated 20 campaigns per page.')
