import { useEffect, useRef } from 'react'
import { openLayer } from './back-navigation'

// Enquanto `active` for verdadeiro, o botão Voltar do celular chama `onBack` (fechar) em vez de sair do app.
export function useBackLayer(active, onBack) {
  const callback = useRef(onBack)
  callback.current = onBack

  useEffect(() => {
    if (!active) return undefined
    return openLayer(() => { if (callback.current) callback.current() })
  }, [active])
}
