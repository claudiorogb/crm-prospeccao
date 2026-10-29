import React from 'react'
import { ChevronRight } from 'lucide-react'
import { supabase } from './lib/supabase'
import { findDuplicateGroups } from './duplicates-rules.js'

const FIELDS = 'id,business_name,phone,whatsapp_phone,email,website,status,created_at,campaigns(name)'
const BATCH = 1000
const MAX_ROWS = 20000

// Somente leitura, sempre filtrando pela empresa.
export async function loadDuplicateGroups(organizationId) {
  const rows = []
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { data, error } = await supabase.from('leads').select(FIELDS)
      .eq('organization_id', organizationId).is('deleted_at', null)
      .order('id', { ascending: true }).range(from, from + BATCH - 1)
    if (error) return { error, groups: [] }
    rows.push(...(data || []))
    if (!data || data.length < BATCH) break
  }
  return { error: null, groups: findDuplicateGroups(rows) }
}

const STATUS = {
  captured_pending: 'Captação', new: 'Novo', qualified: 'Qualificado', queued: 'Na fila', contacted: 'Contatado', contacted_pending: 'Contatado',
  replied: 'Respondeu', interested: 'Interessado', proposal: 'Proposta', negotiation: 'Negociação', won: 'Ganho', lost: 'Perdido',
  not_interested: 'Sem interesse', discarded: 'Descartado'
}

export default function DuplicatesTab({ groups, onOpenLead }) {
  if (!groups.length) {
    return <div className="today-empty-v111"><h2>Nenhum duplicado encontrado</h2><p className="muted">Comparamos telefone, e-mail e site entre todos os leads da empresa.</p></div>
  }
  return (
    <>
      <p className="muted" style={{ padding: '0 4px 8px' }}>Estes leads parecem ser a mesma empresa. Nada é mesclado ou apagado automaticamente: abra cada um e decida.</p>
      {groups.map(group => (
        <article className="today-row-v111" key={group.key} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <strong>{group.reason}: {group.key.split(':').slice(1).join(':')}</strong>
          {group.leads.map(lead => (
            <div key={lead.id} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>{lead.business_name} • {STATUS[lead.status] || lead.status}{lead.campaigns?.name ? ` • ${lead.campaigns.name}` : ''}</span>
              <button type="button" className="secondary inline-btn" onClick={() => onOpenLead(lead)}>Abrir lead <ChevronRight size={15} /></button>
            </div>
          ))}
        </article>
      ))}
    </>
  )
}
