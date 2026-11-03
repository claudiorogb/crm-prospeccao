// Botão Voltar do celular: volta à tela anterior em vez de sair do app.
//
// 1) Telas (páginas do menu): cada mudança de tela vira uma entrada no histórico do navegador;
//    o Voltar do sistema reaplica a tela anterior. Voltar para a tela de onde se veio desfaz o passo
//    (sem acumular entradas).
// 2) Camadas (menu aberto, conversa, detalhe de cliente...): o Voltar fecha a camada.
//
// Só guarda nomes de telas no histórico; nenhum dado da conta.

const keyOf = snap => JSON.stringify(snap)
let initialized = false
let currentKey = null

export function commitScreen(snap) {
  const key = keyOf(snap)
  const state = window.history.state || {}

  if (!initialized) {
    initialized = true
    currentKey = key
    window.history.replaceState({ axivaNav: snap, prevKey: null }, '')
    return
  }
  if (key === currentKey) return

  const previousKey = currentKey
  currentKey = key

  // Há uma camada aberta no topo (ex.: menu do celular): a nova tela ocupa o lugar dela.
  if (state.axivaLayer) {
    window.history.replaceState({ axivaNav: snap, prevKey: previousKey }, '')
    return
  }
  // Voltou para a tela de onde veio: desfaz o passo em vez de empilhar de novo.
  if (state.prevKey === key) {
    window.history.back()
    return
  }
  window.history.pushState({ axivaNav: snap, prevKey: previousKey }, '')
}

export function installScreenPopHandler(apply) {
  const onPop = event => {
    const snap = event.state && event.state.axivaNav
    if (!snap) return
    const key = keyOf(snap)
    if (key === currentKey) return
    currentKey = key
    apply(snap)
  }
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}

// Camada: enquanto aberta, o Voltar do sistema chama onBack (fechar). Fechar por outro caminho
// (X, botão da tela) desfaz a entrada do histórico.
export function openLayer(onBack) {
  const token = `axiva-layer-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let pushed = false
  let handledByBack = false

  const onPop = () => {
    if (window.history.state && window.history.state.axivaLayer === token) return
    handledByBack = true
    window.removeEventListener('popstate', onPop)
    if (onBack) onBack()
  }

  // adiado: não duplica a entrada quando o React reexecuta o efeito em desenvolvimento
  const openTimer = setTimeout(() => {
    window.history.pushState({ ...(window.history.state || {}), axivaLayer: token }, '')
    pushed = true
    window.addEventListener('popstate', onPop)
  }, 0)

  return function close() {
    clearTimeout(openTimer)
    window.removeEventListener('popstate', onPop)
    // adiado: se ao mesmo tempo a tela mudou, a camada já foi substituída e não há o que desfazer
    setTimeout(() => {
      if (pushed && !handledByBack && window.history.state && window.history.state.axivaLayer === token) window.history.back()
    }, 0)
  }
}
