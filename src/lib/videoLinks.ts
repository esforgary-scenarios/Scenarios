import type { VideoLink } from '../types'

const URL_ERROR = 'Укажите ссылку на сайт, например example.com или https://example.com.'
const DATA_ERROR = 'Не удалось прочитать ссылки к ролику: неверный формат данных.'

/** Accept ordinary website addresses without allowing executable URLs or credentials. */
export function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || /[\u0000-\u0020\u007f\\]/.test(trimmed) || /^[/?#]/.test(trimmed)) throw new Error(URL_ERROR)
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  const hostWithPort = /^(?:localhost|[^/:]+\.[^/:]+):\d+(?:[/?#]|$)/i.test(trimmed)
  if (hasScheme && !/^https?:\/\//i.test(trimmed) && !hostWithPort) throw new Error('Поддерживаются только ссылки HTTP и HTTPS.')
  let url: URL
  try { url = new URL(hasScheme && !hostWithPort ? trimmed : `https://${trimmed}`) }
  catch { throw new Error(URL_ERROR) }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) throw new Error(URL_ERROR)
  if (url.username || url.password) throw new Error('Используйте ссылку без логина и пароля.')
  return url.href
}

export function createVideoLink(input: { id?: string; title: string; url: string; description?: string }): VideoLink {
  const url = normalizeWebsiteUrl(input.url)
  const description = input.description?.trim()
  return {
    id: input.id ?? crypto.randomUUID(),
    title: input.title.trim() || new URL(url).hostname,
    url,
    ...(description ? { description } : {}),
  }
}

/** Missing links are the legacy snapshot format; malformed saved data must not be discarded. */
export function parseVideoLinks(value: unknown): VideoLink[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(DATA_ERROR)
  const ids = new Set<string>()
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new Error(DATA_ERROR)
    const link = item as Record<string, unknown>
    if (typeof link.id !== 'string' || !link.id || ids.has(link.id) || typeof link.title !== 'string'
      || typeof link.url !== 'string' || (link.description !== undefined && typeof link.description !== 'string')) throw new Error(DATA_ERROR)
    ids.add(link.id)
    return {
      id: link.id,
      title: link.title,
      url: normalizeWebsiteUrl(link.url),
      ...(link.description !== undefined ? { description: link.description } : {}),
    }
  })
}
