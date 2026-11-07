// Período das compras na tela do cliente (último mês, trimestre, semestre, ano ou personalizado).
// "Último mês/trimestre/semestre/ano" = os últimos 1/3/6/12 meses contados até hoje, sem repetir o dia de partida.
export const CLIENT_PERIODS = [
  ['all', 'Todo o histórico'],
  ['month', 'Último mês'],
  ['quarter', 'Último trimestre'],
  ['semester', 'Último semestre'],
  ['year', 'Último ano'],
  ['custom', 'Personalizado']
]

const MONTHS = { month: 1, quarter: 3, semester: 6, year: 12 }
const ISO = /^\d{4}-\d{2}-\d{2}$/

export function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// Soma meses mantendo o dia; se o mês de destino for mais curto, usa o último dia dele (31/03 − 1 mês = 28/02).
export function addMonthsIso(iso, months) {
  const [y, m, d] = iso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, lastDay))
  return first.toISOString().slice(0, 10)
}

// Devolve { start, end, error }. "Todo o histórico" não tem limites. Período personalizado incompleto ou invertido vem com error.
export function clientPeriodRange(type, today, customStart = '', customEnd = '') {
  if (type === 'all') return { start: null, end: null, error: '' }
  if (type === 'custom') {
    if (!ISO.test(customStart) || !ISO.test(customEnd)) return { start: null, end: null, error: 'Informe a data inicial e a data final.' }
    if (customStart > customEnd) return { start: null, end: null, error: 'A data inicial não pode ser posterior à data final.' }
    return { start: customStart, end: customEnd, error: '' }
  }
  const months = MONTHS[type]
  if (!months) return { start: null, end: null, error: '' }
  return { start: addDaysIso(addMonthsIso(today, -months), 1), end: today, error: '' }
}

// Compras dentro do período (datas inclusive). Com erro no período, nada é mostrado.
export function salesInRange(sales, range) {
  if (range.error) return []
  return (sales || []).filter(sale => {
    const date = String(sale.sale_date || '').slice(0, 10)
    if (range.start && (!date || date < range.start)) return false
    if (range.end && (!date || date > range.end)) return false
    return true
  })
}

// Mesmos números dos cartões do cliente, só que para a lista já filtrada (lista do mais recente para o mais antigo).
export function salesMetrics(sales) {
  const total = sales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)
  return { count: sales.length, total, average: sales.length ? total / sales.length : 0, lastSale: sales[0] || null }
}
