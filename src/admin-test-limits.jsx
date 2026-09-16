import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export default function AdminTestLimits({ organization }) {
  const [values, setValues] = useState(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (organization?.is_sandbox !== true) return
    const { data, error } = await supabase.from('organization_settings')
      .select('lead_capture_weekly_limit,lead_capture_weekly_usage,google_places_leads_per_capture')
      .eq('organization_id', organization.id).single()
    if (error) setNotice(error.message)
    else setValues(data)
  }, [organization?.id, organization?.is_sandbox])
  useEffect(() => { load() }, [load])
  async function save(event) {
    event.preventDefault()
    if (organization?.is_sandbox !== true || busy || !values) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_set_lead_capture_settings', {
      p_organization_id: organization.id,
      p_weekly_limit: values.lead_capture_weekly_limit === '' ? null : Number(values.lead_capture_weekly_limit),
      p_leads_per_capture: Number(values.google_places_leads_per_capture)
    })
    setBusy(false)
    setNotice(error ? error.message : 'Limites da empresa Teste atualizados.')
    if (!error) await load()
  }
  if (organization?.is_sandbox !== true) return <div className="notice error">Organização de testes não encontrada.</div>
  return <section className="panel">
    <span className="eyebrow">CAPTAÇÃO · SOMENTE TESTE</span>
    <h2>Limites de captação</h2>
    {notice && <div className="notice" role="status">{notice}</div>}
    {values && <form className="campaign-form" onSubmit={save}>
      <div className="field-grid">
        <label>Captações por semana
          <input type="number" min="0" value={values.lead_capture_weekly_limit ?? ''}
            onChange={e => setValues({ ...values, lead_capture_weekly_limit:e.target.value })}
            placeholder="Sem limite" disabled={busy}/>
        </label>
        <label>Máximo de leads por captação
          <input type="number" min="1" max="100" required value={values.google_places_leads_per_capture ?? 20}
            onChange={e => setValues({ ...values, google_places_leads_per_capture:e.target.value })} disabled={busy}/>
        </label>
      </div>
      <p className="muted">Utilizações nesta semana: {values.lead_capture_weekly_usage ?? 0}. A captação real consome a franquia compartilhada do Google Places; aumentar estes limites não altera a franquia global.</p>
      <button className="primary inline-btn" disabled={busy}>{busy ? 'Salvando...' : 'Salvar limites do Teste'}</button>
    </form>}
  </section>
}
