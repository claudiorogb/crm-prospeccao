import React, { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Download } from 'lucide-react'
import { supabase } from './lib/supabase'
import { createCrmWorkbook, fetchCrmExport } from './crm-full-export-core.js'

const datasetLabels = {
  leads: 'Leads', clients: 'Clientes', activities: 'Contatos',
  journey: 'Histórico comercial', tasks: 'Tarefas', sales: 'Vendas'
}

// Only the organization's authenticated owner/admin can export the entire
// commercial database. The database RPC independently checks this on every page.
export default function CrmFullExport({ organization, userId }) {
  const [authorized, setAuthorized] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const mounted = useRef(null)

  useEffect(() => {
    let active = true
    const organizationId = organization?.id
    mounted.current = { organizationId, userId }
    setAuthorized(false)
    setErrorMessage('')
    async function checkAccess() {
      if (!organizationId || !userId) return
      const { data: identity, error: identityError } = await supabase.auth.getUser()
      if (identityError || identity?.user?.id !== userId) return
      const { data: member, error } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .in('role', ['owner', 'admin'])
        .maybeSingle()
      if (active && !error) setAuthorized(Boolean(member))
    }
    checkAccess()
    return () => { active = false; mounted.current = null }
  }, [organization?.id, userId])

  async function downloadFullExport() {
    if (!authorized || exporting || !organization?.id || !userId) return
    const orgId = organization.id
    const ownerId = userId
    setExporting(true)
    setErrorMessage('')
    setProgress('Confirmando acesso...')
    try {
      const { data: identity, error: identityError } = await supabase.auth.getUser()
      if (identityError || identity?.user?.id !== ownerId) throw new Error('Sua sessão expirou. Entre novamente para exportar.')
      const { data: member, error: memberError } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', orgId)
        .eq('user_id', ownerId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .in('role', ['owner', 'admin'])
        .maybeSingle()
      if (memberError || !member) throw new Error('Somente administradores da empresa podem exportar todos os dados.')

      const records = await fetchCrmExport(supabase, orgId, (kind, count) => {
        if (mounted.current?.organizationId === orgId && mounted.current?.userId === ownerId) {
          setProgress(`Preparando ${datasetLabels[kind] || kind}: ${count} registro(s)...`)
        }
      })
      if (mounted.current?.organizationId !== orgId || mounted.current?.userId !== ownerId) {
        throw new Error('A empresa ou a sessão foi alterada durante a exportação.')
      }
      const { data: finalIdentity, error: finalError } = await supabase.auth.getUser()
      if (finalError || finalIdentity?.user?.id !== ownerId) throw new Error('Sua sessão foi encerrada durante a exportação.')
      setProgress('Gerando o arquivo Excel...')
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date())
      const workbook = createCrmWorkbook(XLSX, records, today)
      if (mounted.current?.organizationId !== orgId || mounted.current?.userId !== ownerId) {
        throw new Error('A empresa ou a sessão foi alterada durante a exportação.')
      }
      XLSX.writeFile(workbook, `AXIVA_CRM_${today}_${orgId.slice(0, 8)}.xlsx`, { compression: true })
      setProgress('Excel gerado com as abas Leads, Clientes, Contatos, Tarefas e Vendas.')
    } catch (error) {
      setProgress('')
      setErrorMessage(error?.message || 'Não foi possível exportar. Nenhum arquivo parcial foi gerado.')
    } finally {
      if (mounted.current?.organizationId === orgId && mounted.current?.userId === ownerId) setExporting(false)
    }
  }

  if (!authorized) return null
  return (
    <section className="panel" aria-label="Exportação completa do CRM">
      <div className="panel-head">
        <div>
          <h2>Exportação completa</h2>
          <p className="muted">Baixe um único Excel com Leads, Clientes, Contatos, Tarefas e Vendas da sua empresa, incluindo registros comerciais arquivados.</p>
          <p className="muted">Tarefas correspondem às datas de próximo contato registradas no CRM. Este arquivo não substitui um backup técnico do banco.</p>
        </div>
        <button type="button" className="secondary inline-btn" onClick={downloadFullExport} disabled={exporting}>
          <Download size={17}/>{exporting ? 'Preparando Excel...' : 'Exportar dados completos'}
        </button>
      </div>
      {progress && <div className="notice" role="status">{progress}</div>}
      {errorMessage && <div className="notice error" role="alert">{errorMessage}</div>}
    </section>
  )
}
