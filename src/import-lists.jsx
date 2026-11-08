import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Mail, Megaphone, MessageCircle, Search } from 'lucide-react'
import { supabase } from './lib/supabase'
import CustomerImportPanel from './customer-import'

const PAGE_SIZE = 1000
const MAX_PAGES = 10
const LIST_PAGE_SIZE = 20
const MOVE_CHUNK = 1000
const WHATSAPP_STATUSES = ['new', 'queued', 'captured_pending']

const STATUS_LABEL = {
  new: 'Novo', queued: 'Na fila', contacted: 'Contatado', replied: 'Respondeu', interested: 'Interessado',
  proposal: 'Proposta', negotiation: 'Negociação', captured_pending: 'Captado', contacted_pending: 'Contato pendente'
}
const SOURCE_LABEL = { google_places: 'Google', import: 'Importado', manual: 'Manual', other: 'Outro' }

const LISTS = {
  leads: {
    label: 'Lista de leads',
    help: 'Leads captados pelo Google, importados ou cadastrados. Selecione e envie mensagens, ou envie para a lista de clientes quando virarem clientes.',
    moveLabel: 'Enviar para clientes',
    moveTarget: 'customers',
    moveTargetName: 'lista de clientes',
    skipHint: 'Leads nas etapas Interessado ou Proposta seguem o funil de vendas e não podem ser enviados direto para clientes.'
  },
  customers: {
    label: 'Lista de clientes',
    help: 'Clientes da empresa. Selecione e envie mensagens, ou devolva para a lista de leads os clientes importados por engano.',
    moveLabel: 'Enviar para leads',
    moveTarget: 'prospects',
    moveTargetName: 'lista de leads',
    skipHint: 'Só voltam para leads clientes importados que ainda não têm vendas, contrato nem histórico de contatos.'
  }
}

const COLUMNS = 'id,business_name,contact_name,phone,email,city,state,status,source,email_marketing_opt_out,created_at'

function baseQuery(organizationId, kind, columns, options) {
  const query = supabase.from('leads').select(columns, options)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
  return kind === 'customers' ? query.eq('status', 'won') : query.not('status', 'in', '(won,lost,not_interested,discarded)')
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim())
}

function shortDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR')
}

function LastMessages({ info }) {
  if (!info) return <small className="import-list-last">Últimas mensagens: carregando...</small>
  const items = [
    ['WhatsApp', shortDate(info.whatsapp_at)],
    ['Campanha e-mail', shortDate(info.email_at)],
    ['E-mail mkt', shortDate(info.marketing_at)]
  ].filter(([, date]) => date)
  if (!items.length) return <small className="import-list-last">Últimas mensagens: nenhuma enviada</small>
  return (
    <small className="import-list-last">
      Últimas mensagens: {items.map(([label, date], index) => <span key={label}>{index ? ' · ' : ''}{label} {date}</span>)}
    </small>
  )
}

