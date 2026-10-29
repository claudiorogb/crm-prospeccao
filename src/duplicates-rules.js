// Detecção de leads duplicados (somente aviso; nunca mescla nem apaga).
export function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  return digits.length >= 10 ? digits : ''
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

export function normalizeSite(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]
  return host.includes('.') ? host : ''
}

// Para telefone, compara pelos 8 últimos dígitos + DDD (ignora o 9º dígito).
function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '')
  const local = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  if (local.length < 10) return ''
  return `${local.slice(0, 2)}-${local.slice(-8)}`
}

const KEYS = [
  ['phone', 'Mesmo telefone', l => phoneKey(l.phone) || phoneKey(l.whatsapp_phone)],
  ['email', 'Mesmo e-mail', l => normalizeEmail(l.email)],
  ['site', 'Mesmo site', l => normalizeSite(l.website)]
]

// Retorna grupos { kind, reason, key, leads[] } com 2+ leads. Um lead pode aparecer em mais de um grupo.
export function findDuplicateGroups(leads) {
  const groups = []
  for (const [kind, reason, keyOf] of KEYS) {
    const map = new Map()
    for (const lead of leads) {
      const key = keyOf(lead)
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(lead)
    }
    for (const [key, list] of map) {
      if (list.length > 1) groups.push({ kind, reason, key: `${kind}:${key}`, leads: [...list].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) })
    }
  }
  return groups
}
