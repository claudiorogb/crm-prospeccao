import React, { useState } from 'react'

export const AXIVA_TRIAL_TERMS_VERSION = '2026-10-05-v1'
export const AXIVA_PRIVACY_VERSION = '2026-09-16-v1'

export default function TrialTermsScreen({ onAccept, onBack, loading = false }) {
  const [accepted, setAccepted] = useState(false)

  return (
    <main className="auth-shell">
      <section className="auth-card access-state-card" style={{ maxWidth: 760, textAlign: 'left' }}>
        <div className="brand-mark">AX</div>
        <span className="eyebrow">ANTES DE COMEÇAR</span>
        <h1>Condições do teste gratuito</h1>
        <p className="muted">
          Leia as condições do período de teste antes de criar sua conta e iniciar o acesso ao AXIVA CRM.
        </p>

        <div
          className="panel"
          style={{
            margin: '20px 0',
            maxHeight: 360,
            overflowY: 'auto',
            textAlign: 'left',
            padding: 22
          }}
        >
          <h3>1. Período de teste</h3>
          <p className="muted">
            O AXIVA CRM disponibiliza um período de teste gratuito de 30 (trinta) dias, contado a partir da ativação do acesso.
          </p>

          <h3>2. Um teste por CNPJ</h3>
          <p className="muted">
            O período de teste gratuito é limitado a 1 (um) teste por CNPJ, independentemente do endereço de e-mail, usuário ou conta utilizada.
          </p>

          <h3>3. Encerramento do teste</h3>
          <p className="muted">
            Ao final dos 30 dias, o período de teste será encerrado. Para continuar utilizando as funcionalidades completas do AXIVA CRM, será necessário contratar um dos planos pagos disponíveis.
          </p>
          <p className="muted">
            A continuidade do uso não ocorrerá automaticamente e a utilização do período gratuito não gera cobrança automática.
          </p>

          <h3>4. Dados inseridos durante o teste</h3>
          <p className="muted">
            Os dados comerciais inseridos durante o período de teste não serão apagados automaticamente em razão do encerramento do trial.
          </p>
          <p className="muted">
            Após o término do teste sem contratação, o acesso ao CRM ficará limitado à visualização do Kanban. O cliente poderá fazer o download dos dados comerciais inseridos em formato Excel.
          </p>

          <h3>5. Contratação posterior</h3>
          <p className="muted">
            A contratação de um plano pago depende de manifestação expressa do cliente e seguirá os preços e condições comerciais vigentes no momento da contratação.
          </p>

          <p className="muted" style={{ marginBottom: 0 }}>
            Consulte também os{' '}
            <a href="https://axiva.com.br/termos" target="_blank" rel="noreferrer">Termos de Serviço</a>
            {' '}e a{' '}
            <a href="https://axiva.com.br/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.
          </p>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            cursor: 'pointer',
            marginBottom: 18
          }}
        >
          <input
            type="checkbox"
            checked={accepted}
            onChange={e => setAccepted(e.target.checked)}
            disabled={loading}
            style={{ marginTop: 4 }}
          />
          <span>
            Aceito os Termos de Uso e a Política de Privacidade, incluindo as condições do período de teste gratuito de 30 dias.
          </span>
        </label>

        <div className="access-actions">
          <button type="button" className="secondary" onClick={onBack} disabled={loading}>
            Voltar
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onAccept({
              termsVersion: AXIVA_TRIAL_TERMS_VERSION,
              privacyVersion: AXIVA_PRIVACY_VERSION,
              acceptedAt: new Date().toISOString()
            })}
            disabled={!accepted || loading}
          >
            {loading ? 'Criando conta...' : 'Aceitar e iniciar teste'}
          </button>
        </div>
      </section>
    </main>
  )
}