export default function ImportLists({ organization, userId, isSystemAdmin = false, onOpenSection }) {
  const [kind, setKind] = useState('leads')
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({ leads: null, customers: null })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isAdmin, setIsAdmin] = useState(isSystemAdmin)
  const [lastMessages, setLastMessages] = useState({})
  const [kanbanTarget, setKanbanTarget] = useState(null)
  const [kanbanSellerOptions, setKanbanSellerOptions] = useState([])
  const [kanbanSellerId, setKanbanSellerId] = useState('')
  const [kanbanTargetStatus, setKanbanTargetStatus] = useState('new')
  const [kanbanModalLoading, setKanbanModalLoading] = useState(false)
  const [kanbanSaving, setKanbanSaving] = useState(false)
  const [kanbanModalError, setKanbanModalError] = useState('')

  const config = LISTS[kind]

  useEffect(() => {
    let active = true
    if (isSystemAdmin) { setIsAdmin(true); return undefined }
    supabase.from('organization_members').select('role,is_active')
      .eq('organization_id', organization.id).eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (active) setIsAdmin(Boolean(data?.is_active && ['owner', 'admin'].includes(data.role))) })
    return () => { active = false }
  }, [organization.id, userId, isSystemAdmin])

  const loadCounts = useCallback(async () => {
    const [l, c] = await Promise.all(['leads', 'customers'].map(k =>
      baseQuery(organization.id, k, 'id', { count: 'exact', head: true })))
    setCounts({ leads: l.count ?? 0, customers: c.count ?? 0 })
  }, [organization.id])

  const loadRows = useCallback(async () => {
    setLoading(true)
    const all = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await baseQuery(organization.id, kind, COLUMNS)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) { setMessage(`Não foi possível carregar a lista: ${error.message}`); break }
      all.push(...(data || []))
      if (!data || data.length < PAGE_SIZE) break
    }
    setRows(all)
    setSelected(new Set())
    setConfirming(false)
    setPage(1)
    setLastMessages({})
    setLoading(false)
  }, [organization.id, kind])

  useEffect(() => { loadRows() }, [loadRows])
  useEffect(() => { loadCounts() }, [loadCounts])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    const digits = term.replace(/\D/g, '')
    return rows.filter(row =>
      [row.business_name, row.contact_name, row.email, row.city].some(value => String(value || '').toLowerCase().includes(term)) ||
      (digits.length >= 3 && String(row.phone || '').replace(/\D/g, '').includes(digits)))
  }, [rows, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const shown = filtered.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE)

  // Última mensagem por canal, só dos contatos que aparecem na tela.
  useEffect(() => {
    const missing = shown.map(row => row.id).filter(id => !(id in lastMessages))
    if (!missing.length) return undefined
    let active = true
    ;(async () => {
      const found = {}
      for (let start = 0; start < missing.length; start += 500) {
        const chunk = missing.slice(start, start + 500)
        const { data } = await supabase.rpc('lead_last_messages', { p_lead_ids: chunk })
        chunk.forEach(id => { found[id] = {} })
        for (const item of data || []) found[item.lead_id] = item
      }
      if (active) setLastMessages(old => ({ ...old, ...found }))
    })()
    return () => { active = false }
  }, [shown.map(row => row.id).join(','), kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const allFilteredSelected = filtered.length > 0 && filtered.every(row => selected.has(row.id))
  const selectedRows = useMemo(() => rows.filter(row => selected.has(row.id)), [rows, selected])

  function toggleOne(id) {
    setConfirming(false)
    setSelected(old => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setConfirming(false)
    setSelected(old => {
      const next = new Set(old)
      if (allFilteredSelected) filtered.forEach(row => next.delete(row.id))
      else filtered.forEach(row => next.add(row.id))
      return next
    })
  }

  // Seleciona e abre a tela de envio do canal, com os contatos já marcados.
  async function sendTo(channel) {
    if (!selectedRows.length) return
    const rules = {
      email: {
        label: 'e-mail',
        ok: row => validEmail(row.email) && !row.email_marketing_opt_out,
        section: 'email-prospecting',
        why: 'precisam ter e-mail válido e não ter pedido para sair da lista'
      },
      marketing: {
        label: 'campanha de e-mail marketing',
        ok: row => validEmail(row.email) && !row.email_marketing_opt_out,
        section: 'email',
        why: 'precisam ter e-mail válido e não ter pedido para sair da lista'
      },
      whatsapp: {
        label: 'WhatsApp',
        ok: row => Boolean(String(row.phone || '').replace(/\D/g, '')) && WHATSAPP_STATUSES.includes(row.status),
        section: 'sending',
        why: 'o envio em lote por WhatsApp é para leads com telefone nas etapas Novo, Na fila ou Captado'
      }
    }
    const rule = rules[channel]
    const eligible = selectedRows.filter(rule.ok)
    const skipped = selectedRows.length - eligible.length
    if (!eligible.length) {
      const semEmail = selectedRows.filter(row => !validEmail(row.email)).length
      const saiu = selectedRows.filter(row => row.email_marketing_opt_out).length
      const detalhes = [semEmail ? `${semEmail} sem e-mail válido` : '', saiu ? `${saiu} pediram para sair da lista` : ''].filter(Boolean).join(', ')
      setMessage(`Nenhum dos contatos selecionados pode ser enviado por ${rule.label}: ${rule.why}.${detalhes && channel !== 'whatsapp' ? ` (${detalhes}.)` : ''}`)
      return
    }
    try {
      const ids = eligible.map(row => row.id)
      if (channel === 'email') sessionStorage.setItem('crm_email_preselect', JSON.stringify(ids))
      else if (channel === 'marketing') sessionStorage.setItem('crm_marketing_preselect', JSON.stringify({ ids, skipped }))
      else sessionStorage.setItem('crm_whatsapp_preselect', JSON.stringify({ ids, skipped }))
    } catch {
      setMessage('Não foi possível preparar o envio neste navegador.')
      return
    }
    onOpenSection?.(rule.section)
  }

  async function openKanbanAssignment(row) {
    if (!row?.id || kanbanSaving) return
    setKanbanTarget(row)
    setKanbanSellerId('')
    setKanbanTargetStatus('new')
    setKanbanModalError('')
    setKanbanSellerOptions([])
    setKanbanModalLoading(true)
    try {
      const { data, error } = await supabase
        .from('organization_members')
        .select('user_id,display_name')
        .eq('organization_id', organization.id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('display_name', { ascending: true })
      if (error) throw error
      setKanbanSellerOptions(data || [])
      if (!data?.length) setKanbanModalError('Esta empresa não possui vendedores ativos para atribuir ao lead.')
    } catch (error) {
      setKanbanModalError(error?.message || 'Não foi possível carregar os vendedores da empresa.')
    } finally {
      setKanbanModalLoading(false)
    }
  }

  async function sendRowToKanban() {
    if (!kanbanTarget?.id || !kanbanSellerId || kanbanSaving || kanbanModalLoading) {
      if (!kanbanSellerId) setKanbanModalError('Selecione o vendedor responsável para continuar.')
      return
    }
    setKanbanSaving(true)
    setKanbanModalError('')
    try {
      const { data, error } = await supabase.rpc('send_lead_to_kanban_with_seller', {
        p_organization_id: organization.id,
        p_lead_id: kanbanTarget.id,
        p_target_status: kanbanTargetStatus,
        p_assigned_to: kanbanSellerId
      })
      if (error) throw error
      const persisted = Array.isArray(data) ? data[0] : data
      if (!persisted?.lead_id) throw new Error('O banco não confirmou o envio para o Kanban.')
      const targetLabel = kanbanTargetStatus === 'contacted' ? 'Contatado' : 'Novo'
      setMessage(persisted.created_new_opportunity
        ? `${kanbanTarget.business_name} continua na lista de clientes. Uma nova oportunidade foi criada no Kanban em ${targetLabel}.`
        : `${kanbanTarget.business_name} foi enviado para o Kanban em ${targetLabel}.`)
      setKanbanTarget(null)
      await Promise.all([loadRows(), loadCounts()])
    } catch (error) {
      setKanbanModalError(error?.message || 'Não foi possível enviar o contato para o Kanban. O registro continua na lista.')
    } finally {
      setKanbanSaving(false)
    }
  }

  async function moveSelected() {
    const ids = [...selected]
    if (!ids.length || !isAdmin) return
    setBusy(true)
    setMessage('')
    let moved = 0
    let skipped = 0
    try {
      for (let start = 0; start < ids.length; start += MOVE_CHUNK) {
        const { data, error } = await supabase.rpc('move_import_leads', {
          p_lead_ids: ids.slice(start, start + MOVE_CHUNK),
          p_target: config.moveTarget
        })
        if (error) throw error
        moved += Number(data?.moved || 0)
        skipped += Number(data?.skipped || 0)
      }
      const parts = [`${moved} contato(s) enviado(s) para a ${config.moveTargetName}.`]
      if (skipped) parts.push(`${skipped} não foram enviados. ${config.skipHint}`)
      setMessage(parts.join(' '))
    } catch (error) {
      setMessage(error.message || 'Não foi possível enviar os contatos.')
    } finally {
      setBusy(false)
      setConfirming(false)
      await Promise.all([loadRows(), loadCounts()])
    }
  }

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">CAMPANHAS</span>
          <h1>Lista de clientes</h1>
          <p className="muted">Leads e clientes em um só lugar: importe planilhas, envie mensagens e mova contatos entre as listas.</p>
        </div>
      </header>

      <CustomerImportPanel
        organization={organization}
        userId={userId}
        isSystemAdmin={isSystemAdmin}
        onImported={async () => { await Promise.all([loadRows(), loadCounts()]) }}
      />

      <div className="import-list-switch" role="tablist">
        {Object.entries(LISTS).map(([key, item]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={kind === key}
            className={kind === key ? 'primary' : 'secondary'}
            onClick={() => { setKind(key); setSearch(''); setPage(1); setMessage('') }}
          >
            {item.label}{counts[key] !== null ? ` (${counts[key]})` : ''}
          </button>
        ))}
      </div>

      <section className="panel import-list-panel">
        <p className="muted">{config.help}</p>

        <div className="import-list-toolbar">
          <div className="search-box"><Search size={17}/><input value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Buscar empresa, responsável, e-mail, cidade ou telefone" /></div>
        </div>

        <div className="import-list-bar">
          <span className="import-list-bar-count">{selected.size} selecionado(s)</span>
          <div className="import-list-bar-group">
            <span className="import-list-bar-label">Enviar mensagem por</span>
            <button type="button" className="secondary inline-btn" disabled={!selected.size} onClick={() => sendTo('email')}><Mail size={15}/> E-mail</button>
            <button type="button" className="secondary inline-btn" disabled={!selected.size} onClick={() => sendTo('marketing')}><Megaphone size={15}/> Campanha de e-mail mkt</button>
            <button type="button" className="secondary inline-btn" disabled={!selected.size} onClick={() => sendTo('whatsapp')}><MessageCircle size={15}/> WhatsApp</button>
          </div>
          {isAdmin && (
            <div className="import-list-bar-group">
              {confirming ? (
                <>
                  <span>Enviar {selected.size} contato(s) para a {config.moveTargetName}?</span>
                  <button type="button" className="primary inline-btn" disabled={busy} onClick={moveSelected}>{busy ? 'Enviando...' : 'Confirmar'}</button>
                  <button type="button" className="secondary inline-btn" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
                </>
              ) : (
                <button type="button" className="primary inline-btn" disabled={!selected.size || busy} onClick={() => setConfirming(true)}>
                  <ArrowRightLeft size={15}/> {config.moveLabel}
                </button>
              )}
            </div>
          )}
        </div>

        {message && <div className="notice">{message}</div>}

        {loading ? <p className="muted">Carregando...</p> : !filtered.length ? (
          <p className="muted">{rows.length ? 'Nenhum contato encontrado para a busca.' : 'Nenhum contato nesta lista ainda. Importe uma planilha ou capte leads.'}</p>
        ) : (
          <div className="import-list-table-wrap">
            <table className="import-list-table">
              <thead>
                <tr>
                  <th className="import-list-check"><input type="checkbox" aria-label="Selecionar todos os resultados" checked={allFilteredSelected} onChange={toggleAllFiltered} /></th>
                  <th>Empresa</th><th>Responsável</th><th>Telefone</th><th>E-mail</th><th>Cidade/UF</th><th>Origem</th>
                  {kind === 'leads' && <th>Etapa</th>}
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(row => (
                  <tr key={row.id}>
                    <td className="import-list-check"><input type="checkbox" aria-label={`Selecionar ${row.business_name}`} checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} /></td>
                    <td>
                      <strong>{row.business_name}</strong>
                      <LastMessages info={lastMessages[row.id]} />
                    </td>
                    <td>{row.contact_name || '—'}</td>
                    <td>{row.phone || '—'}</td>
                    <td>{row.email || '—'}</td>
                    <td>{row.city || '—'}{row.state ? `/${row.state}` : ''}</td>
                    <td>{SOURCE_LABEL[row.source] || '—'}</td>
                    {kind === 'leads' && <td>
                      {STATUS_LABEL[row.status] || row.status}
                      {shortDate(row.created_at) && <small className="import-list-last">Captado em {shortDate(row.created_at)}</small>}
                    </td>}
                    <td className="import-list-kanban-action">
                      <button type="button" className="secondary mini" onClick={() => openKanbanAssignment(row)} disabled={kanbanSaving || kanbanModalLoading}>
                        Enviar para Kanban
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="import-list-footer">
              <span className="muted">{filtered.length} contato(s) • do mais recente para o mais antigo</span>
              <div className="import-list-pager">
                <button type="button" className="secondary inline-btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Anterior</button>
                <span>Página {safePage} de {pageCount}</span>
                <button type="button" className="secondary inline-btn" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Próxima</button>
              </div>
            </div>
          </div>
        )}
      </section>

      {kanbanTarget && (
        <div className="lead-edit-overlay-v72">
          <section className="panel lead-edit-modal-v72 seller-assignment-modal" role="dialog" aria-modal="true" aria-label="Enviar para o Kanban">
            <div className="lead-edit-head-v72">
              <div>
                <span className="eyebrow">ENVIAR PARA O KANBAN</span>
                <h2>{kanbanTarget.business_name}</h2>
              </div>
            </div>
            <form className="campaign-form" onSubmit={event => { event.preventDefault(); sendRowToKanban() }}>
              <label>
                Vendedor responsável
                <select value={kanbanSellerId} onChange={event => setKanbanSellerId(event.target.value)} disabled={kanbanModalLoading || kanbanSaving} required>
                  <option value="">Selecione um vendedor</option>
                  {kanbanSellerOptions.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name || 'Usuário'}</option>)}
                </select>
              </label>
              <label>
                Etapa no Kanban
                <select value={kanbanTargetStatus} onChange={event => setKanbanTargetStatus(event.target.value)} disabled={kanbanSaving}>
                  <option value="new">Novo</option>
                  <option value="contacted">Contatado</option>
                </select>
              </label>
              {kanbanModalLoading && <p className="muted">Carregando vendedores da empresa...</p>}
              {kanbanModalError && <div className="notice error">{kanbanModalError}</div>}
              <div className="form-actions">
                <button className="primary inline-btn" disabled={kanbanSaving || kanbanModalLoading || !kanbanSellerId}>{kanbanSaving ? 'Enviando...' : 'Confirmar envio'}</button>
                <button type="button" className="secondary inline-btn" onClick={() => { setKanbanTarget(null); setKanbanModalError('') }} disabled={kanbanSaving}>Cancelar</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  )
}
