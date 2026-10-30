import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import './whatsapp-cadence-panel.css'

const TOKENS = [['{saudacao}', 'Saudação'], ['{empresa}', 'Empresa'], ['{cidade}', 'Cidade'], ['{uf}', 'UF'], ['{telefone}', 'Telefone'], ['{segmento}', 'Segmento'], ['{email}', 'E-mail']]
const SPINTAX = '{quero te apresentar|gostaria de apresentar|posso te mostrar}'
const EMPTY = { enabled: false, step1_delay_days: 3, step1_body: '', step2_delay_days: 5, step2_body: '' }

// Vincula a cadência pendente ao(s) envio(s) recém-criado(s) da mesma campanha.
// Chamado depois de "Enviar mensagem". Nunca lança erro: falhar aqui não pode afetar o envio.
export async function attachPendingCadence(organizationId, batchIds) {
  try {
    const ids = [...new Set((batchIds || []).filter(Boolean))]
    if (!organizationId || !ids.length) return { attached: false }
    const { data: pendings } = await supabase.from('whatsapp_cadences').select('id,target_segment_id,batch_ids')
      .eq('organization_id', organizationId).eq('enabled', true)
    const pending = (pendings || []).find(row => !row.batch_ids?.length)
    if (!pending) return { attached: false }
    const { data: batches } = await supabase.from('outbound_batches').select('id,name,target_segment_id')
      .eq('organization_id', organizationId).in('id', ids)
    const matching = (batches || []).filter(batch => batch.target_segment_id === pending.target_segment_id)
    if (!matching.length) return { attached: false, reason: 'campaign_mismatch' }
    const { error } = await supabase.from('whatsapp_cadences')
      .update({ batch_ids: matching.map(batch => batch.id), name: matching[0].name, updated_at: new Date().toISOString() })
      .eq('id', pending.id).eq('organization_id', organizationId)
    return { attached: !error }
  } catch {
    return { attached: false }
  }
}

