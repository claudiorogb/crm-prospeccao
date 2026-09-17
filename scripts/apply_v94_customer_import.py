from pathlib import Path

path = Path('src/customer-import.jsx')
text = path.read_text(encoding='utf-8')
if 'V94_CUSTOMER_IMPORT_DIAGNOSTICS' in text:
    print('V94 already applied')
    raise SystemExit(0)

def replace_once(old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'V94 halted: expected one anchor, got {count}: {old[:85]!r}')
    text = text.replace(old, new, 1)

replace_once("import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, RefreshCw }", "import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, RefreshCw }")
replace_once("business_name: ['empresa / cliente','empresa','cliente','nome fantasia','nome']", "business_name: ['empresa / cliente','empresa','cliente','nome fantasia','nome','nome do cliente']")
key_anchor = "keyName: ['empresa / cliente','empresa','cliente']"
if text.count(key_anchor) != 2:
    raise SystemExit('V94 halted: activity and sale alias anchors changed')
text = text.replace(key_anchor, "keyName: ['empresa / cliente','empresa','cliente','nome do cliente']", 2)

start = text.index('function rowsFromSheet(sheet) {')
end = text.index('\nasync function sha256(file) {', start)
text = text[:start] + '''// V94_CUSTOMER_IMPORT_DIAGNOSTICS — template and detailed local validation.
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
  const match = String(value || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})$/)
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
    if (data.email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(data.email)) errors.push(importIssue(row.sheet_name, row.row_number, 'E-mail', 'Informe um endereço de e-mail válido.'))
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
''' + text[end:]

start = text.index('async function parseWorkbook(file) {')
end = text.index('\nexport default function CustomerImportPanel', start)
text = text[:start] + '''async function parseWorkbook(file) {
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
''' + text[end:]

replace_once("  const [analysis, setAnalysis] = useState(null)", "  const [analysis, setAnalysis] = useState(null)\n  const [validationErrors, setValidationErrors] = useState([])")
replace_once("  const localSummary = useMemo(() => summarizeRows(parsedRows), [parsedRows])", "  const localSummary = useMemo(() => summarizeRows(parsedRows), [parsedRows])\n\n  useEffect(() => {\n    setFile(null)\n    setParsedRows([])\n    setAnalysis(null)\n    setValidationErrors([])\n    setBatchId(null)\n  }, [organization.id, userId])")
replace_once("    setParsedRows([])\n    setFile(null)\n    if (selected.size", "    setParsedRows([])\n    setValidationErrors([])\n    setFile(null)\n    if (selected.size")
replace_once("      const rows = await parseWorkbook(selected)\n      setFile(selected)\n      setParsedRows(rows)\n      setMessage(`Arquivo lido: ${rows.length} registro(s) preparado(s) para validação.`)", "      const { rows, errors } = await parseWorkbook(selected)\n      setFile(selected)\n      setParsedRows(rows)\n      setValidationErrors(errors)\n      setMessage(errors.length ? `Encontrados ${errors.length} problema(s). Corrija as linhas indicadas e selecione o arquivo novamente.` : `Arquivo lido: ${rows.length} registro(s) preparado(s) para validação.`)")
replace_once("    if (!file || !parsedRows.length) return", "    if (!file || !parsedRows.length || validationErrors.length || !authorized) return")
replace_once("      const hash = await sha256(file)", "      const { data: identity, error: identityError } = await supabase.auth.getUser()\n      if (identityError || identity?.user?.id !== userId) throw new Error('Sessão inválida. Entre novamente no CRM.')\n      const { data: membership, error: membershipError } = await supabase.from('organization_members').select('role,is_active').eq('organization_id', organization.id).eq('user_id', userId).maybeSingle()\n      if (membershipError || !membership?.is_active || !['owner', 'admin'].includes(membership.role)) throw new Error('Somente o administrador da empresa ativa pode importar clientes.')\n      const hash = await sha256(file)")
replace_once("      setAnalysis(data)\n      setMessage('Validação concluída. Revise o resumo antes de confirmar.')", "      const details = []\n      if (Number(data.invalid || 0) > 0) {\n        for (let offset = 0; offset < Number(data.invalid); offset += 500) {\n          const { data: invalidRows, error: detailsError } = await supabase.from('customer_import_rows')\n            .select('sheet_name,row_number,row_type,error_code,error_message')\n            .eq('batch_id', batch.id).eq('organization_id', organization.id).eq('status', 'invalid')\n            .order('sheet_name').order('row_number').range(offset, offset + 499)\n          if (detailsError) throw detailsError\n          details.push(...(invalidRows || []))\n        }\n        if (details.length !== Number(data.invalid)) throw new Error('Não foi possível recuperar todos os erros da validação. Nenhuma importação foi feita.')\n      }\n      setValidationErrors(details.map(row => importIssue(row.sheet_name, row.row_number, SERVER_ERROR_COLUMNS[row.error_code] || 'Registro', row.error_message || 'Registro inválido.')))\n      setAnalysis(data)\n      setMessage('Validação concluída. Revise o resumo antes de confirmar.')")
replace_once("    if (!batchId || !analysis || Number(analysis.invalid || 0) > 0) return", "    if (!batchId || !analysis || Number(analysis.invalid || 0) > 0 || validationErrors.length || !authorized) return")
replace_once("    try {\n      const { data, error } = await supabase.rpc('commit_customer_import'", "    try {\n      const { data: identity, error: identityError } = await supabase.auth.getUser()\n      if (identityError || identity?.user?.id !== userId) throw new Error('Sessão inválida. Entre novamente no CRM.')\n      const { data: ownedBatch, error: ownershipError } = await supabase.from('customer_import_batches')\n        .select('id').eq('id', batchId).eq('organization_id', organization.id).eq('requested_by', userId).eq('status', 'analyzed').maybeSingle()\n      if (ownershipError || !ownedBatch) throw new Error('Esta importação não pertence à empresa ativa ou à sua sessão. Reenvie a planilha.')\n      const { data, error } = await supabase.rpc('commit_customer_import'")
replace_once("      setAnalysis(null)\n      setBatchId(null)\n      await onImported?.()", "      setAnalysis(null)\n      setValidationErrors([])\n      setBatchId(null)\n      await onImported?.()")
replace_once('''            <label className="primary inline-btn customer-import-file-button">''', '''            <div className="customer-import-head-buttons">
            <button type="button" className="secondary inline-btn" onClick={downloadTemplate} disabled={busy}><Download size={17}/> Baixar modelo de importação</button>
            <label className="primary inline-btn customer-import-file-button">''')
