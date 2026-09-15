import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { supabase } from './lib/supabase'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 5000
const BATCH_SIZE = 400

const CUSTOMER_ALIASES = {
  business_name: ['empresa / cliente','empresa','cliente','nome fantasia','nome'],
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
  keyName: ['empresa / cliente','empresa','cliente'],
  occurred_on: ['data','data do contato','data contato'],
  activity_type: ['tipo de contato','tipo','canal'],
  notes: ['observação','observacao','registro','anotação','anotacao','notas']
}

const SALE_ALIASES = {
  keyTax: ['cnpj / cpf','cnpj/cpf','cnpj','cpf'],
  keyName: ['empresa / cliente','empresa','cliente'],
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

function rowsFromSheet(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, blankrows: false })
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

  const result = []
  const customers = rowsFromSheet(customerSheet.sheet)
  customers.forEach((raw, index) => result.push({ row_type: 'customer', sheet_name: customerSheet.name, row_number: index + 2, raw_data: raw, normalized_data: normalizeCustomer(raw) }))

  const activitySheet = findSheet(workbook, ['Histórico', 'Historico', 'Histórico de contatos', 'Historico de contatos', 'Contatos'])
  if (activitySheet) rowsFromSheet(activitySheet.sheet).forEach((raw, index) => result.push({ row_type: 'activity', sheet_name: activitySheet.name, row_number: index + 2, raw_data: raw, normalized_data: normalizeActivity(raw) }))

  const saleSheet = findSheet(workbook, ['Vendas', 'Compras', 'Sales'])
  if (saleSheet) rowsFromSheet(saleSheet.sheet).forEach((raw, index) => result.push({ row_type: 'sale', sheet_name: saleSheet.name, row_number: index + 2, raw_data: raw, normalized_data: normalizeSale(raw) }))

  if (!customers.length) throw new Error('A aba Clientes não possui registros para importar.')
  if (result.length > MAX_ROWS) throw new Error(`O arquivo possui ${result.length} registros. O limite por importação é ${MAX_ROWS}.`)
  return result
}

export default function CustomerImportPanel({ organization, userId, onImported }) {
  const [authorized, setAuthorized] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [file, setFile] = useState(null)
  const [parsedRows, setParsedRows] = useState([])
  const [analysis, setAnalysis] = useState(null)
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

  async function chooseFile(event) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    setMessage('')
    setAnalysis(null)
    setBatchId(null)
    setParsedRows([])
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
      const rows = await parseWorkbook(selected)
      setFile(selected)
      setParsedRows(rows)
      setMessage(`Arquivo lido: ${rows.length} registro(s) preparado(s) para validação.`)
      setShow(true)
    } catch (error) {
      setMessage(error.message || 'Não foi possível ler a planilha.')
    } finally {
      setBusy(false)
    }
  }

  async function analyze() {
    if (!file || !parsedRows.length) return
    setBusy(true)
    setMessage('')
    let createdBatch = null
    try {
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
    if (!batchId || !analysis || Number(analysis.invalid || 0) > 0) return
    setBusy(true)
    setMessage('')
    try {
      const { data, error } = await supabase.rpc('commit_customer_import', { p_batch_id: batchId, p_duplicate_action: duplicateAction })
      if (error) throw error
      setMessage(`Importação concluída: ${Number(data?.imported || 0)} registro(s) importado(s), ${Number(data?.updated || 0)} atualizado(s) e ${Number(data?.skipped || 0)} ignorado(s).`)
      setFile(null)
      setParsedRows([])
      setAnalysis(null)
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
            <label className="primary inline-btn customer-import-file-button">
              <Upload size={17}/>{busy ? 'Processando...' : 'Selecionar arquivo'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={chooseFile} disabled={busy} hidden />
            </label>
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

          {parsedRows.length > 0 && !analysis && (
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

          {message && <div className="notice">{message}</div>}
          <p className="muted customer-import-help">Estrutura aceita: aba “Clientes” e, opcionalmente, abas “Histórico” e “Vendas”. Limite de 5 MB e 5.000 registros por importação.</p>
        </div>
      )}
    </section>
  )
}
