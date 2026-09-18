from pathlib import Path

path = Path('src/email-marketing.jsx')
source = path.read_text(encoding='utf-8')

def replace_once(before, after):
    global source
    found = source.count(before)
    if found != 1:
        raise SystemExit(f'Patch interrompido: esperado um ponto de inclusão, encontrados {found}: {before[:100]!r}')
    source = source.replace(before, after, 1)

replace_once(
    "import MarketingListImport from './marketing-list-import'\n",
    "import MarketingListImport from './marketing-list-import'\nimport NewsletterMailingPanel from './newsletter-mailing-panel'\n"
)

replace_once(
    "() => marketingContacts.filter(c => validEmail(c.email) && c.status === 'active' && c.consent_confirmed),",
    "() => marketingContacts.filter(c => validEmail(c.email) && c.status === 'active' && c.consent_confirmed && !c.unsubscribed_at),"
)

replace_once(
    '  function chooseFiles(event) {',
    '''  async function includeMarketingList() {
    if (!draftCampaignId) return setMessage('Salve a campanha antes de incluir a lista.')
    if (!eligibleMarketingContacts.length) return setMessage('Não há e-mails autorizados disponíveis para incluir.')
    setLoading(true)
    setMessage('')
    try {
      const { data, error } = await supabase.rpc('set_email_campaign_recipients', {
        p_campaign_id: draftCampaignId,
        p_client_ids: selectedClients.map(c => c.id),
        p_marketing_contact_ids: eligibleMarketingContacts.map(c => c.id)
      })
      if (error) throw error
      setSelectedMarketing(new Set(eligibleMarketingContacts.map(c => c.id)))
      setCommercialConsentConfirmed(false)
      setMessage(`${Number(data || 0)} destinatário(s) salvo(s) no rascunho. A lista foi incluída, mas o envio ainda não foi iniciado.`)
      await loadData()
    } catch (error) {
      setMessage(error.message || 'Não foi possível incluir a lista de e-mail marketing.')
    } finally {
      setLoading(false)
    }
  }

  function chooseFiles(event) {'''
)

replace_once(
    '      </section>\n\n      <form className="panel email-compose-panel" onSubmit={createCampaign}>',
    '''      </section>

      <NewsletterMailingPanel organization={organization} onChanged={loadData} />

      <form className="panel email-compose-panel" onSubmit={createCampaign}>'''
)

replace_once(
    '''              <div><strong>Lista de E-mail Marketing</strong><span>{eligibleMarketingContacts.length} disponível{eligibleMarketingContacts.length === 1 ? 'is' : 'is'} • {unavailableMarketingCount} indisponível{unavailableMarketingCount === 1 ? 'is' : 'is'}</span></div>''',
    '''              <div><strong>Lista de E-mail Marketing</strong><span>{eligibleMarketingContacts.length} disponível{eligibleMarketingContacts.length === 1 ? 'is' : 'is'} • {unavailableMarketingCount} indisponível{unavailableMarketingCount === 1 ? 'is' : 'is'}</span></div>'''
) if False else None

replace_once(
    '''              <button type="button" className="secondary" onClick={toggleAllFilteredMarketing}>{filteredMarketingContacts.length && filteredMarketingContacts.every(c => selectedMarketing.has(c.id)) ? 'Desmarcar exibidos' : 'Selecionar exibidos'}</button>''',
    '''              <div className="mailing-source-actions">
                <button type="button" className="primary" disabled={loading || eligibleMarketingContacts.length === 0} onClick={includeMarketingList}>Incluir lista de e-mail mkt</button>
                <button type="button" className="secondary" onClick={toggleAllFilteredMarketing}>{filteredMarketingContacts.length && filteredMarketingContacts.every(c => selectedMarketing.has(c.id)) ? 'Desmarcar exibidos' : 'Selecionar exibidos'}</button>
              </div>'''
)

path.write_text(source, encoding='utf-8')
print('V101: patch pontual aplicado; conexão, campanhas e seleção de clientes preservadas.')
