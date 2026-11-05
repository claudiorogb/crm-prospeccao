// Extrai o código de 11 caracteres de um link do YouTube.
// Aceita: youtube.com/watch?v=ID, youtu.be/ID, /embed/ID, /shorts/ID, /live/ID.
// Se receber só o código (11 caracteres), também aceita. Retorna '' se não for válido.
const ID = /^[A-Za-z0-9_-]{11}$/

export function parseYoutubeId(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (ID.test(raw)) return raw
  let url
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return ''
  }
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '')
  let candidate = ''
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/')[1] || ''
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') candidate = url.searchParams.get('v') || ''
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) candidate = parts[1] || ''
  }
  return ID.test(candidate) ? candidate : ''
}

export const youtubeThumb = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
export const youtubeEmbed = id => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`
export const youtubeWatch = id => `https://www.youtube.com/watch?v=${id}`
