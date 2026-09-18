import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import MarketingListImport from './marketing-list-import'
import './newsletter-mailing-panel.css'

const PAGE_SIZE = 100

function dateLabel(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
  }).format(date)
}

function statusLabel(contact) {
  if (contact.status === 'unsubscribed' || contact.unsubscribed_at) return 'Descadastrado'
  if (contact.status !== 'active' || !contact.consent_confirmed) return 'Indisponível'
  return 'Ativo'
}

export default function NewsletterMailingPanel({ organization, onChanged }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refresh(nextPage = page) {
    if (!organization?.id) return
    setLoading(true)
    setError('')
    try {
      const { data, count, error: queryError } = await supabase
        .from('email_marketing_contacts')
        .select('id,email,source,status,consent_confirmed,unsubscribed_at,created_at', { count: 'exact' })
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE - 1)
      if (queryError) throw queryError
      setRows(data || [])
      setTotal(count || 0)
      setPage(nextPage)
    } catch (err) {
      setError(err.message || 'Não foi possível carregar a lista de e-mails.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOpen(false)
    setRows([])
    setTotal(0)
    setPage(0)
  }, [organization?.id])

  async function handleImported() {
    await Promise.all([refresh(0), onChanged?.()])
  }

  return (
    <section className="panel mailing-management-panel">
      <div className="email-section-title mailing-management-header">
        <div>
          <span className="eyebrow">LISTA DE E-MAIL MARKETING</span>
          <h2>E-mails cadastrados</h2>
          <p className="muted">Consulte os cadastros da newsletter e inclua contatos da base própria da empresa.</p>
        </div>
        <button type="button" className="secondary" aria-expanded={open} onClick={() => {
          if (open) setOpen(false)
          else { setOpen(true); refresh(0) }
        }}>{open ? 'Fechar lista de e-mails' : 'Ver lista de e-mails cadastrados'}</button>
      </div>

      {open && (
        <div className="mailing-management-content">
          <div className="mailing-management-list-head">
            <strong>{total} e-mail{total === 1 ? '' : 's'} na lista</strong>
            <button type="button" className="secondary" disabled={loading} onClick={() => refresh(page)}>Atualizar</button>
          </div>
          {error && <div className="notice error" role="alert">{error}</div>}
          <div className="mailing-management-table-wrap">
            <table className="mailing-management-table">
              <thead><tr><th>E-mail cadastrado</th><th>Data de cadastro</th><th>Origem</th><th>Situação</th></tr></thead>
              <tbody>
                {rows.map(contact => <tr key={contact.id}>
                  <td>{contact.email}</td>
                  <td>{dateLabel(contact.created_at)}</td>
                  <td>{contact.source || 'Lista própria'}</td>
                  <td>{statusLabel(contact)}</td>
                </tr>)}
                {!loading && !rows.length && <tr><td colSpan="4">Nenhum e-mail cadastrado nesta empresa.</td></tr>}
              </tbody>
            </table>
          </div>
          {loading && <p className="muted" role="status">Carregando lista...</p>}
          {total > PAGE_SIZE && <div className="mailing-management-pages">
            <button type="button" className="secondary" disabled={loading || page === 0} onClick={() => refresh(page - 1)}>Anterior</button>
            <span>Página {page + 1} de {Math.ceil(total / PAGE_SIZE)}</span>
            <button type="button" className="secondary" disabled={loading || (page + 1) * PAGE_SIZE >= total} onClick={() => refresh(page + 1)}>Próxima</button>
          </div>}
          <div className="mailing-management-import">
            <h3>Incluir novos e-mails</h3>
            <p className="muted">Adicione e-mails individualmente ou importe uma lista autorizada do seu site. Endereços descadastrados não são reativados pela inclusão manual.</p>
            <MarketingListImport organization={organization} onImported={handleImported} onManualAdded={handleImported} />
          </div>
        </div>
      )}
    </section>
  )
}