replace_once('''              <input type="file" accept=".xlsx,.xls,.csv" onChange={chooseFile} disabled={busy} hidden />
            </label>''', '''              <input type="file" accept=".xlsx,.xls,.csv" onChange={chooseFile} disabled={busy} hidden />
            </label>
            </div>''')
replace_once("{parsedRows.length > 0 && !analysis && (", "{parsedRows.length > 0 && !analysis && validationErrors.length === 0 && (")
replace_once('''          {message && <div className="notice">{message}</div>}''', '''          {validationErrors.length > 0 && (
            <div className="customer-import-errors" role="alert">
              <strong>Problemas encontrados ({validationErrors.length})</strong>
              <div className="customer-import-errors-scroll">
                <table><thead><tr><th>Aba</th><th>Linha</th><th>Coluna</th><th>Motivo / como corrigir</th></tr></thead>
                <tbody>{validationErrors.map((issue, index) => <tr key={`${issue.sheet_name}-${issue.row_number}-${issue.column}-${index}`}><td>{issue.sheet_name}</td><td>{issue.row_number}</td><td>{issue.column}</td><td>{issue.reason}</td></tr>)}</tbody></table>
              </div>
            </div>
          )}
          {message && <div className="notice">{message}</div>}''')

path.write_text(text, encoding='utf-8')
styles_path = Path('src/styles.css')
styles = styles_path.read_text(encoding='utf-8')
marker = '/* V94 CUSTOMER IMPORT DIAGNOSTICS */'
if marker not in styles:
    styles += '''\n/* V94 CUSTOMER IMPORT DIAGNOSTICS */
.customer-import-head-buttons { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.customer-import-errors { margin-top: 16px; border: 1px solid #fecaca; background: #fff7f7; border-radius: 10px; padding: 12px; }
.customer-import-errors > strong { color: #991b1b; display: block; margin-bottom: 10px; }
.customer-import-errors-scroll { overflow-x: auto; max-height: 380px; overflow-y: auto; }
.customer-import-errors table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
.customer-import-errors th, .customer-import-errors td { padding: 8px 12px; border-bottom: 1px solid #fecaca; vertical-align: top; }
.customer-import-errors th { position: sticky; top: 0; background: #fff7f7; }
@media (max-width: 760px) { .customer-import-head-buttons { width: 100%; flex-direction: column; align-items: stretch; } .customer-import-head-buttons .inline-btn { justify-content: center; width: 100%; } }
'''
    styles_path.write_text(styles, encoding='utf-8')
print('V94 applied: template, per-cell errors, tenant/session checks')
