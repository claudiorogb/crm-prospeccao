import React, { useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Loader2, FileText } from 'lucide-react'
import { supabase } from './lib/supabase'

export const AXIVA_PAID_CONTRACT_VERSION = '2026-10-05-v1'

const PLANS = {
  axiva: { name: 'AXIVA', price: 'R$ 45,00/mês', value: 45 },
  axiva_plus: { name: 'AXIVA Plus', price: 'R$ 79,80/mês', value: 79.8 },
  axiva_max: { name: 'AXIVA Max', price: 'R$ 164,80/mês', value: 164.8 },
}

export default function BillingContractScreen({ planId, onBack, onContinue }) {
  const [signerName, setSignerName] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const plan = useMemo(() => PLANS[planId], [planId])

  async function acceptContract() {
    if (loading || !plan) return
    setError('')
    if (signerName.trim().length < 2) {
      setError('Informe o nome do responsável pela contratação.')
      return
    }
    if (!accepted) {
      setError('Leia o contrato e marque a opção de concordância para continuar.')
      return
    }

    setLoading(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('accept_axiva_paid_contract', {
        p_plan_id: planId,
        p_contract_version: AXIVA_PAID_CONTRACT_VERSION,
        p_signer_name: signerName.trim(),
        p_user_agent: navigator.userAgent,
      })
      if (rpcError) throw rpcError
      if (!data) throw new Error('Não foi possível registrar a aceitação do contrato.')
      await onContinue()
    } catch (err) {
      setError(err?.message || 'Não foi possível registrar o contrato.')
      setLoading(false)
    }
  }

  if (!plan) return null

  return (
    <main className="auth-shell" style={{ minHeight: '100vh', padding: '32px 20px', alignItems: 'flex-start', overflowY: 'auto' }}>
      <section className="auth-card" style={{ width: 'min(820px, 100%)', maxWidth: 820, margin: '20px auto', padding: '32px' }}>
        <button
          type="button"
          className="text-button"
          onClick={onBack}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 18 }}
        >
          <ArrowLeft size={16} /> Voltar
        </button>

        <div className="brand-mark">AX</div>
        <span className="eyebrow">CONTRATO DE USO</span>
        <h1 style={{ marginBottom: 8 }}>Contrato de Licença e Uso do AXIVA CRM</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Plano selecionado: <strong>{plan.name}</strong> — {plan.price}
        </p>

        <div
          style={{
            marginTop: 22,
            padding: '22px 24px',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            background: '#fff',
            maxHeight: 430,
            overflowY: 'auto',
            lineHeight: 1.65,
            color: '#334155',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <FileText size={18} />
            <strong>Versão {AXIVA_PAID_CONTRACT_VERSION}</strong>
          </div>

          <h3>1. Partes</h3>
          <p>
            O AXIVA CRM, da marca AXIVA, é oferecido por Claudio Rogério Borges, pessoa física, e o presente contrato é celebrado com a empresa identificada pelo CNPJ cadastrado no CRM, representada pelo responsável que realiza a contratação.
          </p>

          <h3>2. Objeto</h3>
          <p>
            O contrato concede ao cliente uma licença de uso não exclusiva do AXIVA CRM, conforme o plano contratado, para organização de contatos, prospecção comercial, relacionamento com clientes e acompanhamento de oportunidades.
          </p>

          <h3>3. Plano, preço e cobrança</h3>
          <p>
            O cliente contrata o plano <strong>{plan.name}</strong>, pelo valor de <strong>{plan.price}</strong>. A cobrança é recorrente e mensal, realizada pelo Asaas conforme as condições apresentadas no checkout. O acesso ao plano pago será liberado após a confirmação do pagamento pelo sistema de cobrança.
          </p>

          <h3>4. Vigência e cancelamento</h3>
          <p>
            A contratação permanece vigente enquanto houver assinatura ativa e pagamentos regulares. O cliente poderá cancelar a renovação da assinatura conforme as condições disponibilizadas pelo serviço de cobrança. Valores já pagos não serão automaticamente restituídos, salvo quando houver direito de restituição previsto em lei ou expressamente informado pelo AXIVA.
          </p>

          <h3>5. Responsabilidade do cliente</h3>
          <p>
            O cliente é responsável pelos dados cadastrados, importados ou utilizados no AXIVA CRM e pela legitimidade de sua obtenção e utilização. Também é responsável pelos conteúdos das mensagens e campanhas realizadas por meio da plataforma.
          </p>

          <h3>6. Uso permitido</h3>
          <p>
            É proibido utilizar o AXIVA CRM para fraude, envio abusivo de mensagens, distribuição de conteúdo ilícito, violação de direitos de terceiros, acesso não autorizado ou tentativa de comprometer a segurança da plataforma.
          </p>

          <h3>7. Dados e privacidade</h3>
          <p>
            O tratamento de dados pessoais seguirá a Política de Privacidade do AXIVA e a legislação aplicável. O cliente permanece responsável pelos dados de terceiros que inserir na plataforma.
          </p>

          <h3>8. Termos complementares</h3>
          <p>
            Integram este contrato os Termos de Serviço e a Política de Privacidade publicados pelo AXIVA. Em caso de atualização desses documentos, serão observadas as regras de comunicação e vigência aplicáveis.
          </p>

          <h3>9. Aceite eletrônico</h3>
          <p>
            O aceite eletrônico realizado no CRM registra o nome informado pelo contratante, a conta autenticada, o CNPJ da organização, a versão do contrato e a data e hora do aceite. Esse registro será mantido para fins de comprovação da contratação.
          </p>

          <p style={{ marginBottom: 0 }}>
            <a href="https://axiva.com.br/termos" target="_blank" rel="noreferrer">Consultar Termos de Serviço</a>
            {' · '}
            <a href="https://axiva.com.br/privacidade" target="_blank" rel="noreferrer">Consultar Política de Privacidade</a>
          </p>
        </div>

        <label style={{ marginTop: 20 }}>
          Nome do responsável pela contratação
          <input
            value={signerName}
            onChange={e => setSignerName(e.target.value)}
            placeholder="Nome completo"
            maxLength={120}
            autoComplete="name"
            disabled={loading}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16, cursor: loading ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={e => setAccepted(e.target.checked)}
            disabled={loading}
            style={{ width: 18, height: 18, marginTop: 3, flex: '0 0 auto' }}
          />
          <span>
            Li o contrato acima e estou de acordo com suas condições. Confirmo que estou autorizado a realizar esta contratação em nome da empresa.
          </span>
        </label>

        {error && <div className="notice error" role="alert" style={{ marginTop: 16 }}>{error}</div>}

        <button className="primary full" type="button" onClick={acceptContract} disabled={loading || !accepted} style={{ marginTop: 20, minHeight: 44 }}>
          {loading ? <><Loader2 size={16} className="spin" /> Preparando pagamento...</> : <><CheckCircle2 size={17} /> Aceitar contrato e continuar para pagamento</>}
        </button>

        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          O pagamento será realizado em uma página segura do Asaas. Os dados do cartão não são armazenados pelo AXIVA.
        </p>
      </section>

      <style>{`
        .spin { animation: axiva-spin .9s linear infinite; }
        @keyframes axiva-spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  )
}
