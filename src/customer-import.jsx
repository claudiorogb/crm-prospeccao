import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { supabase } from './lib/supabase'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 5000
const BATCH_SIZE = 400

const CUSTOMER_ALIASES = {
  business_name: ['empresa / cliente','empresa','cliente','nome fantasia','nome','nome do cliente'],
  legal_name: ['razão social','razao social'],
  tax_id: ['cnpj / cpf','cnpj/cpf','cnpj','cpf'],
  segment: ['segmento','categoria'],
  contact_name: ['nome do contato','contato','responsável','responsavel'],
  contact_role: ['cargo','função','funcao'],
  phone: ['telefone','fone'],
  whatsapp_phone: ['whatsapp','whats app','celular'],
  email: ['e-mail','email'],
  address: ['endereço','endereco'],
  city: ['cidade'],
  state: ['uf','estado'],
  website: ['site','website'],
  customer_origin: ['origem','origem do cliente'],
  next_contact_date: ['próximo contato','proximo contato','próxima ação','proxima acao'],
  commercial_notes: ['observações','observacoes','anotações','anotacoes','notas']
}

const ACTIVITY_ALIASES = {
  keyTax: ['cnpj / cpf','cnpj/cpf','cnpj','cpf'],
  keyName: ['empresa / cliente','empresa','cliente','nome do cliente'],
  occurred_on: ['data','data do contato','data contato'],
  activity_type: ['tipo de contato','tipo','canal'],
  notes: ['observação','observacao','registro','anotação','anotacao','notas']
}

const SALE_ALIASES = {
  keyTax: ['cnpj / cpf','cnpj/cpf','cnpj','cpf'],
  keyName: ['empresa / cliente','empresa','cliente','nome do cliente'],
  sale_date: ['data','data da venda','data venda'],
  amount: ['valor','valor da venda','valor venda'],
  product_service: ['produto / serviço','produto/serviço','produto / servico','produto/servico','produto','serviço','servico'],
  notes: ['observação','observacao','notas']
}

function canonical(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function normalizeDate(value) {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed?.y) return `${String(parsed.y).padStart(4,'0')}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`
  }
  const text = String(value).trim()
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}`
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`
  return text
}

