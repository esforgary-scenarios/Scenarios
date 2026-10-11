import type { PhotoFont } from './types'

export const BUILTIN_PHOTO_FONTS = ['Arial', 'Georgia', 'Verdana', 'Times New Roman', 'Courier New', 'Impact']

const invalidUrl = 'Вставьте ссылку на шрифт с fonts.google.com/specimen/ или fonts.googleapis.com/css2.'
const familyPattern = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} -]{0,99}$/u

/** Rebuild the URL rather than trusting arbitrary CSS, subset parameters or credentials. */
export function parseGoogleFontUrl(input: string): PhotoFont {
  const source = input.trim()
  if (!source || /[\u0000-\u001f\u007f\\]/.test(source)) throw new Error(invalidUrl)
  let url: URL
  try { url = new URL(source) } catch { throw new Error(invalidUrl) }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error(invalidUrl)

  let spec = ''
  if (url.hostname === 'fonts.google.com') {
    const match = /^\/specimen\/([^/]+)\/?$/.exec(url.pathname)
    if (!match) throw new Error(invalidUrl)
    try { spec = decodeURIComponent(match[1]).replace(/\+/g, ' ') } catch { throw new Error(invalidUrl) }
  } else if (url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2') {
    const families = url.searchParams.getAll('family')
    if (families.length !== 1) throw new Error('Добавляйте шрифты по одному: ссылка должна содержать одну семью шрифта.')
    spec = families[0]
  } else throw new Error(invalidUrl)

  const [rawFamily, axes, ...rest] = spec.split(':')
  const family = rawFamily.trim().replace(/\s+/g, ' ')
  if (!familyPattern.test(family) || rest.length || (axes !== undefined && !/^[A-Za-z]{4}(?:,[A-Za-z]{4})*@-?\d+(?:\.\d+)?(?:\.\.-?\d+(?:\.\d+)?)?(?:[,;]-?\d+(?:\.\d+)?(?:\.\.-?\d+(?:\.\d+)?)?)*$/.test(axes))) {
    throw new Error('Не удалось прочитать название или начертания шрифта. Скопируйте ссылку со страницы Google Fonts.')
  }
  const css = new URL('https://fonts.googleapis.com/css2')
  css.searchParams.set('family', family + (axes ? `:${axes}` : ''))
  css.searchParams.set('display', 'swap')
  return { id: `google-${encodeURIComponent(family.toLowerCase())}`, family, cssUrl: css.href }
}

const pendingFonts = new Map<string, Promise<void>>()

function loadPhotoFont(font: PhotoFont): Promise<void> {
  const parsed = parseGoogleFontUrl(font.cssUrl)
  if (parsed.family !== font.family) return Promise.reject(new Error(`Ссылка шрифта «${font.family}» не соответствует его названию.`))
  if (typeof document === 'undefined') return Promise.resolve()
  const cached = pendingFonts.get(parsed.cssUrl)
  if (cached) return cached
  const promise = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = parsed.cssUrl
    link.dataset.photoFont = parsed.family
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      link.onload = null
      link.onerror = null
      if (error) { link.remove(); reject(error) } else resolve()
    }
    const timer = window.setTimeout(() => finish(new Error(`Шрифт «${font.family}» не загрузился. Проверьте подключение и повторите.`)), 20000)
    link.onerror = () => finish(new Error(`Google Fonts не загрузил «${font.family}». Проверьте название шрифта и доступ к сервису.`))
    link.onload = () => {
      if (!document.fonts) { finish(); return }
      void document.fonts.load(`16px "${parsed.family}"`, 'Aa Яя 123')
        .then(() => document.fonts.ready)
        .then(() => finish(), () => finish(new Error(`Не удалось загрузить файл шрифта «${font.family}».`)))
    }
    document.head.appendChild(link)
  })
  pendingFonts.set(parsed.cssUrl, promise)
  void promise.catch(() => { pendingFonts.delete(parsed.cssUrl) })
  return promise
}

export async function loadPhotoFonts(fonts: PhotoFont[]): Promise<void> {
  const results = await Promise.allSettled(fonts.map(font => loadPhotoFont(font)))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
