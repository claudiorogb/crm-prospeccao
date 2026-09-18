import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const COMPONENTS = [
  ['crm_web', 'Site do CRM'],
  ['crm_backend', 'Backend e banco de dados']
]
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
const MS_15_MIN = 15 * 60 * 1000

function formatMoment(value) {
  return value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'
}
function formatDuration(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000)
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`
}
function downtimeUnion(incidents, start, end) {
  const intervals = incidents.map(row => [
    Math.max(start, new Date(row.started_at).getTime()),
    Math.min(end, row.ended_at ? new Date(row.ended_at).getTime() : end)
  ]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a, b) => a[0] - b[0])
  let total = 0, current = null
  for (const [a, b] of intervals) {
    if (!current) current = [a, b]
    else if (a <= current[1]) current[1] = Math.max(current[1], b)
    else { total += current[1] - current[0]; current = [a, b] }
  }
  return total + (current ? current[1] - current[0] : 0)
}

export default function AdminHealthMonitor() {
  const [checks, setChecks] = useState([])
  const [incidents, setIncidents] = useState([])
  const [alerts, setAlerts] = useState([])
  const [recovery, setRecovery] = useState([])
  const [settings, setSettings] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function load() {
    setBusy(true)
    const [c, i, a, r, s] = await Promise.all([
      supabase.from('axiva_monitor_checks').select('component,checked_at,is_up,http_status,latency_ms').order('checked_at', { ascending: false }).limit(300),
      supabase.from('axiva_monitor_incidents').select('id,component,started_at,ended_at,failure_count,last_detail').order('started_at', { ascending: false }).limit(300),
      supabase.from('axiva_monitor_alert_log').select('component,event,channel,delivery_status,created_at,detail').order('created_at', { ascending: false }).limit(12),
      supabase.from('axiva_monitor_recovery_tests').select('tested_at,result,environment,scope,evidence_reference').order('tested_at', { ascending: false }).limit(3),
      supabase.from('axiva_monitor_settings').select('alert_email,email_from,whatsapp_to,whatsapp_instance').eq('singleton', true).maybeSingle()
    ])
    const error = [c, i, a, r, s].find(item => item.error)?.error
    if (error) setMessage(`Não foi possível consultar os registros: ${error.message}`)
    else {
      setChecks(c.data || []); setIncidents(i.data || []); setAlerts(a.data || []);
      setRecovery(r.data || []); setSettings(s.data || null); setMessage('')
    }
    setLoaded(true)
    setBusy(false)
  }
  useEffect(() => { load() }, [])

  async function saveSettings(event) {
    event.preventDefault()
    if (!settings) return
    setBusy(true)
    const next = {
      alert_email: settings.alert_email?.trim() || null,
      email_from: settings.email_from?.trim() || null,
      whatsapp_to: settings.whatsapp_to?.replace(/\D/g, '') || null,
      whatsapp_instance: settings.whatsapp_instance?.trim() || null,
      updated_at: new Date().toISOString()
    }
    if (next.whatsapp_to && !/^55\d{10,11}$/.test(next.whatsapp_to)) {
      setMessage('Informe o WhatsApp com DDI 55, DDD e número.'); setBusy(false); return
    }
    const { error } = await supabase.from('axiva_monitor_settings').update(next).eq('singleton', true)
    setMessage(error ? `Não foi possível salvar: ${error.message}` : 'Destinatários e remetente salvos. Os canais só funcionarão com as credenciais do servidor configuradas.')
    if (!error) setSettings(next)
    setBusy(false)
  }

  const now = Date.now()
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const monthStartMs = monthStart.getTime()
  const downtimeMs = useMemo(() => downtimeUnion(incidents, monthStartMs, now), [incidents, monthStartMs, now])
  const firstCheck = checks.length ? new Date(checks[checks.length - 1].checked_at).getTime() : 0
  const coverageReliable = firstCheck && firstCheck <= monthStartMs + MS_15_MIN && COMPONENTS.every(([key]) => checks.some(c => c.component === key && now - new Date(c.checked_at).getTime() <= MS_15_MIN))
  const uptime = Math.max(0, 100 - downtimeMs / Math.max(1, now - monthStartMs) * 100)

  return <>
    <header className="admin-section-header"><div>
      <span className="eyebrow">ADMINISTRAÇÃO DA PLATAFORMA</span>
      <h2>Saúde do sistema</h2>
      <p className="muted">Verificações externas, ocorrências e evidências de recuperação. Somente administradores da AXIVA.</p>
    </div><div className="topbar-actions"><button type="button" className="secondary" disabled={busy} onClick={load}>{busy ? 'Atualizando...' : 'Atualizar'}</button></div></header>
    {message && <div className="notice">{message}</div>}
    <section className="admin-two-column">
      {COMPONENTS.map(([key, label]) => {
        const last = checks.find(check => check.component === key)
        const stale = !last || now - new Date(last.checked_at).getTime() > MS_15_MIN
        return <div className="panel" key={key}>
          <span className="eyebrow">MONITORAMENTO</span><h3>{label}</h3>
          <strong>{stale ? 'Sem medição recente' : last.is_up ? 'Operacional' : 'Indisponível'}</strong>
          <p className="muted">Última verificação: {formatMoment(last?.checked_at)}. {last?.latency_ms != null ? `Resposta: ${last.latency_ms} ms.` : ''}</p>
        </div>
      })}
    </section>
    <section className="panel">
      <span className="eyebrow">SLA • MÊS ATUAL</span><h3>Indisponibilidade observada: {formatDuration(downtimeMs)} de 8h</h3>
      <p className="muted">{coverageReliable ? `Disponibilidade observada: ${uptime.toFixed(2).replace('.', ',')}%.` : 'Apuração parcial: ainda não há histórico suficiente e contínuo para declarar disponibilidade mensal.'} Os intervalos simultâneos do site e do backend não são somados duas vezes.</p>
      <p className="muted">O monitor amostra os serviços a cada 5 minutos. Os horários são estimativas entre a primeira falha detectada e a primeira recuperação detectada; atrasos do executor podem ampliar a incerteza.</p>
      {downtimeMs > EIGHT_HOURS_MS && <div className="notice error">O limite mensal de 8 horas foi ultrapassado nos registros disponíveis.</div>}
    </section>
    <section className="panel"><span className="eyebrow">OCORRÊNCIAS</span><h3>Últimas interrupções</h3>
      {incidents.length ? incidents.slice(0, 12).map(item => <div key={item.id} style={{ padding: '8px 0', borderBottom: '1px solid #ddd' }}>
        <strong>{COMPONENTS.find(c => c[0] === item.component)?.[1] || item.component} — {item.ended_at ? 'Recuperado' : 'Em andamento'}</strong>
        <div className="muted">Início detectado: {formatMoment(item.started_at)} | Recuperação detectada: {formatMoment(item.ended_at)} | Duração observada: {formatDuration(new Date(item.ended_at || Date.now()).getTime() - new Date(item.started_at).getTime())}</div>
      </div>) : <p className="muted">Nenhuma ocorrência registrada. Isso não comprova disponibilidade anterior à ativação do monitor.</p>}
    </section>
    <section className="panel"><span className="eyebrow">ALERTAS</span><h3>Destinatários e canais</h3>
      <p className="muted">O endereço e o número abaixo são exclusivos dos avisos operacionais. As credenciais de envio permanecem no backend; nunca são armazenadas neste formulário.</p>
      {settings && <form onSubmit={saveSettings} className="campaign-form">
        <label>E-mail destinatário<input type="email" value={settings.alert_email || ''} onChange={e => setSettings({...settings, alert_email: e.target.value})} placeholder="seu@email.com" /></label>
        <label>Remetente verificado no Resend<input type="email" value={settings.email_from || ''} onChange={e => setSettings({...settings, email_from: e.target.value})} placeholder="alertas@seudominio.com.br" /></label>
        <label>WhatsApp destinatário (55 + DDD + número)<input type="tel" value={settings.whatsapp_to || ''} onChange={e => setSettings({...settings, whatsapp_to: e.target.value})} placeholder="5511999999999" /></label>
        <label>Instância de WhatsApp conectada na Evolution<input value={settings.whatsapp_instance || ''} onChange={e => setSettings({...settings, whatsapp_instance: e.target.value})} placeholder="nome da instância" /></label>
        <button type="submit" className="primary" disabled={busy}>Salvar destinatários</button>
      </form>}
      <h4>Histórico de entrega</h4>
      {alerts.length ? alerts.map((row, index) => <p key={index} className="muted">{formatMoment(row.created_at)} • {row.channel === 'email' ? 'E-mail' : 'WhatsApp'} • {row.delivery_status === 'sent' ? 'Aceito pelo provedor' : row.delivery_status === 'failed' ? 'Falhou' : 'Não configurado'} • {row.event === 'down' ? 'Queda' : 'Recuperação'}{row.detail ? ` — ${row.detail}` : ''}</p>) : <p className="muted">Nenhum alerta enviado ou registrado. Informe os destinatários e valide os canais do servidor.</p>}
    </section>
    <section className="panel"><span className="eyebrow">RECUPERAÇÃO E BACKUP</span><h3>Restauração em ambiente isolado</h3>
      {recovery.length ? recovery.map((item, index) => <p className="muted" key={index}>{formatMoment(item.tested_at)} • {item.result === 'passed' ? 'Aprovado' : item.result === 'failed' ? 'Falhou' : 'Parcial'} • {item.scope} • {item.environment === 'isolated' ? 'Ambiente isolado' : 'Produção somente leitura'}</p>) : <p className="notice">Nenhum teste de restauração comprovado. Não considere o backup recuperável até um ensaio isolado bem-sucedido.</p>}
      <p className="muted">O agendamento de backup existe em repositório separado; o resultado de cada execução e a existência do arquivo no Drive ainda não estão integrados a este painel.</p>
      <a href="https://github.com/claudiorogb/crm-backup" target="_blank" rel="noopener noreferrer">Consultar a rotina de backup</a>
    </section>
    {!loaded && <div className="notice">Carregando monitoramento...</div>}
  </>
}
