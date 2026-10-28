import React from 'react'
import './paginated-selection.css'

// Paginação no servidor + seleção que sobrevive à troca de página.
// Usado em "Envio de mensagens por WhatsApp" e em "Clientes contactados".

export const SENDING_PAGE_SIZE = 20
const FETCH_ALL_CHUNK = 1000

export function pageRange(page, pageSize = SENDING_PAGE_SIZE) {
  const from = (Math.max(1, page) - 1) * pageSize
  return { from, to: from + pageSize - 1 }
}

export function pageCountFor(total, pageSize = SENDING_PAGE_SIZE) {
  return Math.max(1, Math.ceil(Number(total || 0) / pageSize))
}

// Números de página exibidos: sempre a primeira, a última e as vizinhas da atual.
export function visiblePageNumbers(page, pageCount) {
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  const sorted = [...pages].filter(number => number >= 1 && number <= pageCount).sort((a, b) => a - b)
  const output = []
  sorted.forEach((number, index) => {
    if (index > 0 && number - sorted[index - 1] > 1) output.push(`gap-${number}`)
    output.push(number)
  })
  return output
}

// Busca uma página no servidor. `build(selectOptions)` deve devolver a consulta já filtrada e ordenada.
// Se a página pedida passou do fim (ex.: leads saíram da lista), volta para a última página existente.
export async function fetchPage(build, page, pageSize = SENDING_PAGE_SIZE) {
  let target = Math.max(1, Number(page) || 1)
  let result = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { from, to } = pageRange(target, pageSize)
    result = await build({ count: 'exact' }).range(from, to)
    // 416 / PGRST103 = página além do fim. Checa o status HTTP também, pois o corpo do erro pode chegar alterado.
    const rangeError = Boolean(result.error) && (
      result.status === 416 ||
      result.error.code === 'PGRST103' ||
      /PGRST103|range not satisfiable/i.test(String(result.error.message || ''))
    )
    const outOfRange = rangeError || (!result.error && target > 1 && !(result.data || []).length)
    if (!outOfRange) break

    let total = result.count
    if (result.error) {
      const head = await build({ count: 'exact', head: true })
      if (head.error) return { ...head, data: [], page: target }
      total = head.count
    }
    const lastPage = pageCountFor(total, pageSize)
    if (lastPage === target) break
    target = lastPage
  }
  return { ...result, page: target }
}

// Busca todas as linhas de uma consulta em blocos (usado por "Selecionar todos os resultados").
export async function fetchAllRows(buildQuery) {
  const rows = []
  for (let offset = 0; ; offset += FETCH_ALL_CHUNK) {
    const { data, error } = await buildQuery().range(offset, offset + FETCH_ALL_CHUNK - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < FETCH_ALL_CHUNK) return rows
  }
}

// A seleção é um Map id -> lead, para não depender da página carregada no momento.
export function withSelection(previous, leadsToChange, checked) {
  const next = new Map(previous)
  for (const lead of leadsToChange) {
    if (checked) next.set(lead.id, lead)
    else next.delete(lead.id)
  }
  return next
}

// Atualiza os dados dos leads selecionados que aparecem na página recém-carregada.
export function refreshSelection(previous, pageLeads) {
  if (!previous.size) return previous
  let changed = false
  const next = new Map(previous)
  for (const lead of pageLeads) {
    if (next.has(lead.id)) {
      next.set(lead.id, lead)
      changed = true
    }
  }
  return changed ? next : previous
}

export function SelectionToolbarInfo({ selectedCount, selectedOnPage, total, allResultsSelected, onSelectAllResults, onClear, loading, itemLabel = 'leads' }) {
  return (
    <span className="selection-info-v105">
      <span>{selectedCount} selecionado(s) no total{selectedOnPage > 0 ? ` • ${selectedOnPage} nesta página` : ''}</span>
      {total > 0 && !allResultsSelected && (
        <button type="button" className="link-button-v105" onClick={onSelectAllResults} disabled={loading}>
          Selecionar todos os {total} {itemLabel} (todas as páginas)
        </button>
      )}
      {selectedCount > 0 && (
        <button type="button" className="link-button-v105" onClick={onClear} disabled={loading}>
          Limpar seleção
        </button>
      )}
    </span>
  )
}

export function PaginationControls({ page, total, pageSize = SENDING_PAGE_SIZE, onPageChange, itemLabel = 'leads', disabled = false }) {
  if (!total) return null
  const pageCount = pageCountFor(total, pageSize)
  const safePage = Math.min(Math.max(1, page), pageCount)
  const first = (safePage - 1) * pageSize + 1
  const last = Math.min(total, safePage * pageSize)

  return (
    <div className="admin-pagination-v64 sending-pagination-v105">
      <span>
        Página <strong>{safePage}</strong> de <strong>{pageCount}</strong>
        {' • '}mostrando {first}–{last} de {total} {itemLabel}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="secondary mini"
          onClick={() => onPageChange(safePage - 1)}
          disabled={disabled || safePage === 1}
        >
          Anterior
        </button>
        {visiblePageNumbers(safePage, pageCount).map(item => typeof item === 'string' ? (
          <span key={item} className="pagination-gap-v105">…</span>
        ) : (
          <button
            type="button"
            key={item}
            className={item === safePage ? 'primary mini' : 'secondary mini'}
            onClick={() => onPageChange(item)}
            aria-current={item === safePage ? 'page' : undefined}
            disabled={disabled}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          className="secondary mini"
          onClick={() => onPageChange(safePage + 1)}
          disabled={disabled || safePage === pageCount}
        >
          Próxima
        </button>
      </div>
    </div>
  )
}
