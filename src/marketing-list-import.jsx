import React, { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 5000

function canonical(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function getByAliases(row, aliases) {
  const entries = Object.entries(row || {})
  for (const alias of aliases) {
    const wanted = canonical(alias)
    const found = entries.find(([key]) => canonical(key) === wanted)
    if (found) return found[1]
  }
  return ''
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function normalizeRow(row) {
  return {
    email: String(getByAliases(row, ['e-mail', 'email', 'mail']) || '').trim().toLowerCase(),
    contact_name: String(getByAliases(row, ['nome', 'nome do contato', 'contato', 'responsável', 'responsavel']) || '').trim(),
    company_name: String(getByAliases(row, ['empresa', 'cliente', 'nome da empresa', 'empresa / cliente']) || '').trim(),
    source: String(getByAliases(row, ['origem', 'fonte', 'lista']) || '').trim()
  }
}

async function parseFile(file) {
  if (!file) return []
  if (file.size > MAX_FILE_BYTES) throw new Error('O arquivo pode ter no máximo 5 MB.')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) throw new Error('A planilha não possui uma aba para importar.')
  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '', blankrows: false })
  if (rawRows.length > MAX_ROWS) throw new Error(`A lista pode ter no máximo ${MAX_ROWS.toLocaleString('pt-BR')} contatos por arquivo.`)
  return rawRows.map(normalizeRow)
}

function downloadTemplate() {
  const content = 'E-mail,Nome,Empresa,Origem\ncliente@empresa.com.br,Nome do contato,Empresa,Lista própria\n'
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'modelo-lista-email-marketing.csv'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function MarketingListImport({ organization, onImported }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [source, setSource] = useState('Lista própria importada')
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const validCount = useMemo(() => rows.filter(row => validEmail(row.email)).length, [rows])
  const invalidCount = rows.length - validCount

  async function chooseFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setMessage('')
    try {
      const parsed = await parseFile(file)
      setRows(parsed)
      setFileName(file.name)
      if (!parsed.length) setMessage('Nenhum contato foi encontrado no arquivo.')
    } catch (error) {
      setRows([])
      setFileName('')
      setMessage(error.message || 'Não foi possível ler o arquivo.')
    }
  }

  async function importList() {
    if (!rows.length) return setMessage('Selecione uma planilha ou CSV com contatos.')
    if (!confirmed) return setMessage('Confirme que a lista é própria e destinada a e-mail marketing.')
    setLoading(true)
    setMessage('')
    try {
      const { data, error } = await supabase.rpc('import_email_marketing_contacts', {
        p_organization_id: organization.id,
        p_contacts: rows,
        p_source: source.trim() || 'Lista própria importada',
        p_confirmed: true
      })
      if (error) throw error
      const result = data?.[0] || {}
      setMessage(`Importação concluída: ${Number(result.inserted_count || 0)} novo(s), ${Number(result.updated_count || 0)} atualizado(s) e ${Number(result.skipped_count || 0)} ignorado(s).`)
      setRows([])
      setFileName('')
      setConfirmed(false)
      if (onImported) await onImported()
    } catch (error) {
      setMessage(error.message || 'Não foi possível importar a lista.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="email-marketing-import-box">
      <div className="email-marketing-import-head">
        <div>
          <strong>Lista de E-mail Marketing</strong>
          <span>Importe uma lista própria em Excel ou CSV. Ela fica separada do Funil e da base de Clientes.</span>
        </div>
        <button type="button" className="secondary" onClick={downloadTemplate}>Baixar modelo</button>
      </div>

      <div className="email-marketing-import-grid">
        <label>
          Origem da lista
          <input value={source} onChange={e => setSource(e.target.value)} placeholder="Ex.: Newsletter, clientes antigos, evento" />
        </label>
        <label className="secondary email-file-button email-marketing-import-file">
          {fileName || 'Selecionar Excel/CSV'}
          <input type="file" accept=".xlsx,.xls,.csv" onChange={chooseFile} />
        </label>
      </div>

      {rows.length > 0 && (
        <div className="email-marketing-import-summary">
          <strong>{rows.length} registro{rows.length === 1 ? '' : 's'} no arquivo</strong>
          <span>{validCount} com e-mail válido{invalidCount ? ` • ${invalidCount} será(ão) ignorado(s)` : ''}</span>
        </div>
      )}

      <label className="email-marketing-confirm">
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        <span>Confirmo que esta lista pertence à empresa e é destinada a comunicações de e-mail marketing. Não é uma lista de prospecção fria.</span>
      </label>

      <div className="form-actions">
        <button type="button" className="secondary" disabled={loading || validCount === 0 || !confirmed} onClick={importList}>
          {loading ? 'Importando...' : 'Importar lista'}
        </button>
        <span className="muted">Colunas aceitas: E-mail (obrigatória), Nome, Empresa e Origem.</span>
      </div>
      {message && <div className="notice">{message}</div>}
    </div>
  )
}
