const REMOVE_TEXTS = new Set([
  'IMPORTAÇÃO SEGURA',
  'Selecione as empresas que devem receber a mensagem definida para o público-alvo.',
  'Oportunidades na etapa Negociação',
  'Leads que já tiveram proposta registrada',
  'Oportunidades atualmente em Interessado',
  'Resultado das oportunidades que saíram do funil ativo.',
  'Mostra quais origens geram leads, clientes e receita.'
])

const REPLACE_TEXTS = new Map([
  [
    'O arquivo é validado antes de qualquer inclusão na carteira. Somente administradores da empresa podem confirmar a importação.',
    'Somente administradores da empresa podem realizar a importação'
  ],
  [
    'Somente administradores da empresa podem confirmar a importação',
    'Somente administradores da empresa podem realizar a importação'
  ],
  [
    'Somente oportunidades que já chegaram a Interessado e ainda não foram encerradas.',
    'Oportunidades que já chegaram a Interessado e ainda não foram encerradas.'
  ],
  [
    'Conversão, propostas e vendas atribuídas a cada usuário da empresa.',
    'Conversão, propostas e vendas atribuídas a cada vendedor'
  ]
])

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function applyCopyCleanup() {
  document.querySelectorAll('body *').forEach(element => {
    if (element.children.length > 0) return

    const text = normalize(element.textContent)
    if (!text) return

    if (REMOVE_TEXTS.has(text)) {
      element.remove()
      return
    }

    const replacement = REPLACE_TEXTS.get(text)
    if (replacement) {
      element.textContent = replacement
      return
    }

    if (text === 'Em andamento') {
      element.style.whiteSpace = 'nowrap'
    }
  })
}

function scheduleCopyCleanup() {
  window.requestAnimationFrame(applyCopyCleanup)
}

const observer = new MutationObserver(scheduleCopyCleanup)

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyCopyCleanup()
    observer.observe(document.body, { childList: true, subtree: true })
  }, { once: true })
} else {
  applyCopyCleanup()
  observer.observe(document.body, { childList: true, subtree: true })
}
