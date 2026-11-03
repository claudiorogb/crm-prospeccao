import React, { useEffect, useState } from 'react'
import { Save, Sparkles } from 'lucide-react'
import { supabase } from './lib/supabase'

export const AI_PROFILE_MAX = 2000

const EXAMPLE = `O que vendemos: ...
Tom de voz: ...
O que NÃO prometer: preço fechado, prazo, desconto sem aprovação...`

export default function AiBusinessProfile({ organization }) {
  const [value, setValue] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    setLoaded(false)
    supabase.from('organization_settings')
      .select('ai_business_profile')
      .eq('organization_id', organization.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setValue(data?.ai_business_profile || '')
        setLoaded(true)
      })
    return () => { active = false }
  }, [organization.id])

  async function save() {
    setSaving(true)
    setMessage('')
    const text = value.trim().slice(0, AI_PROFILE_MAX)
    const { data, error } = await supabase.from('organization_settings')
      .update({ ai_business_profile: text || null })
      .eq('organization_id', organization.id)
      .select('organization_id')
    setSaving(false)
    if (error) setMessage(error.message)
    else if (!data?.length) setMessage('Somente o administrador da empresa pode alterar este texto.')
    else setMessage('Texto salvo. A IA já vai usar nas próximas sugestões.')
  }

  return (
    <section className="panel">
      <span className="eyebrow">IA DO WHATSAPP</span>
      <h2><Sparkles size={18}/> Perfil da empresa para a IA</h2>
      <p className="muted">
        Usado pelo botão "Responder com IA". Conte o que a empresa vende, o tom de voz e o que a IA não deve prometer.
        A IA só sugere o texto; quem decide enviar é você.
      </p>
      <label>
        Texto para a IA
        <textarea
          rows={9}
          value={value}
          maxLength={AI_PROFILE_MAX}
          disabled={!loaded}
          placeholder={EXAMPLE}
          onChange={e => setValue(e.target.value)}
        />
      </label>
      <small className="muted">{value.length}/{AI_PROFILE_MAX} caracteres</small>
      <div className="form-actions">
        <button className="primary inline-btn" onClick={save} disabled={saving || !loaded}><Save size={16}/> {saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
      {message && <div className="notice compact-notice">{message}</div>}
    </section>
  )
}
