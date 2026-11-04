import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Search } from 'lucide-react'
import { supabase } from './lib/supabase'
import CustomerImportPanel from './customer-import'

const PAGE_SIZE = 1000
const MAX_PAGES = 10
const VISIBLE_STEP = 100
const MOVE_CHUNK = 1000

const STATUS_LABEL = {
  new: 'Novo', queued: 'Na fila', contacted: 'Contatado', replied: 'Respondeu', interested: 'Interessado',
  proposal: 'Proposta', negotiation: 'Negociação', not_interested: 'Sem interesse', lost: 'Perdido',
  discarded: 'Descartado', captured_pending: 'Captação pendente', contacted_pending: 'Contato pendente'
}

const LISTS = {
  prospects: {
    label: 'Lista de prospecção',
    help: 'Contatos importados para abordar. Selecione e envie para a lista de clientes quando virarem clientes.',
    moveLabel: 'Enviar para clientes',
    moveTarget: 'customers',
    moveTargetName: 'lista de clientes',
    skipHint: 'Contatos nas etapas Interessado, Proposta ou Perdido seguem o funil de vendas e não podem ser enviados direto para clientes.'
  },
  customers: {
    label: 'Lista de clientes',
    help: 'Clientes importados. Selecione e envie para a lista de prospecção se foram colocados aqui por engano.',
    moveLabel: 'Enviar para prospecção',
    moveTarget: 'prospects',
    moveTargetName: 'lista de prospecção',
    skipHint: 'Só voltam para a prospecção clientes importados que ainda não têm vendas, contrato nem histórico de contatos.'
  }
}

function baseQuery(organizationId, kind, columns, options) {
  let query = supabase.from('leads').select(columns, options)
    .eq('organization_id', organizationId)
    .eq('source', 'import')
    .is('deleted_at', null)
  query = kind === 'customers' ? query.eq('status', 'won') : query.neq('status', 'won')
  return query
}

export default function ImportLists({ organization, userId }) {
  const [kind, setKind] = useState('prospects')
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({ prospects: null, customers: null })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(VISIBLE_STEP)
  const [selected, setSelected] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  const config = LISTS[kind]

  useEffect(() => {
    let active = true
    supabase.from('organization_members').select('role,is_active')
      .eq('organization_id', organization.id).eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (active) setIsAdmin(Boolean(data?.is_active && ['owner', 'admin'].includes(data.role))) })
    return () => { active = false }
  }, [organization.id, userId])

  const loadCounts = useCallback(async () => {
    const [p, c] = await Promise.all(['prospects', 'customers'].map(k =>
      baseQuery(organization.id, k, 'id', { count: 'exact', head: true })))
    setCounts({ prospects: p.count ?? 0, customers: c.count ?? 0 })
  }, [organization.id])

  const loadRows = useCallback(async () => {
    setLoading(true)
    const all = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await baseQuery(
        organization.id, kind,
        'id,business_name,contact_name,phone,email,city,state,status,customer_origin,created_at'
      ).order('business_name', { ascending: true }).order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) { setMessage(`Não foi possível carregar a lista: ${error.message}`); break }
      all.push(...(data || []))
      if (!data || data.length < PAGE_SIZE) break
    }
    setRows(all)
    setSelected(new Set())
    setConfirming(false)
    setVisible(VISIBLE_STEP)
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

  const allFilteredSelected = filtered.length > 0 && filtered.every(row => selected.has(row.id))

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
          <p className="muted">Importe uma planilha, escolha para qual lista ela vai e depois mova os contatos entre as duas listas.</p>
        </div>
      </header>

      <CustomerImportPanel
        organization={organization}
        userId={userId}
        embedded
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
          {isAdmin && (
            <div className="import-list-actions">
              {confirming ? (
                <>
                  <span>Enviar {selected.size} contato(s) para a {config.moveTargetName}?</span>
                  <button type="button" className="primary inline-btn" disabled={busy} onClick={moveSelected}>{busy ? 'Enviando...' : 'Confirmar'}</button>
                  <button type="button" className="secondary inline-btn" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
                </>
              ) : (
                <button type="button" className="primary inline-btn" disabled={!selected.size || busy} onClick={() => setConfirming(true)}>
                  <ArrowRightLeft size={16}/> {config.moveLabel}{selected.size ? ` (${selected.size})` : ''}
                </button>
              )}
            </div>
          )}
        </div>

        {message && <div className="notice">{message}</div>}

        {loading ? <p className="muted">Carregando...</p> : !filtered.length ? (
          <p className="muted">{rows.length ? 'Nenhum contato encontrado para a busca.' : 'Nenhum contato nesta lista ainda. Importe uma planilha acima.'}</p>
        ) : (
          <div className="import-list-table-wrap">
            <table className="import-list-table">
              <thead>
                <tr>
                  {isAdmin && <th><input type="checkbox" aria-label="Selecionar todos os resultados" checked={allFilteredSelected} onChange={toggleAllFiltered} /></th>}
                  <th>Empresa</th><th>Responsável</th><th>Telefone</th><th>E-mail</th><th>Cidade/UF</th>
                  {kind === 'prospects' && <th>Etapa</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, visible).map(row => (
                  <tr key={row.id}>
                    {isAdmin && <td><input type="checkbox" aria-label={`Selecionar ${row.business_name}`} checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} /></td>}
                    <td>{row.business_name}</td>
                    <td>{row.contact_name || '—'}</td>
                    <td>{row.phone || '—'}</td>
                    <td>{row.email || '—'}</td>
                    <td>{row.city || '—'}{row.state ? `/${row.state}` : ''}</td>
                    {kind === 'prospects' && <td>{STATUS_LABEL[row.status] || row.status}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="import-list-footer">
              <span className="muted">Mostrando {Math.min(visible, filtered.length)} de {filtered.length}{isAdmin ? ` • ${selected.size} selecionado(s)` : ''}</span>
              {visible < filtered.length && <button type="button" className="secondary inline-btn" onClick={() => setVisible(value => value + VISIBLE_STEP)}>Ver mais</button>}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
