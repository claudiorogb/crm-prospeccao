import React, { useState } from 'react'
import { Send, Smartphone } from 'lucide-react'
import { supabase } from './lib/supabase'

// Administração › App no celular: envia por e-mail o link do AXIVA CRM para instalar no celular.
// O envio é feito pela função send-app-link, que só aceita administrador do sistema.
export default function AdminSendAppLink() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeType, setNoticeType] = useState('success')

  async function submit(event) {
    event.preventDefault()
    const value = email.trim()
    if (!value) {
      setNoticeType('error')
      setNotice('Digite o e-mail para onde o link será enviado.')
      return
    }
    setBusy(true)
    setNotice('')
    const { data, error } = await supabase.functions.invoke('send-app-link', { body: { email: value } })
    setBusy(false)
    if (error || data?.error) {
      let message = data?.error || ''
      if (!message && error?.context?.json) {
        try { message = (await error.context.json())?.error || '' } catch { /* sem detalhe */ }
      }
      setNoticeType('error')
      setNotice(message || 'Não foi possível enviar o e-mail.')
      return
    }
    setNoticeType('success')
    setNotice(`Link enviado para ${value}.`)
    setEmail('')
  }

  return (
    <section className="admin-send-app-link">
      <header className="admin-section-header">
        <div>
          <span className="eyebrow">APP NO CELULAR</span>
          <h2>Enviar o link do app por e-mail</h2>
          <p className="muted">Digite o e-mail de quem vai instalar o AXIVA CRM no celular. A pessoa recebe o link e o passo a passo de instalação.</p>
        </div>
      </header>

      {notice && <div className={`notice ${noticeType === 'error' ? 'error' : ''}`} role="status">{notice}</div>}

      <section className="panel">
        <div className="panel-heading">
          <h3><Smartphone size={16}/> Enviar link</h3>
        </div>
        <form className="admin-member-form" onSubmit={submit}>
          <input
            type="email"
            aria-label="E-mail de quem vai receber o link do app"
            placeholder="email@exemplo.com"
            value={email}
            onChange={event => setEmail(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <button className="primary inline-btn" disabled={busy}>
            <Send size={16}/> {busy ? 'Enviando...' : 'Enviar link'}
          </button>
        </form>
      </section>
    </section>
  )
}
