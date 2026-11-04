import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Mail, Megaphone, MessageCircle, Search } from 'lucide-react'
import { supabase } from './lib/supabase'
import CustomerImportPanel from './customer-import'

const PAGE_SIZE = 1000
const MAX_PAGES = 10
const VISIBLE_STEP = 100
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

const COLUMNS = 'id,business_name,contact_name,phone,email,city,state,status,source,email_marketing_opt_out'

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
  const [visible, setVisible] = useState(VISIBLE_STEP)
  const [selected, setSelected] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isAdmin, setIsAdmin] = useState(isSystemAdmin)
  const [lastMessages, setLastMessages] = useState({})

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
        .order('business_name', { ascending: true }).order('id')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) { setMessage(`Não foi possível carregar a lista: ${error.message}`); break }
      all.push(...(data || []))
      if (!data || data.length < PAGE_SIZE) break
    }
    setRows(all)
    setSelected(new Set())
    setConfirming(false)
    setVisible(VISIBLE_STEP)
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

  const shown = filtered.slice(0, visible)

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
  }, [shown.length, kind, rows]) // eslint-disable-line react-hooks/exhaustive-deps

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
  function sendTo(channel) {
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
        ok: row => row.status === 'won' && validEmail(row.email) && !row.email_marketing_opt_out,
        section: 'email',
        why: 'a campanha de e-mail marketing é só para clientes com e-mail válido que não pediram para sair da lista'
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
      setMessage(`Nenhum dos contatos selecionados pode ser enviado por ${rule.label}: ${rule.why}.`)
      return
    }
    try {
      const ids = eligible.map(row => row.id)
      if (channel === 'email') sessionStorage.setItem('crm_email_preselect', JSON.stringify(ids))
      else sessionStorage.setItem(channel === 'marketing' ? 'crm_marketing_preselect' : 'crm_whatsapp_preselect', JSON.stringify({ ids, skipped }))
    } catch {
      setMessage('Não foi possível preparar o envio neste navegador.')
      return
    }
    onOpenSection?.(rule.section)
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
            onClick={() => { setKind(key); setSearch(''); setMessage('') }}
          >
            {item.label}{counts[key] !== null ? ` (${counts[key]})` : ''}
          </button>
        ))}
      </div>

      <section className="panel import-list-panel">
        <p className="muted">{config.help}</p>

        <div className="import-list-toolbar">
          <div className="search-box"><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar empresa, responsável, e-mail, cidade ou telefone" /></div>
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
                    {kind === 'leads' && <td>{STATUS_LABEL[row.status] || row.status}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="import-list-footer">
              <span className="muted">Mostrando {Math.min(visible, filtered.length)} de {filtered.length}</span>
              {visible < filtered.length && <button type="button" className="secondary inline-btn" onClick={() => setVisible(value => value + VISIBLE_STEP)}>Ver mais</button>}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
