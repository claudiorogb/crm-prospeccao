import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './whatsapp-cadence-panel.css'

// Cadência automática de follow-up por campanha. Desligada por padrão.
// Os envios continuam passando pela fila normal (janela, dias, limite diário, intervalo e pausa).
export default function WhatsappCadencePanel({ organization, segments, templates }) {
  const [rows, setRows] = useState({})
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('whatsapp_cadences').select('*').eq('organization_id', organization.id)
    if (error) { setMessage(error.message); return }
    setRows(Object.fromEntries((data || []).map(row => [row.target_segment_id, row])))
  }, [organization.id])

  useEffect(() => { if (open) load() }, [open, load])

  async function save(segmentId, patch) {
    const current = rows[segmentId] || {}
    const next = { step1_delay_days: 3, step2_delay_days: 5, enabled: false, ...current, ...patch }
    if (next.enabled && !next.step1_template_id) { setMessage('Escolha a mensagem do 1º follow-up antes de ativar.'); return }
    if (!next.step2_template_id) next.step2_template_id = null
    const payload = {
      enabled: next.enabled, step1_template_id: next.step1_template_id || null, step1_delay_days: Number(next.step1_delay_days),
      step2_template_id: next.step2_template_id, step2_delay_days: Number(next.step2_delay_days), updated_at: new Date().toISOString()
    }
    const q = current.id
      ? supabase.from('whatsapp_cadences').update(payload).eq('id', current.id).eq('organization_id', organization.id)
      : supabase.from('whatsapp_cadences').insert({ ...payload, organization_id: organization.id, target_segment_id: segmentId })
    const { error } = await q
    if (error) { setMessage(`Não foi possível salvar: ${error.message}`); return }
    setMessage('Cadência salva.')
    load()
  }

  return (
    <section className="panel cadence-v1">
      <button type="button" className="secondary" onClick={() => setOpen(value => !value)}>
        {open ? 'Ocultar' : 'Configurar'} cadência automática de follow-up
      </button>
      {open && (
        <>
          <p className="muted">
            Quando ativada para uma campanha, o CRM envia automaticamente um lembrete a quem recebeu a mensagem inicial e não respondeu.
            O envio para assim que a pessoa responde e respeita o horário, os dias, o limite diário e o intervalo já configurados. Vem desligada.
          </p>
          {message && <div className="notice">{message}</div>}
          {segments.map(segment => {
            const row = rows[segment.id] || {}
            const options = templates.filter(t => t.target_segment_id === segment.id && t.is_active && !t.deleted_at)
            return (
              <div className="cadence-row-v1" key={segment.id}>
                <strong>{segment.name}</strong>
                <label><input type="checkbox" checked={!!row.enabled} onChange={e => save(segment.id, { enabled: e.target.checked })} /> Ativa</label>
                <label>1º follow-up após
                  <input type="number" min="2" max="30" value={row.step1_delay_days ?? 3} onChange={e => save(segment.id, { step1_delay_days: e.target.value })} /> dias
                </label>
                <select value={row.step1_template_id || ''} onChange={e => save(segment.id, { step1_template_id: e.target.value })}>
                  <option value="">Mensagem do 1º follow-up…</option>
                  {options.map(t => <option key={t.id} value={t.id}>{t.name || t.body.slice(0, 40)}</option>)}
                </select>
                <label>2º follow-up após
                  <input type="number" min="2" max="30" value={row.step2_delay_days ?? 5} onChange={e => save(segment.id, { step2_delay_days: e.target.value })} /> dias
                </label>
                <select value={row.step2_template_id || ''} onChange={e => save(segment.id, { step2_template_id: e.target.value })}>
                  <option value="">Sem 2º follow-up</option>
                  {options.map(t => <option key={t.id} value={t.id}>{t.name || t.body.slice(0, 40)}</option>)}
                </select>
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}
