import React, { useState } from 'react'
import { Download, ArrowRight } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'

function downloadCsv(rows, fileName) {
  const headers = [
    ['Empresa / Cliente','business_name'],
    ['Razão social','legal_name'],
    ['CNPJ / CPF','cnpj'],
    ['Contato','contact_name'],
    ['Cargo','contact_role'],
    ['Telefone','phone'],
    ['WhatsApp','whatsapp_phone'],
    ['E-mail','email'],
    ['Site','website'],
    ['Endereço','address'],
    ['Cidade','city'],
    ['UF','state'],
    ['Status','status'],
    ['Último contato','last_contact_date'],
    ['Próximo contato','next_contact_date'],
    ['Observações comerciais','commercial_notes'],
    ['Valor da proposta','proposal_value'],
    ['Valor renegociado','renegotiated_value'],
    ['Valor do contrato','contract_value']
  ]
  const data = [
    headers.map(([label]) => label),
    ...rows.map(row => headers.map(([, key]) => row[key] ?? ''))
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Informações comerciais')
  XLSX.writeFile(wb, fileName, { compression: true })
}

export default function TrialExpiredScreen({ organization, userId, userEmail, onLogout }) {
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function downloadCommercialData() {
    if (downloading) return
    setDownloading(true)
    setMessage('')
    setError('')
    try {
      const { data: identity, error: identityError } = await supabase.auth.getUser()
      if (identityError || identity?.user?.id !== userId) throw new Error('Sua sessão expirou. Entre novamente.')
      const { data: rows, error: rowsError } = await supabase
        .from('leads')
        .select('business_name,legal_name,cnpj,contact_name,contact_role,phone,whatsapp_phone,email,website,address,city,state,status,last_contact_date,next_contact_date,commercial_notes,proposal_value,renegotiated_value,contract_value')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
      if (rowsError) throw rowsError
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date())
      downloadCsv(rows || [], `AXIVA_Dados_Comerciais_${today}.xlsx`)
      setMessage(`Download concluído: ${rows?.length || 0} registro(s).`)
    } catch (err) {
      setError(err?.message || 'Não foi possível gerar o arquivo.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card access-state-card" style={{ maxWidth: 620 }}>
        <div className="brand-mark">AX</div>
        <span className="eyebrow">PERÍODO DE TESTE ENCERRADO</span>
        <h1>Seu teste de 30 dias terminou</h1>
        <p className="muted">
          Seus dados comerciais continuam armazenados no AXIVA CRM. Neste momento, seu acesso está limitado à visualização do Kanban.
        </p>
        <div className="panel" style={{ margin: '20px 0', textAlign: 'left' }}>
          <strong>O que você pode fazer agora</strong>
          <p className="muted">Visualizar seus dados no Kanban ou baixar as informações comerciais cadastradas.</p>
        </div>
        {message && <div className="notice" role="status">{message}</div>}
        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="access-actions" style={{ flexDirection: 'column' }}>
          <button className="secondary full" onClick={downloadCommercialData} disabled={downloading}>
            <Download size={17} /> {downloading ? 'Preparando download...' : 'Baixar informações comerciais'}
          </button>
          <button className="primary full" onClick={() => { window.location.href = '/crm/precos' }}>
            <ArrowRight size={17} /> Continuar usando o CRM
          </button>
          <button className="text-button" onClick={onLogout}>Sair</button>
        </div>
        <div className="access-email">{userEmail}</div>
      </section>
    </main>
  )
}
