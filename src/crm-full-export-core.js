// AXIVA CRM — complete commercial-data export. No writes or service-role credentials.
export const EXPORT_DATASETS = ['leads', 'clients', 'activities', 'journey', 'tasks', 'sales']
const PAGE_SIZE = 500
const MAX_EXCEL_ROWS = 1048575 // One header row is reserved per worksheet.

const labelStatus = {
  new: 'Novo', queued: 'Na fila', contacted: 'Contatado', replied: 'Respondeu',
  interested: 'Interessado', proposal: 'Proposta', negotiation: 'Negociação',
  won: 'Ganho', lost: 'Perdido', not_interested: 'Sem interesse', discarded: 'Descartado'
}

function text(value) {
  const valueText = String(value ?? '')
  if (valueText.length > 32767) throw new Error('Há um texto que ultrapassa o limite de uma célula do Excel. Nenhum arquivo incompleto foi gerado.')
  // Never interpret imported names, notes or other untrusted fields as formulas.
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(valueText) ? `'${valueText}` : valueText
}

function money(value) {
  if (value === null || value === undefined || value === '') return ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error('Foi encontrado um valor financeiro inválido. A exportação foi interrompida.')
  return parsed
}

function dateTime(value) { return value ? text(value) : '' }

function declineDate(lead) {
  if (lead.status !== 'lost' || !lead.status_changed_at) return ''
  const date = new Date(lead.status_changed_at)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const part = name => parts.find(item => item.type === name)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function taskStatus(task, today) {
  if (task.deleted_at) return 'Cadastro arquivado'
  if (['won', 'lost', 'not_interested', 'discarded'].includes(task.status) && task.status !== 'won') return 'Negócio encerrado'
  if (task.next_contact_date < today) return 'Atrasado'
  if (task.next_contact_date === today) return 'Hoje'
  return 'Pendente'
}

/** Read every page from the *server-authorized*, organization-filtered export RPC.
 *  The RPC checks the logged-in member's owner/admin role for every page. */
export async function fetchCrmExport(supabase, organizationId, onProgress = () => {}) {
  if (!organizationId || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(organizationId)) {
    throw new Error('Empresa inválida para exportação.')
  }
  const collected = {}
  for (const kind of EXPORT_DATASETS) {
    let after = null
    let previous = null
    const rows = []
    let pages = 0
    while (true) {
      const { data, error } = await supabase.rpc('export_crm_data_page', {
        p_organization_id: organizationId, p_dataset: kind,
        p_after_id: after, p_page_size: PAGE_SIZE
      })
      if (error) throw new Error(`Falha ao obter ${kind}: ${error.message || 'acesso negado'}`)
      if (!Array.isArray(data) || data.length > PAGE_SIZE) throw new Error(`Resposta inválida ao exportar ${kind}.`)
      for (const row of data) {
        if (!row || row.organization_id !== organizationId || row.id === null || row.id === undefined) {
          throw new Error('Exportação interrompida: resposta de empresa ou registro incompatível.')
        }
        const id = String(row.id)
        if (previous !== null && id === previous) throw new Error('Paginação inconsistente na exportação.')
        previous = id
        rows.push(row)
      }
      if (rows.length > MAX_EXCEL_ROWS) throw new Error('A exportação ultrapassou o limite de linhas do Excel. Nenhum arquivo parcial foi gerado.')
      onProgress(kind, rows.length)
      pages += 1
      if (data.length < PAGE_SIZE) break
      if (!data.length || pages > 2100) throw new Error('Paginação excessiva: exportação interrompida sem gerar arquivo parcial.')
      const lastId = String(data[data.length - 1].id)
      if (lastId === after) throw new Error('Paginação sem progresso: exportação interrompida.')
      after = lastId
    }
    collected[kind] = rows
  }
  return collected
}

const cadastroHeaders = [
  'ID do cadastro', 'Empresa / Cliente', 'Razão social', 'CNPJ / CPF', 'Segmento',
  'Nome do contato', 'Cargo', 'Telefone', 'WhatsApp', 'E-mail', 'Site', 'Endereço',
  'Cidade', 'UF', 'Origem', 'ID da campanha', 'ID do público-alvo', 'Status comercial',
  'Último contato', 'Próximo contato', 'Valor da proposta (R$)', 'Proposta enviada',
  'Valor renegociado (R$)', 'Valor do contrato (R$)', 'Assinatura do contrato',
  'Data de declínio', 'Anotações comerciais', 'ID do responsável', 'Data do cadastro',
  'Data da última mudança de etapa', 'Arquivado em'
]

function cadastroRow(row) {
  return [text(row.id), text(row.business_name), text(row.legal_name), text(row.cnpj),
    text(row.segment), text(row.contact_name), text(row.contact_role), text(row.phone),
    text(row.whatsapp_phone), text(row.email), text(row.website), text(row.address),
    text(row.city), text(row.state), text(row.source), text(row.campaign_id),
    text(row.target_segment_id), text(labelStatus[row.status] || row.status),
    text(row.last_contact_date), text(row.next_contact_date), money(row.proposal_value),
    text(row.proposal_sent_at), money(row.renegotiated_value), money(row.contract_value),
    text(row.contract_signed_at), declineDate(row), text(row.commercial_notes),
    text(row.assigned_to), dateTime(row.created_at), dateTime(row.status_changed_at),
    dateTime(row.deleted_at)]
}

export function buildCrmExportSheets(records, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('Data de exportação inválida.')
  for (const kind of EXPORT_DATASETS) if (!Array.isArray(records[kind])) throw new Error(`Dados ausentes: ${kind}.`)
  const all = [...records.leads, ...records.clients]
  const byId = new Map(all.map(row => [row.id, row.business_name]))
  if (byId.size !== all.length) throw new Error('Há IDs de cadastros duplicados na exportação.')
  const lookup = leadId => text(byId.get(leadId) || '')

  const contacts = [
    ...records.activities.map(row => ({
      date: row.occurred_at, values: [text(`atividade:${row.id}`), text(row.lead_id), lookup(row.lead_id),
        text(row.activity_type), '', text(row.channel), dateTime(row.occurred_at),
        text(row.notes), '', '', '', text(row.created_by), dateTime(row.created_at)]
    })),
    ...records.journey.map(row => ({
      date: row.created_at, values: [text(`jornada:${row.id}`), text(row.lead_id), lookup(row.lead_id),
        'Registro de etapa', text(labelStatus[row.stage] || row.stage), '', dateTime(row.created_at),
        text(row.note), money(row.proposal_value), money(row.renegotiated_value),
        money(row.contract_value), text(row.created_by), dateTime(row.created_at)]
    }))
  ].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  if (contacts.length > MAX_EXCEL_ROWS) throw new Error('O histórico de contatos excede o limite de linhas do Excel.')

  const sheets = [
    { name: 'Leads', headers: cadastroHeaders, rows: records.leads.map(cadastroRow) },
    { name: 'Clientes', headers: cadastroHeaders, rows: records.clients.map(cadastroRow) },
    { name: 'Contatos', headers: ['ID do registro', 'ID do lead / cliente', 'Empresa / Cliente', 'Tipo',
      'Etapa', 'Canal', 'Data e hora', 'Observação', 'Proposta (R$)', 'Renegociado (R$)',
      'Contrato (R$)', 'ID do autor', 'Criado em'], rows: contacts.map(row => row.values) },
    { name: 'Tarefas', headers: ['ID da tarefa', 'ID do lead / cliente', 'Empresa / Cliente', 'Contato',
      'Tipo', 'Data prevista', 'Situação na data da exportação', 'Status comercial', 'Cadastro arquivado em'],
      rows: records.tasks.map(row => [text(`proximo-contato:${row.id}`), text(row.id),
        lookup(row.id), text(row.contact_name), 'Próximo contato', text(row.next_contact_date),
        taskStatus(row, today), text(labelStatus[row.status] || row.status), dateTime(row.deleted_at)]) },
    { name: 'Vendas', headers: ['ID da venda', 'ID do lead / cliente', 'Empresa / Cliente', 'Data da venda',
      'Valor (R$)', 'Produto / serviço', 'Observação', 'Origem', 'ID do autor', 'Criado em', 'Arquivada em'],
      rows: records.sales.map(row => [text(row.id), text(row.lead_id), lookup(row.lead_id),
        text(row.sale_date), money(row.amount), text(row.product_service), text(row.notes),
        text(row.origin), text(row.created_by), dateTime(row.created_at), dateTime(row.deleted_at)]) }
  ]
  for (const sheet of sheets) if (sheet.rows.length > MAX_EXCEL_ROWS) throw new Error(`A aba ${sheet.name} excede o limite do Excel.`)
  return sheets
}

export function createCrmWorkbook(XLSX, records, today) {
  const workbook = XLSX.utils.book_new()
  const sheets = buildCrmExportSheets(records, today)
  for (const { name, headers, rows } of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
    worksheet['!cols'] = headers.map(header => ({ wch: Math.min(34, Math.max(17, header.length + 2)) }))
    worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}` }
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
  }
  return workbook
}
