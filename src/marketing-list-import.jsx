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

export default function MarketingListImport({ organization, onImported, onManualAdded, standalone = false, mode = 'both' }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [source, setSource] = useState('Lista própria importada')
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [manualEmail, setManualEmail] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualCompany, setManualCompany] = useState('')
  const [manualConfirmed, setManualConfirmed] = useState(false)
  const [manualMessage, setManualMessage] = useState('')

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

  async function addManualRecipient() {
    const normalizedEmail = manualEmail.trim().toLowerCase()
    if (!validEmail(normalizedEmail)) return setManualMessage('Informe um e-mail válido.')
    if (!manualConfirmed) return setManualMessage('Confirme que este contato pode receber comunicações de e-mail marketing.')
    setLoading(true)
    setManualMessage('')
    try {
      const { error } = await supabase.rpc('import_email_marketing_contacts', {
        p_organization_id: organization.id,
        p_contacts: [{
          email: normalizedEmail,
          contact_name: manualName.trim(),
          company_name: manualCompany.trim(),
          source: 'Inserido manualmente'
        }],
        p_source: 'Inserido manualmente',
        p_confirmed: true
      })
      if (error) throw error

      const { data: contact, error: contactError } = await supabase
        .from('email_marketing_contacts')
        .select('id,email,contact_name,company_name,source,status,consent_confirmed,unsubscribed_at')
        .eq('organization_id', organization.id)
        .eq('email_normalized', normalizedEmail)
        .maybeSingle()
      if (contactError) throw contactError
      if (!contact) throw new Error('O destinatário foi salvo, mas não pôde ser carregado novamente.')
      if (contact.status !== 'active' || contact.unsubscribed_at) {
        setManualMessage('Este endereço está descadastrado e não pode ser usado em campanhas.')
        if (onImported) await onImported()
        return
      }

      setManualEmail('')
      setManualName('')
      setManualCompany('')
      setManualConfirmed(false)
      setManualMessage(standalone ? 'E-mail incluído na lista.' : 'Destinatário adicionado e selecionado para a campanha.')
      if (onManualAdded) await onManualAdded(contact)
      else if (onImported) await onImported()
    } catch (error) {
      setManualMessage(error.message || 'Não foi possível adicionar o destinatário.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="email-marketing-import-box">
      {mode !== 'import' && <div className="email-manual-recipient-box">
        <div className="email-marketing-import-head">
          <div>
            <strong>Adicionar destinatário manualmente</strong>
          </div>
        </div>
        <div className="email-manual-recipient-grid">
          <label>
            E-mail *
            <input type="email" value={manualEmail} onChange={e => setManualEmail(e.target.value)} placeholder="contato@empresa.com.br" />
          </label>
          <label>
            Nome
            <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Nome do contato" />
          </label>
          <label>
            Empresa
            <input value={manualCompany} onChange={e => setManualCompany(e.target.value)} placeholder="Empresa" />
          </label>
        </div>
        <label className="email-marketing-confirm">
          <input type="checkbox" checked={manualConfirmed} onChange={e => setManualConfirmed(e.target.checked)} />
          <span>Confirmo que este contato pertence à base própria da empresa e pode receber comunicações de e-mail marketing. Não é um contato de prospecção fria.</span>
        </label>
        <div className="form-actions">
          <button type="button" className="secondary" disabled={loading || !validEmail(manualEmail) || !manualConfirmed} onClick={addManualRecipient}>
            {loading ? 'Adicionando...' : standalone ? 'Adicionar à lista' : 'Adicionar e selecionar'}
          </button>
        </div>
        {manualMessage && <div className="notice">{manualMessage}</div>}
      </div>}

      {mode === 'both' && <div className="email-marketing-import-divider"><span>ou importe uma lista</span></div>}

      {mode !== 'manual' && <>

      <div className="email-marketing-import-head">
        <div>
          <strong>Lista de E-mail Marketing</strong>
          <span>Importe uma lista própria em Excel ou CSV.</span>
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
      </>}
    </div>
  )
}
