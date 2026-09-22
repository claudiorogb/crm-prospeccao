import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const labelProvider = value => value === 'gmail' ? 'Gmail' : value === 'resend' ? 'Resend' : 'Não informado'
const labelStatus = value => ({ draft: 'Rascunho', queued: 'Na fila', sending: 'Enviando', paused: 'Pausada', completed: 'Concluída', cancelled: 'Cancelada', failed: 'Falhou' })[value] || value
const number = value => Number(value || 0).toLocaleString('pt-BR')

export default function EmailCampaignHistory({ campaign, organizationId, busy, onContinue, onCancel, onResend }) {
  const [expanded, setExpanded] = useState(false)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setRows(null)
    setError('')
    if (expanded && campaign.metrics_enabled && organizationId) {
      Promise.all([
        supabase.rpc('email_campaign_recipient_report', { p_organization_id: organizationId, p_campaign_id: campaign.id }),
        supabase.rpc('email_campaign_engagement_report', { p_organization_id: organizationId, p_campaign_id: campaign.id })
      ]).then(([recipients, engagement]) => {
        if (!active) return
        if (recipients.error || engagement.error) {
          setError('Não foi possível consultar os detalhes desta campanha.')
          return
        }
        const byRecipient = new Map((engagement.data || []).map(item => [item.recipient_id, item]))
        setRows((recipients.data || []).map(recipient => ({ ...recipient, ...byRecipient.get(recipient.recipient_id) })))
      }).catch(() => { if (active) setError('Não foi possível consultar os detalhes desta campanha.') })
    }
    return () => { active = false }
  }, [expanded, campaign.id, campaign.metrics_enabled, organizationId, refresh])

  const stats = useMemo(() => {
    const items = rows || []
    return {
      accepted: items.filter(r => r.recipient_status === 'sent').length,
      failures: items.filter(r => r.recipient_status === 'failed' || r.bounced_at || r.failed_at || r.suppressed_at).length,
      pending: items.filter(r => ['draft', 'queued', 'sending', 'retrying'].includes(r.recipient_status)).length,
      unsubscribed: items.filter(r => Boolean(r.unsubscribed_at)).length,
      delivered: items.filter(r => Boolean(r.delivered_at)).length,
      opened: items.filter(r => Boolean(r.opened_at)).length,
      clicked: items.filter(r => Boolean(r.clicked_at)).length,
      complained: items.filter(r => Boolean(r.complained_at)).length,
      bounced: items.filter(r => Boolean(r.bounced_at)).length,
      delayed: items.filter(r => Boolean(r.delayed_at)).length,
      tracked: items.some(r => r.tracking_ready),
      providerEvents: items.some(r => r.delivered_at || r.bounced_at || r.complained_at || r.failed_at || r.suppressed_at || r.delayed_at)
    }
  }, [rows])
  const engagementValue = value => stats.tracked ? number(value) : 'Não disponível'
  const deliveryValue = value => campaign.provider === 'resend' && (stats.tracked || stats.providerEvents) ? number(value) : 'Não disponível'

  return <details className="email-campaign-history-item" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="email-campaign-history-summary">
      <strong>{campaign.name || 'Campanha sem nome'}</strong>
      <time dateTime={campaign.created_at}>{new Date(campaign.created_at).toLocaleString('pt-BR')}</time>
    </summary>
    <div className="email-campaign-history-body">
      <p><strong>Assunto:</strong> {campaign.subject || 'Não informado'}</p>
      <p><strong>Provedor:</strong> {labelProvider(campaign.provider)} · <strong>Remetente:</strong> {campaign.from_email || 'Não informado'}</p>
      <p><strong>Situação:</strong> {labelStatus(campaign.status)}</p>
      {!campaign.metrics_enabled ? <p className="muted">Campanha de teste anterior à atualização. Não foram recuperadas métricas antigas.</p> : <>
        {rows === null && !error && <p className="muted">Carregando indicadores…</p>}
        {error && <p role="alert">{error} <button type="button" className="secondary" onClick={() => setRefresh(i => i + 1)}>Tentar novamente</button></p>}
        {rows !== null && !error && <>
          <div className="email-campaign-history-metrics" aria-label="Indicadores da campanha">
            <div><span>Destinatários</span><strong>{number(rows.length)}</strong></div>
            <div><span>Envios aceitos</span><strong>{number(stats.accepted)}</strong></div>
            <div><span>Erros</span><strong>{number(stats.failures)}</strong></div>
            <div><span>Pendentes</span><strong>{number(stats.pending)}</strong></div>
            <div><span>Descadastrados confirmados</span><strong>{number(stats.unsubscribed)}</strong></div>
            <div><span>Entregues</span><strong>{deliveryValue(stats.delivered)}</strong></div>
            <div><span>Aberturas identificadas</span><strong>{engagementValue(stats.opened)}</strong></div>
            <div><span>Cliques identificados</span><strong>{engagementValue(stats.clicked)}</strong></div>
            <div><span>Denúncias de spam</span><strong>{deliveryValue(stats.complained)}</strong></div>
            <div><span>Rejeitados</span><strong>{deliveryValue(stats.bounced)}</strong></div>
            <div><span>Entrega atrasada</span><strong>{deliveryValue(stats.delayed)}</strong></div>
          </div>
          <h4>Destinatários e situação</h4>
          {rows.length === 0 ? <p className="muted">Nenhum destinatário registrado.</p> : <div className="email-campaign-history-scroll"><table><thead><tr><th>E-mail</th><th>Situação</th><th>Erro / motivo</th><th>Descadastro</th></tr></thead><tbody>
            {rows.map(r => <tr key={r.recipient_id}><td>{r.recipient_email}</td><td>{r.bounced_at ? 'Rejeitado' : r.failed_at || r.suppressed_at ? 'Falha de entrega' : r.delivered_at ? 'Entregue' : r.recipient_status === 'sent' ? 'Aceito pelo provedor' : r.recipient_status === 'failed' ? 'Falhou' : r.recipient_status === 'cancelled' ? 'Cancelado' : r.recipient_status === 'queued' ? 'Na fila' : r.recipient_status === 'sending' ? 'Enviando' : r.recipient_status}</td><td>{r.error_message || r.last_delivery_error || '—'}</td><td>{r.unsubscribed_at ? new Date(r.unsubscribed_at).toLocaleString('pt-BR') : '—'}</td></tr>)}
          </tbody></table></div>}
        </>}
      </>}
      <div className="email-campaign-history-actions">
        {campaign.status === 'draft' ? <><button type="button" className="secondary" disabled={busy} onClick={() => onContinue(campaign)}>Continuar</button><button type="button" className="secondary" disabled={busy} onClick={() => onCancel(campaign.id)}>Cancelar</button></> : null}
        {campaign.status === 'completed' ? <button type="button" className="secondary email-resend-campaign-button" disabled={busy} onClick={() => onResend(campaign)}>Reenviar campanha</button> : null}
        {['queued', 'sending', 'paused', 'failed'].includes(campaign.status) ? <button type="button" className="secondary" disabled={busy} onClick={() => onCancel(campaign.id)}>Cancelar</button> : null}
      </div>
    </div>
  </details>
}
