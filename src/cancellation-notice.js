// Texto e controle da faixa "plano cancelado, acesso até ..." (discreta, sem popup).
export function formatBR(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function noticeText(daysLeft, accessUntil) {
  const date = formatBR(accessUntil)
  const n = Number(daysLeft)
  if (n <= 0) return `Plano cancelado — hoje é o último dia de acesso completo (${date}).`
  if (n === 1) return `Plano cancelado — o acesso completo termina amanhã (${date}).`
  return `Plano cancelado — acesso completo até ${date} (faltam ${n} dias).`
}

export const hideKey = (userId, today) => `axiva_cancel_notice_hidden_v1:${userId}:${today}`

export function brazilDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
