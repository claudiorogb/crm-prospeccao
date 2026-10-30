import React, { useEffect, useRef, useState } from 'react'
import './help-tip.css'

// Interrogação com explicação em popup: abre ao passar o mouse, ao focar ou ao clicar.
export default function HelpTip({ text, label = 'Ajuda' }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!pinned) return undefined
    const close = event => { if (ref.current && !ref.current.contains(event.target)) { setPinned(false); setOpen(false) } }
    const onKey = event => { if (event.key === 'Escape') { setPinned(false); setOpen(false) } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey) }
  }, [pinned])

  return (
    <span className="help-tip-v1" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pinned) setOpen(false) }}>
      <button
        type="button"
        className="help-tip-btn-v1"
        aria-label={label}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => { if (!pinned) setOpen(false) }}
        onClick={() => { setPinned(value => !value); setOpen(true) }}
      >?</button>
      {open && <span role="tooltip" className="help-tip-pop-v1">{text}</span>}
    </span>
  )
}
