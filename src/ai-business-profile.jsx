import React, { useEffect, useState } from 'react'
import { Save, Settings, Sparkles, X } from 'lucide-react'
import { supabase } from './lib/supabase'

export const AI_PROFILE_MAX = 2000

// Cada campo vira uma linha "Rótulo: texto" no mesmo campo de texto do banco.
export const AI_PROFILE_FIELDS = [
  { key: 'offer', label: 'O que oferecemos', max: 480, rows: 4, help: 'Liste os serviços e itens que vende.', placeholder: 'Ex.: locação de freezer, fritadeira, forno e balcões para cozinha industrial.' },
  { key: 'how', label: 'Como funciona', max: 450, rows: 4, help: 'Ex.: contrato mínimo, entrega e instalação, manutenção, troca em caso de defeito, regiões atendidas.', placeholder: 'Ex.: contrato mínimo de 6 meses, entrega e instalação inclusas, manutenção e troca em caso de defeito, atendemos Campinas e região.' },
  { key: 'edge', label: 'Diferenciais', max: 300, rows: 3, help: 'Por que escolher a sua empresa.', placeholder: 'Ex.: sem investimento inicial, equipamento sempre revisado, atendimento rápido.' },
  { key: 'tone', label: 'Tom de voz', max: 150, rows: 2, help: 'Ex.: cordial, direto ou sem formalidade exagerada.', placeholder: 'Ex.: cordial e direto, sem formalidade exagerada.' },
  { key: 'avoid', label: 'Não prometer', max: 300, rows: 3, help: 'Ex.: preço fechado, prazo de entrega ou desconto sem aprovação.', placeholder: 'Ex.: preço fechado, prazo de entrega e desconto sem aprovação.' },
  { key: 'next', label: 'Próximo passo', max: 200, rows: 2, help: 'Ex.: enviar proposta ou orçamento (diga quem faz).', placeholder: 'Ex.: o comercial envia a proposta por WhatsApp.' },
]

const clean = value => String(value || '').replace(/\s*\n\s*/g, ' ').trim()

export function serializeAiProfile(values) {
  return AI_PROFILE_FIELDS
    .map(field => {
      const text = clean(values[field.key]).slice(0, field.max)
      return text ? `${field.label}: ${text}` : ''
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, AI_PROFILE_MAX)
}

export function parseAiProfile(text) {
  const values = Object.fromEntries(AI_PROFILE_FIELDS.map(field => [field.key, '']))
  const lines = String(text || '').split('\n')
  let matched = false
  for (const line of lines) {
    const field = AI_PROFILE_FIELDS.find(item => line.startsWith(`${item.label}:`))
    if (field) {
      values[field.key] = line.slice(field.label.length + 1).trim()
      matched = true
    }
  }
  // Texto livre antigo (sem os rótulos) é preservado no primeiro campo.
  if (!matched && String(text || '').trim()) values.offer = clean(text).slice(0, AI_PROFILE_FIELDS[0].max)
  return values
}

export default function AiBusinessProfile({ organization }) {
  const [values, setValues] = useState(() => parseAiProfile(''))
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [canEdit, setCanEdit] = useState(false)

  async function load() {
    const { data } = await supabase.from('organization_settings')
      .select('ai_business_profile')
      .eq('organization_id', organization.id)
      .maybeSingle()
    setValues(parseAiProfile(data?.ai_business_profile))
    // Somente admin/dono da empresa configura (o banco também bloqueia os demais).
    const { data: auth } = await supabase.auth.getUser()
    const userId = auth?.user?.id
    if (userId) {
      const { data: member } = await supabase.from('organization_members')
        .select('role')
        .eq('organization_id', organization.id)
        .eq('user_id', userId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle()
      setCanEdit(['admin', 'owner'].includes(member?.role))
    } else {
      setCanEdit(false)
    }
    setLoaded(true)
  }

  useEffect(() => {
    setLoaded(false)
    setOpen(false)
    setMessage('')
    load()
  }, [organization.id])

  const filled = AI_PROFILE_FIELDS.filter(field => clean(values[field.key])).length

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    const text = serializeAiProfile(values)
    const { data, error } = await supabase.from('organization_settings')
      .update({ ai_business_profile: text || null })
      .eq('organization_id', organization.id)
      .select('organization_id')
    setSaving(false)
    if (error) setMessage(error.message)
    else if (!data?.length) setMessage('Somente o administrador da empresa pode alterar esta configuração.')
    else {
      setMessage('Configuração salva. A IA já vai usar nas próximas sugestões.')
      setOpen(false)
    }
  }

  return (
    <section className="panel">
      <span className="eyebrow">IA DO WHATSAPP</span>
      <h2><Sparkles size={18}/> Perfil da empresa para a IA</h2>
      <p className="muted">
        Usado pelo botão "Responder com IA". Quanto melhor você descrever a empresa, melhores serão as sugestões.
        A IA só sugere o texto; quem decide enviar é você.
      </p>

      {!open && (
        <>
          <div className="notice compact-notice">
            {filled === 0
              ? 'A IA ainda não foi configurada para esta empresa. As respostas ficam genéricas até você preencher.'
              : `${filled} de ${AI_PROFILE_FIELDS.length} campos preenchidos.`}
          </div>
          {canEdit ? (
            <div className="form-actions">
              <button type="button" className="primary inline-btn" onClick={() => { setMessage(''); setOpen(true) }} disabled={!loaded}>
                <Settings size={16}/> Configurar IA
              </button>
            </div>
          ) : (
            loaded && <p className="muted">Somente administradores da empresa podem configurar a IA.</p>
          )}
        </>
      )}

      {open && canEdit && (
        <form onSubmit={save}>
          {AI_PROFILE_FIELDS.map(field => (
            <label key={field.key}>
              {field.label}
              <small className="muted">{field.help}</small>
              <textarea
                rows={field.rows}
                value={values[field.key]}
                maxLength={field.max}
                placeholder={field.placeholder}
                onChange={e => setValues({ ...values, [field.key]: e.target.value })}
              />
              <small className="muted">{values[field.key].length}/{field.max}</small>
            </label>
          ))}
          <div className="form-actions">
            <button className="primary inline-btn" disabled={saving}><Save size={16}/> {saving ? 'Salvando...' : 'Salvar'}</button>
            <button type="button" className="secondary inline-btn" onClick={() => { setOpen(false); load() }}><X size={16}/> Cancelar</button>
          </div>
        </form>
      )}

      {message && <div className="notice compact-notice">{message}</div>}
    </section>
  )
}
