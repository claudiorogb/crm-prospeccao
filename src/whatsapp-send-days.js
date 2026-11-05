// Trava dos dias dos follow-ups: o follow-up só pode cair em dia de envio configurado
// (padrão: segunda, quarta e sexta). A 1ª mensagem sai no próximo dia de envio disponível.
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const TOKEN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export const MIN_FOLLOWUP_DAYS = 2
export const MAX_FOLLOWUP_DAYS = 30

export function dayName(dow) { return DAY_NAMES[((dow % 7) + 7) % 7] }

function hhmm(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function brazilNow(now) {
  const date = new Date(now)
  const dow = TOKEN[new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(date)]
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  return { dow, minutes: hhmm(time) }
}

// Dia da semana (0=domingo) em que a 1ª mensagem será enviada se o envio for iniciado agora.
export function firstSendWeekday({ days, end = '18:00', now = Date.now() }) {
  const allowed = new Set((days || []).map(Number))
  if (!allowed.size) return null
  const current = brazilNow(now)
  const endMinutes = hhmm(end)
  if (allowed.has(current.dow) && (endMinutes == null || current.minutes <= endMinutes)) return current.dow
  for (let step = 1; step <= 7; step += 1) {
    const dow = (current.dow + step) % 7
    if (allowed.has(dow)) return dow
  }
  return null
}

// Valores de "dias depois" que fazem o follow-up cair em dia de envio.
export function validDelays({ days, fromWeekday }) {
  const allowed = new Set((days || []).map(Number))
  const result = []
  if (fromWeekday == null) return result
  for (let delay = MIN_FOLLOWUP_DAYS; delay <= MAX_FOLLOWUP_DAYS; delay += 1) {
    if (allowed.has((fromWeekday + delay) % 7)) result.push(delay)
  }
  return result
}

function nearest(options, wanted) {
  if (!options.length) return null
  return options.find(value => value >= wanted) ?? options[options.length - 1]
}

// Ajusta os dias escolhidos para valores válidos e informa o que cada follow-up significa.
export function planFollowups({ days, end, now, step1, step2, hasStep2 = true }) {
  const first = firstSendWeekday({ days, end, now })
  const options1 = validDelays({ days, fromWeekday: first })
  const d1 = nearest(options1, Number(step1) || 3)
  const weekday1 = d1 == null ? null : (first + d1) % 7
  const options2 = d1 == null ? [] : validDelays({ days, fromWeekday: weekday1 })
  const d2 = nearest(options2, Number(step2) || 5)
  const weekday2 = d2 == null ? null : (weekday1 + d2) % 7
  return {
    first, options1, options2, d1, d2, weekday1, weekday2,
    ok: d1 != null && (!hasStep2 || d2 != null),
    adjusted1: d1 != null && d1 !== Number(step1),
    adjusted2: hasStep2 && d2 != null && d2 !== Number(step2)
  }
}

// Confere um par de dias já escolhido (usado antes de iniciar o envio).
export function followupsProblem({ days, end, now, step1, step2, hasStep2 = true }) {
  const plan = planFollowups({ days, end, now, step1, step2, hasStep2 })
  if (!plan.ok) return 'Não há dia de envio configurado para os follow-ups.'
  if (plan.adjusted1 || plan.adjusted2) {
    return `Com o envio iniciando ${dayName(plan.first)}, os follow-ups precisam cair em dia de envio. Abra a "Sequência automática de follow-up", escolha os dias e salve novamente.`
  }
  return null
}