function normalizeMoney(value) {
  if (typeof value === 'number') return String(value)
  let text = String(value ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '')
  if (!text) return ''
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.')
  else if (text.includes(',')) text = text.replace(',', '.')
  return text
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

function customerKey(taxId, businessName) {
  const tax = digits(taxId)
  if (tax) return `tax:${tax}`
  const name = canonical(businessName)
  return name ? `name:${name}` : ''
}

function normalizeCustomer(row) {
  const out = {}
  Object.entries(CUSTOMER_ALIASES).forEach(([field, aliases]) => { out[field] = getByAliases(row, aliases) })
  out.business_name = String(out.business_name || '').trim()
  out.legal_name = String(out.legal_name || '').trim()
  out.tax_id = digits(out.tax_id)
  out.segment = String(out.segment || '').trim()
  out.contact_name = String(out.contact_name || '').trim()
  out.contact_role = String(out.contact_role || '').trim()
  out.phone = digits(out.phone)
  out.whatsapp_phone = digits(out.whatsapp_phone)
  out.email = String(out.email || '').trim().toLowerCase()
  out.address = String(out.address || '').trim()
  out.city = String(out.city || '').trim()
  out.state = String(out.state || '').trim().toUpperCase()
  out.website = String(out.website || '').trim()
  out.customer_origin = String(out.customer_origin || '').trim()
  out.next_contact_date = normalizeDate(out.next_contact_date)
  out.commercial_notes = String(out.commercial_notes || '').trim()
  out.customer_key = customerKey(out.tax_id, out.business_name)
  return out
}

function normalizeActivity(row) {
  const tax = getByAliases(row, ACTIVITY_ALIASES.keyTax)
  const name = getByAliases(row, ACTIVITY_ALIASES.keyName)
  return {
    customer_key: customerKey(tax, name),
    occurred_on: normalizeDate(getByAliases(row, ACTIVITY_ALIASES.occurred_on)),
    activity_type: String(getByAliases(row, ACTIVITY_ALIASES.activity_type) || '').trim(),
    notes: String(getByAliases(row, ACTIVITY_ALIASES.notes) || '').trim()
  }
}

function normalizeSale(row) {
  const tax = getByAliases(row, SALE_ALIASES.keyTax)
  const name = getByAliases(row, SALE_ALIASES.keyName)
  return {
    customer_key: customerKey(tax, name),
    sale_date: normalizeDate(getByAliases(row, SALE_ALIASES.sale_date)),
    amount: normalizeMoney(getByAliases(row, SALE_ALIASES.amount)),
    product_service: String(getByAliases(row, SALE_ALIASES.product_service) || '').trim(),
    notes: String(getByAliases(row, SALE_ALIASES.notes) || '').trim()
  }
}

function findSheet(workbook, names) {
  const wanted = names.map(canonical)
  const name = workbook.SheetNames.find(sheet => wanted.includes(canonical(sheet)))
  return name ? { name, sheet: workbook.Sheets[name] } : null
}

// V94_CUSTOMER_IMPORT_DIAGNOSTICS — template and detailed local validation.
const TEMPLATE_SHEETS = [
  ['Clientes', ['Empresa / Cliente', 'Razão Social', 'CNPJ / CPF', 'Telefone', 'Cidade', 'UF', 'Site', 'E-mail', 'Endereço', 'Nome do contato', 'Cargo', 'WhatsApp', 'Segmento', 'Origem', 'Próximo contato', 'Observações']],
  ['Histórico', ['Empresa / Cliente', 'CNPJ / CPF', 'Data', 'Tipo de contato', 'Observação']],
  ['Vendas', ['Empresa / Cliente', 'CNPJ / CPF', 'Data', 'Valor', 'Produto / Serviço', 'Observação']]
]

function downloadTemplate() {
  const workbook = XLSX.utils.book_new()
  for (const [name, headers] of TEMPLATE_SHEETS) {
    const sheet = XLSX.utils.aoa_to_sheet([headers])
    sheet['!cols'] = headers.map(header => ({ wch: Math.min(32, Math.max(15, header.length + 4)) }))
    sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}1` }
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }
  XLSX.writeFile(workbook, 'AXIVA_Modelo_Importacao_Clientes.xlsx', { compression: true })
}

function importIssue(sheet, row, column, reason) {
  return { sheet_name: sheet, row_number: row, column, reason }
}

function isRealDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function readImportSheet(found, rowType, aliases, required, normalizer, errors) {
  if (!found) return []
  const grid = XLSX.utils.sheet_to_json(found.sheet, { header: 1, raw: true, defval: '', blankrows: true })
  if (!grid.length || grid.every(line => !line?.some(value => String(value ?? '').trim()))) return []
  const headers = (grid[0] || []).map(value => String(value ?? '').trim())
  const recognized = Object.values(aliases).flat().map(canonical)
  if (!headers.some(header => recognized.includes(canonical(header)))) {
    errors.push(importIssue(found.name, 1, 'Cabeçalhos', 'A primeira linha deve conter os nomes das colunas, sem título ou instruções acima. Baixe o modelo de importação.'))
    return []
  }
  for (const [label, accepted] of required) {
    if (!headers.some(header => accepted.map(canonical).includes(canonical(header)))) {
      errors.push(importIssue(found.name, 1, label, `Coluna obrigatória ausente: ${label}. Use o modelo de importação.`))
    }
  }
  if (errors.some(error => error.sheet_name === found.name && error.row_number === 1)) return []
  const rows = []
  for (let index = 1; index < grid.length; index += 1) {
    const line = grid[index] || []
    if (!line.some(value => String(value ?? '').trim())) continue
    const raw = Object.fromEntries(headers.map((header, col) => [header, line[col] ?? '']).filter(([header]) => Boolean(header)))
    rows.push({ row_type: rowType, sheet_name: found.name, row_number: index + 1, raw_data: raw, normalized_data: normalizer(raw) })
  }
  return rows
}

function checkImportRows(rows, errors) {
  const customers = rows.filter(row => row.row_type === 'customer')
  const byName = new Map()
  const byTax = new Map()
  for (const row of customers) {
    const data = row.normalized_data
    if (!data.business_name) errors.push(importIssue(row.sheet_name, row.row_number, 'Empresa / Cliente', 'Informe o nome do cliente.'))
    if (data.tax_id && ![11, 14].includes(data.tax_id.length)) errors.push(importIssue(row.sheet_name, row.row_number, 'CNPJ / CPF', 'O documento deve ter 11 ou 14 dígitos.'))
    if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) errors.push(importIssue(row.sheet_name, row.row_number, 'E-mail', 'Informe um endereço de e-mail válido.'))
    if (data.state && !/^[A-Z]{2}$/.test(data.state)) errors.push(importIssue(row.sheet_name, row.row_number, 'UF', 'Informe a sigla do estado com duas letras.'))
    if (data.next_contact_date && !isRealDate(data.next_contact_date)) errors.push(importIssue(row.sheet_name, row.row_number, 'Próximo contato', 'Informe uma data válida (DD/MM/AAAA).'))
    const name = canonical(data.business_name)
    if (name) byName.set(name, [...(byName.get(name) || []), row])
    if (data.tax_id) byTax.set(data.tax_id, [...(byTax.get(data.tax_id) || []), row])
  }
  for (const row of rows.filter(row => row.row_type !== 'customer')) {
    const data = row.normalized_data
    const tax = digits(getByAliases(row.raw_data, row.row_type === 'activity' ? ACTIVITY_ALIASES.keyTax : SALE_ALIASES.keyTax))
    const name = canonical(getByAliases(row.raw_data, row.row_type === 'activity' ? ACTIVITY_ALIASES.keyName : SALE_ALIASES.keyName))
    const taxMatches = tax ? (byTax.get(tax) || []) : []
    const nameMatches = name ? (byName.get(name) || []) : []
    let matches = tax ? taxMatches : nameMatches
    if (tax && name && taxMatches.length === 1 && canonical(taxMatches[0].normalized_data.business_name) !== name) matches = []
    if (matches.length !== 1) {
      errors.push(importIssue(row.sheet_name, row.row_number, 'Empresa / Cliente ou CNPJ / CPF', matches.length > 1 ? 'Mais de um cliente corresponde ao registro. Informe o CNPJ / CPF para identificar um único cliente.' : 'Cliente não encontrado de forma única na aba Clientes; confira nome e CNPJ / CPF.'))
    } else {
      // The backend associates records by tax ID when the client has one.
      data.customer_key = matches[0].normalized_data.customer_key
    }
    const date = row.row_type === 'activity' ? data.occurred_on : data.sale_date
    if (!isRealDate(date)) errors.push(importIssue(row.sheet_name, row.row_number, 'Data', 'Informe uma data válida (DD/MM/AAAA).'))
    if (row.row_type === 'activity' && !data.notes) errors.push(importIssue(row.sheet_name, row.row_number, 'Observação', 'Descreva o contato realizado.'))
    if (row.row_type === 'sale' && (!data.amount || !Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0)) {
      errors.push(importIssue(row.sheet_name, row.row_number, 'Valor', 'Informe um valor numérico maior que zero.'))
    }
  }
}

const SERVER_ERROR_COLUMNS = {
  missing_business_name: 'Empresa / Cliente', invalid_tax_id: 'CNPJ / CPF', invalid_email: 'E-mail', invalid_state: 'UF',
  duplicate_in_file: 'Empresa / Cliente ou CNPJ / CPF', ambiguous_duplicate: 'CNPJ / CPF, Telefone ou E-mail',
  existing_lead: 'CNPJ / CPF, Telefone ou E-mail', missing_customer_key: 'Empresa / Cliente ou CNPJ / CPF',
  customer_not_in_file: 'Empresa / Cliente ou CNPJ / CPF', invalid_customer_reference: 'Empresa / Cliente ou CNPJ / CPF',
  invalid_date: 'Data', missing_notes: 'Observação', invalid_sale: 'Data ou Valor', invalid_amount: 'Valor'
}

async function sha256(file) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function summarizeRows(rows) {
  return rows.reduce((acc, row) => {
    acc[row.row_type] = (acc[row.row_type] || 0) + 1
    return acc
  }, {})
}

async function parseWorkbook(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const customerSheet = findSheet(workbook, ['Clientes', 'Cliente', 'Customers']) || (workbook.SheetNames.length === 1 ? { name: workbook.SheetNames[0], sheet: workbook.Sheets[workbook.SheetNames[0]] } : null)
  if (!customerSheet) throw new Error('A planilha precisa ter uma aba chamada “Clientes”.')
  const errors = []
  const rows = [
    ...readImportSheet(customerSheet, 'customer', CUSTOMER_ALIASES, [['Empresa / Cliente', CUSTOMER_ALIASES.business_name]], normalizeCustomer, errors),
    ...readImportSheet(findSheet(workbook, ['Histórico', 'Historico', 'Histórico de contatos', 'Historico de contatos', 'Contatos']), 'activity', ACTIVITY_ALIASES, [['Empresa / Cliente ou CNPJ / CPF', [...ACTIVITY_ALIASES.keyTax, ...ACTIVITY_ALIASES.keyName]], ['Data', ACTIVITY_ALIASES.occurred_on], ['Observação', ACTIVITY_ALIASES.notes]], normalizeActivity, errors),
    ...readImportSheet(findSheet(workbook, ['Vendas', 'Compras', 'Sales']), 'sale', SALE_ALIASES, [['Empresa / Cliente ou CNPJ / CPF', [...SALE_ALIASES.keyTax, ...SALE_ALIASES.keyName]], ['Data', SALE_ALIASES.sale_date], ['Valor', SALE_ALIASES.amount]], normalizeSale, errors)
  ]
  if (!rows.some(row => row.row_type === 'customer') && errors.length === 0) errors.push(importIssue(customerSheet.name, 2, 'Empresa / Cliente', 'A aba Clientes não possui registros para importar.'))
  if (rows.length > MAX_ROWS) throw new Error(`O arquivo possui ${rows.length} registros. O limite por importação é ${MAX_ROWS}.`)
  if (!errors.length) checkImportRows(rows, errors)
  return { rows, errors }
}

export default function CustomerImportPanel({ organization, userId, onImported }) {
  const [authorized, setAuthorized] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [file, setFile] = useState(null)
  const [parsedRows, setParsedRows] = useState([])
  const [analysis, setAnalysis] = useState(null)
  const [validationErrors, setValidationErrors] = useState([])
  const [batchId, setBatchId] = useState(null)
  const [duplicateAction, setDuplicateAction] = useState('skip')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [show, setShow] = useState(false)

  useEffect(() => {
    let active = true
    async function checkAccess() {
      setCheckingAccess(true)
      const { data } = await supabase
        .from('organization_members')
        .select('role,is_active')
        .eq('organization_id', organization.id)
        .eq('user_id', userId)
        .maybeSingle()
      if (active) {
        setAuthorized(Boolean(data?.is_active && ['owner','admin'].includes(data.role)))
        setCheckingAccess(false)
      }
    }
    checkAccess()
    return () => { active = false }
  }, [organization.id, userId])

  const localSummary = useMemo(() => summarizeRows(parsedRows), [parsedRows])

  useEffect(() => {
    setFile(null)
    setParsedRows([])
    setAnalysis(null)
    setValidationErrors([])
    setBatchId(null)
  }, [organization.id, userId])

  async function chooseFile(event) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    setMessage('')
    setAnalysis(null)
    setBatchId(null)
    setParsedRows([])
    setValidationErrors([])
    setFile(null)
    if (selected.size > MAX_FILE_BYTES) {
      setMessage('O arquivo excede o limite de 5 MB.')
      return
    }
    const ext = selected.name.toLowerCase().split('.').pop()
    if (!['xlsx','xls','csv'].includes(ext)) {
      setMessage('Use um arquivo .xlsx, .xls ou .csv.')
      return
    }
    try {
      setBusy(true)
      const { rows, errors } = await parseWorkbook(selected)
      setFile(selected)
      setParsedRows(rows)
      setValidationErrors(errors)
      setMessage(errors.length ? `Encontrados ${errors.length} problema(s). Corrija as linhas indicadas e selecione o arquivo novamente.` : `Arquivo lido: ${rows.length} registro(s) preparado(s) para validação.`)
      setShow(true)
    } catch (error) {
      setMessage(error.message || 'Não foi possível ler a planilha.')
    } finally {
      setBusy(false)
    }
  }

  async function analyze() {
    if (!file || !parsedRows.length || validationErrors.length || !authorized) return
    setBusy(true)
    setMessage('')
    let createdBatch = null
    try {
      const { data: identity, error: identityError } = await supabase.auth.getUser()
      if (identityError || identity?.user?.id !== userId) throw new Error('Sessão inválida. Entre novamente no CRM.')
      const { data: membership, error: membershipError } = await supabase.from('organization_members').select('role,is_active').eq('organization_id', organization.id).eq('user_id', userId).maybeSingle()
      if (membershipError || !membership?.is_active || !['owner', 'admin'].includes(membership.role)) throw new Error('Somente o administrador da empresa ativa pode importar clientes.')
      const hash = await sha256(file)
      const { data: batch, error: batchError } = await supabase
        .from('customer_import_batches')
        .insert({ organization_id: organization.id, requested_by: userId, file_name: file.name.slice(0,255), file_size_bytes: file.size, file_sha256: hash })
        .select('id')
        .single()
      if (batchError) throw batchError
      createdBatch = batch.id
      setBatchId(batch.id)

      for (let start = 0; start < parsedRows.length; start += BATCH_SIZE) {
        const payload = parsedRows.slice(start, start + BATCH_SIZE).map(row => ({ ...row, batch_id: batch.id, organization_id: organization.id }))
        const { error } = await supabase.from('customer_import_rows').insert(payload)
        if (error) throw error
      }

      const { data, error } = await supabase.rpc('analyze_customer_import', { p_batch_id: batch.id })
      if (error) throw error
      const details = []
      if (Number(data.invalid || 0) > 0) {
        for (let offset = 0; offset < Number(data.invalid); offset += 500) {
          const { data: invalidRows, error: detailsError } = await supabase.from('customer_import_rows')
            .select('sheet_name,row_number,row_type,error_code,error_message')
            .eq('batch_id', batch.id).eq('organization_id', organization.id).eq('status', 'invalid')
            .order('sheet_name').order('row_number').range(offset, offset + 499)
          if (detailsError) throw detailsError
          details.push(...(invalidRows || []))
        }
        if (details.length !== Number(data.invalid)) throw new Error('Não foi possível recuperar todos os erros da validação. Nenhuma importação foi feita.')
      }
      setValidationErrors(details.map(row => importIssue(row.sheet_name, row.row_number, SERVER_ERROR_COLUMNS[row.error_code] || 'Registro', row.error_message || 'Registro inválido.')))
      setAnalysis(data)
      setMessage('Validação concluída. Revise o resumo antes de confirmar.')
    } catch (error) {
      if (createdBatch) await supabase.from('customer_import_batches').delete().eq('id', createdBatch)
      setBatchId(null)
      setAnalysis(null)
      setMessage(error.message || 'Não foi possível validar a importação.')
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!batchId || !analysis || Number(analysis.invalid || 0) > 0 || validationErrors.length || !authorized) return
    setBusy(true)
    setMessage('')
    try {
      const { data: identity, error: identityError } = await supabase.auth.getUser()
      if (identityError || identity?.user?.id !== userId) throw new Error('Sessão inválida. Entre novamente no CRM.')
      const { data: ownedBatch, error: ownershipError } = await supabase.from('customer_import_batches')
        .select('id').eq('id', batchId).eq('organization_id', organization.id).eq('requested_by', userId).eq('status', 'analyzed').maybeSingle()
      if (ownershipError || !ownedBatch) throw new Error('Esta importação não pertence à empresa ativa ou à sua sessão. Reenvie a planilha.')
      const { data, error } = await supabase.rpc('commit_customer_import', { p_batch_id: batchId, p_duplicate_action: duplicateAction })
      if (error) throw error
      setMessage(`Importação concluída: ${Number(data?.imported || 0)} registro(s) importado(s), ${Number(data?.updated || 0)} atualizado(s) e ${Number(data?.skipped || 0)} ignorado(s).`)
      setFile(null)
      setParsedRows([])
      setAnalysis(null)
      setValidationErrors([])
      setBatchId(null)
      await onImported?.()
    } catch (error) {
      setMessage(error.message || 'Não foi possível concluir a importação.')
    } finally {
      setBusy(false)
    }
  }

  if (checkingAccess || !authorized) return null

  return (
    <section className="customer-import-wrap">
      <div className="customer-import-actions">
        <button type="button" className="secondary inline-btn" onClick={() => setShow(value => !value)}>
          <FileSpreadsheet size={17}/> Importar clientes
        </button>
      </div>

      {show && (
        <div className="panel customer-import-panel">
          <div className="customer-import-head">
            <div>
              <span className="eyebrow">IMPORTAÇÃO SEGURA</span>
              <h2>Importar clientes de Excel ou CSV</h2>
              <p className="muted">O arquivo é validado antes de qualquer inclusão na carteira. Somente administradores da empresa podem confirmar a importação.</p>
            </div>
            <div className="customer-import-head-buttons">
            <button type="button" className="secondary inline-btn" onClick={downloadTemplate} disabled={busy}><Download size={17}/> Baixar modelo de importação</button>
            <label className="primary inline-btn customer-import-file-button">
              <Upload size={17}/>{busy ? 'Processando...' : 'Selecionar arquivo'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={chooseFile} disabled={busy} hidden />
            </label>
            </div>
          </div>

          {file && (
            <div className="customer-import-file-summary">
              <strong>{file.name}</strong>
              <span>{Math.ceil(file.size / 1024)} KB</span>
              <span>{localSummary.customer || 0} cliente(s)</span>
              <span>{localSummary.activity || 0} contato(s)</span>
              <span>{localSummary.sale || 0} venda(s)</span>
            </div>
          )}

          {parsedRows.length > 0 && !analysis && validationErrors.length === 0 && (
            <div className="customer-import-confirm-row">
              <p>A análise verifica campos obrigatórios, formatos, duplicidades no arquivo e clientes já existentes no AXIVA CRM.</p>
              <button type="button" className="primary inline-btn" onClick={analyze} disabled={busy}><RefreshCw size={16}/> Analisar arquivo</button>
            </div>
          )}

          {analysis && (
            <div className="customer-import-analysis">
              <div className="customer-import-stat"><span>Total</span><strong>{analysis.total || 0}</strong></div>
              <div className="customer-import-stat ok"><span>Válidos</span><strong>{analysis.valid || 0}</strong></div>
              <div className="customer-import-stat"><span>Duplicados</span><strong>{analysis.duplicates || 0}</strong></div>
              <div className={`customer-import-stat ${Number(analysis.invalid || 0) ? 'bad' : 'ok'}`}><span>Com erro</span><strong>{analysis.invalid || 0}</strong></div>

              {Number(analysis.invalid || 0) > 0 ? (
                <div className="notice error"><AlertTriangle size={16}/> Existem registros com erro. Corrija a planilha e envie novamente; nenhuma alteração foi feita na carteira.</div>
              ) : (
                <>
                  {Number(analysis.duplicates || 0) > 0 && (
                    <label className="customer-import-duplicate-choice">Clientes que já existem no CRM
                      <select value={duplicateAction} onChange={event => setDuplicateAction(event.target.value)}>
                        <option value="skip">Manter cadastro atual e ignorar o duplicado</option>
                        <option value="update">Atualizar cadastro existente com os dados preenchidos no arquivo</option>
                      </select>
                    </label>
                  )}
                  <button type="button" className="primary inline-btn" onClick={commit} disabled={busy}><CheckCircle2 size={16}/> Confirmar importação</button>
                </>
              )}
            </div>
          )}

          {validationErrors.length > 0 && (
            <div className="customer-import-errors" role="alert">
              <strong>Problemas encontrados ({validationErrors.length})</strong>
              <div className="customer-import-errors-scroll">
                <table><thead><tr><th>Aba</th><th>Linha</th><th>Coluna</th><th>Motivo / como corrigir</th></tr></thead>
                <tbody>{validationErrors.map((issue, index) => <tr key={`${issue.sheet_name}-${issue.row_number}-${issue.column}-${index}`}><td>{issue.sheet_name}</td><td>{issue.row_number}</td><td>{issue.column}</td><td>{issue.reason}</td></tr>)}</tbody></table>
              </div>
            </div>
          )}
          {message && <div className="notice">{message}</div>}
          <p className="muted customer-import-help">Estrutura aceita: aba “Clientes” e, opcionalmente, abas “Histórico” e “Vendas”. Limite de 5 MB e 5.000 registros por importação.</p>
        </div>
      )}
    </section>
  )
}