// Cadência automática de follow-up por campanha (desligada por padrão).
// Os envios passam pela fila normal: horário, dias, limite diário, intervalo e pausa continuam valendo.
export default function WhatsappCadencePanel({ organization, refreshKey = 0 }) {
  const [pending, setPending] = useState(null)
  const [running, setRunning] = useState([])
  const [batchInfo, setBatchInfo] = useState({})
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
      supabase.from('whatsapp_cadences').select('*').eq('organization_id', organization.id).order('updated_at', { ascending: false }),
      supabase.from('target_segments').select('id,name').eq('organization_id', organization.id).is('deleted_at', null).eq('is_active', true).order('name')
    ])
    if (cad.error) { setMessage(cad.error.message); return }
    const list = seg.data || []
    const all = cad.data || []
    const linked = all.filter(row => row.batch_ids?.length)
    setSegments(list)
    setPending(all.find(row => !row.batch_ids?.length) || null)
    setRunning(linked)
    const batchIds = [...new Set(linked.flatMap(row => row.batch_ids))]
    if (batchIds.length) {
      const { data } = await supabase.from('outbound_batches').select('id,name,status').eq('organization_id', organization.id).in('id', batchIds)
      setBatchInfo(Object.fromEntries((data || []).map(batch => [batch.id, batch])))
    } else setBatchInfo({})
    setSegmentId(current => current || list[0]?.id || '')
  }, [organization.id])

  useEffect(() => { load() }, [load, refreshKey])

  useEffect(() => {
    if (pending) {
      setSegmentId(pending.target_segment_id)
      setForm({
        enabled: true, step1_delay_days: pending.step1_delay_days ?? 3, step1_body: pending.step1_body || '',
        step2_delay_days: pending.step2_delay_days ?? 5, step2_body: pending.step2_body || ''
      })
    } else {
      setForm(EMPTY)
    }
    setDirty(false)
  }, [pending])

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
    if (!form.step1_body.trim()) { setMessage('Escreva o texto do 1º follow-up.'); return }
    const d1 = Math.min(30, Math.max(2, parseInt(form.step1_delay_days, 10) || 3))
    const d2 = Math.min(30, Math.max(2, parseInt(form.step2_delay_days, 10) || 5))
    const payload = {
      enabled: true, target_segment_id: segmentId, step1_body: form.step1_body.trim(), step1_delay_days: d1,
      step2_body: form.step2_body.trim() || null, step2_delay_days: d2, updated_at: new Date().toISOString()
    }
    setSaving(true)
    const q = pending?.id
      ? supabase.from('whatsapp_cadences').update(payload).eq('id', pending.id).eq('organization_id', organization.id)
      : supabase.from('whatsapp_cadences').insert({ ...payload, organization_id: organization.id })
    const { error } = await q
    setSaving(false)
    if (error) { setMessage(`Não foi possível salvar: ${error.message}`); return }
    const campaign = segments.find(item => item.id === segmentId)?.name || 'a campanha'
    setMessage(`Cadência salva. Ela será ativada junto com o próximo envio de ${campaign} em "Enviar mensagens".`)
    setDirty(false)
    load()
  }

  async function discardPending() {
    if (!pending || !window.confirm('Descartar a cadência que ainda não foi iniciada?')) return
    const { error } = await supabase.from('whatsapp_cadences').delete().eq('id', pending.id).eq('organization_id', organization.id)
    if (error) { setMessage(error.message); return }
    setMessage('Cadência descartada.')
    load()
  }

  async function toggleRunning(row) {
    const { error } = await supabase.from('whatsapp_cadences').update({ enabled: !row.enabled, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('organization_id', organization.id)
    if (error) { setMessage(error.message); return }
    load()
  }

  function runningStatus(row) {
    if (!row.enabled) return 'Desligada'
    const states = row.batch_ids.map(id => batchInfo[id]?.status).filter(Boolean)
    if (states.length && states.every(status => status === 'cancelled')) return 'Cancelada (envio cancelado)'
    if (states.some(status => status === 'paused')) return 'Pausada (envio pausado)'
    return 'Ativa'
  }

  const campaignName = id => segments.find(item => item.id === id)?.name || 'Campanha'
  return (
    <section className="panel cadence-v2">
      <div className="cadence-head-v2">
        <div>
          <span className="eyebrow">PROSPECÇÃO POR WHATSAPP</span>
          <h2>Sequência automática de follow-up</h2>
          <p className="muted">
            Crie a cadência e inicie o envio das mensagens da campanha. Ao iniciar o envio, a cadência fica vinculada a ele, sai desta tela e
            segue em "Cadências em andamento". Se o lead não responder, o CRM envia o 1º follow-up após {form.step1_delay_days || 3} dia(s)
            e, se houver, o 2º após mais {form.step2_delay_days || 5} dia(s). Se o lead responder, os próximos envios são cancelados.
            Pausar ou cancelar o envio também para a cadência. Respeita o horário, os dias, o limite diário e o intervalo já configurados.
          </p>
        </div>
      </div>

      {message && <div className="notice">{message}</div>}

      {segments.length === 0 ? <p className="muted">Crie um público-alvo para configurar a cadência.</p> : (
        <>
          {pending && (
            <div className="notice">
              Cadência salva para <strong>{campaignName(pending.target_segment_id)}</strong>, aguardando o início do envio.
              <button type="button" className="secondary mini" style={{ marginLeft: 12 }} onClick={discardPending}>Descartar</button>
            </div>
          )}
          <div className="field-grid three">
            <label>Campanha
              <select value={segmentId} disabled={!!pending} onChange={e => { setSegmentId(e.target.value); setDirty(true) }}>
                {segments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
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
            <button type="button" className="primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Salvando…' : pending ? 'Atualizar cadência' : 'Salvar cadência'}</button>
            {dirty && <span className="muted">Alterações não salvas</span>}
          </div>
        </>
      )}

      {running.length > 0 && (
        <div className="cadence-running-v2">
          <h3>Cadências em andamento</h3>
          {running.map(row => {
            const status = runningStatus(row)
            return (
              <details className="cadence-item-v2" key={row.id}>
                <summary>
                  <span><strong>{campaignName(row.target_segment_id)}</strong> • {row.name || 'Envio'}</span>
                  <span className={`cadence-status-v2 ${status === 'Ativa' ? 'on' : 'off'}`}>{status}</span>
                </summary>
                <p className="muted">1º follow-up após {row.step1_delay_days} dia(s){row.step2_body ? ` • 2º após mais ${row.step2_delay_days} dia(s)` : ' • sem 2º follow-up'}</p>
                <pre className="cadence-text-v2">{row.step1_body}</pre>
                {row.step2_body && <pre className="cadence-text-v2">{row.step2_body}</pre>}
                <button type="button" className="secondary mini" onClick={() => toggleRunning(row)}>{row.enabled ? 'Desligar cadência' : 'Ligar cadência'}</button>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}
