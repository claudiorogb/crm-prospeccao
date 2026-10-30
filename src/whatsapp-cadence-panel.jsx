import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import './whatsapp-cadence-panel.css'

const TOKENS = [['{saudacao}', 'Saudação'], ['{empresa}', 'Empresa'], ['{cidade}', 'Cidade'], ['{uf}', 'UF'], ['{telefone}', 'Telefone'], ['{segmento}', 'Segmento'], ['{email}', 'E-mail']]
const SPINTAX = '{quero te apresentar|gostaria de apresentar|posso te mostrar}'
const EMPTY = { enabled: false, step1_delay_days: 3, step1_body: '', step2_delay_days: 5, step2_body: '' }

// Cadência automática de follow-up por campanha (desligada por padrão).
// Os envios passam pela fila normal: horário, dias, limite diário, intervalo e pausa continuam valendo.
export default function WhatsappCadencePanel({ organization }) {
  const [segments, setSegments] = useState([])
  const [rows, setRows] = useState({})
  const [segmentId, setSegmentId] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [activeField, setActiveField] = useState('step1_body')
  const refs = { step1_body: useRef(null), step2_body: useRef(null) }

  const load = useCallback(async () => {
    const [cad, seg] = await Promise.all([
      supabase.from('whatsapp_cadences').select('*').eq('organization_id', organization.id),
      supabase.from('target_segments').select('id,name').eq('organization_id', organization.id).is('deleted_at', null).eq('is_active', true).order('name')
    ])
    if (cad.error) { setMessage(cad.error.message); return }
    const list = seg.data || []
    setSegments(list)
    setRows(Object.fromEntries((cad.data || []).map(row => [row.target_segment_id, row])))
    setSegmentId(current => current || list[0]?.id || '')
  }, [organization.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const row = rows[segmentId]
    setForm(row ? {
      enabled: !!row.enabled, step1_delay_days: row.step1_delay_days ?? 3, step1_body: row.step1_body || '',
      step2_delay_days: row.step2_delay_days ?? 5, step2_body: row.step2_body || ''
    } : EMPTY)
    setDirty(false)
  }, [segmentId, rows])

  const change = patch => { setForm(old => ({ ...old, ...patch })); setDirty(true) }

  function insertToken(token) {
    const field = activeField
    const el = refs[field].current
    const value = form[field] || ''
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    change({ [field]: value.slice(0, start) + token + value.slice(end) })
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(start + token.length, start + token.length) } })
  }

  async function save() {
    if (!segmentId) return
    if (form.enabled && !form.step1_body.trim()) { setMessage('Escreva o texto do 1º follow-up antes de ativar.'); return }
    const d1 = Math.min(30, Math.max(2, parseInt(form.step1_delay_days, 10) || 3))
    const d2 = Math.min(30, Math.max(2, parseInt(form.step2_delay_days, 10) || 5))
    const payload = {
      enabled: form.enabled, step1_body: form.step1_body.trim() || null, step1_delay_days: d1,
      step2_body: form.step2_body.trim() || null, step2_delay_days: d2, updated_at: new Date().toISOString()
    }
    setSaving(true)
    const current = rows[segmentId]
    const q = current?.id
      ? supabase.from('whatsapp_cadences').update(payload).eq('id', current.id).eq('organization_id', organization.id)
      : supabase.from('whatsapp_cadences').insert({ ...payload, organization_id: organization.id, target_segment_id: segmentId })
    const { error } = await q
    setSaving(false)
    if (error) { setMessage(`Não foi possível salvar: ${error.message}`); return }
    setMessage(form.enabled ? 'Cadência salva e ativa para esta campanha.' : 'Cadência salva (desligada).')
    load()
  }

  return (
    <section className="panel cadence-v2">
      <div className="cadence-head-v2">
        <div>
          <span className="eyebrow">PROSPECÇÃO POR WHATSAPP</span>
          <h2>Sequência automática de follow-up</h2>
          <p className="muted">
            Depois da mensagem inicial, se o lead não responder, o CRM envia o 1º follow-up após {form.step1_delay_days || 3} dia(s)
            e, se houver, o 2º após mais {form.step2_delay_days || 5} dia(s). Se o lead responder, os próximos envios são cancelados.
            Respeita o horário, os dias, o limite diário e o intervalo já configurados.
          </p>
        </div>
        <label className="cadence-switch-v2">
          <input type="checkbox" checked={form.enabled} disabled={!segmentId} onChange={e => change({ enabled: e.target.checked })} />
          <span>{form.enabled ? 'Cadência ativa' : 'Cadência desligada'}</span>
        </label>
      </div>

      {message && <div className="notice">{message}</div>}

      {segments.length === 0 ? <p className="muted">Crie um público-alvo para configurar a cadência.</p> : (
        <>
          <div className="field-grid three">
            <label>Campanha
              <select value={segmentId} onChange={e => { if (!dirty || window.confirm('Descartar alterações não salvas?')) setSegmentId(e.target.value) }}>
                {segments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}{rows[segment.id]?.enabled ? ' • ativa' : ''}</option>)}
              </select>
            </label>
            <label>1º follow-up após (dias)
              <input type="number" min="2" max="30" value={form.step1_delay_days} onChange={e => change({ step1_delay_days: e.target.value })} />
            </label>
            <label>2º follow-up após o 1º (dias)
              <input type="number" min="2" max="30" value={form.step2_delay_days} onChange={e => change({ step2_delay_days: e.target.value })} />
            </label>
          </div>

          <div className="email-variable-buttons">
            <strong>Adicionar ao texto:</strong>
            {TOKENS.map(([token, label]) => (
              <button key={token} type="button" className="email-variable-token" onClick={() => insertToken(token)} title={`Inserir ${token}`}>{label}</button>
            ))}
            <button type="button" className="email-variable-token" onClick={() => insertToken(SPINTAX)} title="Inserir exemplo de Spintax">Spintax</button>
          </div>

          <div className="field-grid two">
            <label>1º follow-up
              <textarea ref={refs.step1_body} rows="6" value={form.step1_body} onFocus={() => setActiveField('step1_body')} onChange={e => change({ step1_body: e.target.value })} placeholder="Ex.: {saudacao} Passando para saber se você viu minha mensagem sobre a {empresa}." />
            </label>
            <label>2º follow-up (opcional — último contato)
              <textarea ref={refs.step2_body} rows="6" value={form.step2_body} onFocus={() => setActiveField('step2_body')} onChange={e => change({ step2_body: e.target.value })} placeholder="Deixe em branco para enviar só um follow-up." />
            </label>
          </div>

          <div className="cadence-actions-v2">
            <button type="button" className="primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Salvando…' : 'Salvar cadência'}</button>
            {dirty && <span className="muted">Alterações não salvas</span>}
          </div>
        </>
      )}
    </section>
  )
}
