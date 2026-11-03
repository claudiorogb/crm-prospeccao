import React, { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'

// Linha do menu "Instalar CRM no celular". Só aparece em celular/tablet e enquanto o app
// não estiver instalado (a regra fica em public/pwa/pwa-install.js; no computador nunca aparece).
export default function InstallAppMenuItem({ onDone }) {
  const [visible, setVisible] = useState(() => Boolean(window.axivaPwa?.canShow()))

  useEffect(() => {
    const sync = () => setVisible(Boolean(window.axivaPwa?.canShow()))
    sync()
    window.addEventListener('axiva-pwa-change', sync)
    return () => window.removeEventListener('axiva-pwa-change', sync)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      className="nav-item"
      onClick={() => {
        if (onDone) onDone()
        window.axivaPwa?.install()
      }}
    >
      <Smartphone size={18}/> Instalar CRM no celular
    </button>
  )
}
