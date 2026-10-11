export type ClipboardImages = { files: File[]; urls: string[] }

const imageExtension = /\.(?:png|jpe?g|webp|gif)$/i

function imageUrl(value: string, requireExtension: boolean): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (requireExtension && !imageExtension.test(url.pathname)) return null
    return url.href
  } catch {
    return null
  }
}

function readData(data: DataTransfer, type: string): string {
  try { return data.getData(type) } catch { return '' }
}

export function getClipboardImages(data: DataTransfer | null): ClipboardImages {
  if (!data) return { files: [], urls: [] }
  const urls: string[] = []
  const html = readData(data, 'text/html')
  if (html && typeof document !== 'undefined') {
    // A template is inert: pasted markup cannot run scripts or fetch images.
    const template = document.createElement('template')
    template.innerHTML = html
    for (const image of template.content.querySelectorAll('img[src]')) {
      const url = imageUrl(image.getAttribute('src') ?? '', false)
      if (url) urls.push(url)
    }
  }

  if (!urls.length) {
    const uriList = readData(data, 'text/uri-list')
    for (const line of uriList.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue
      const url = imageUrl(line, true)
      if (url) urls.push(url)
    }
    const plain = readData(data, 'text/plain').trim()
    // Only an entire image URL counts; prose containing a URL remains prose.
    if (plain && !/\s/.test(plain)) {
      const url = imageUrl(plain, true)
      if (url) urls.push(url)
    }
  }

  if (urls.length) return { files: [], urls: [...new Set(urls)] }
  const files = Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  return {
    files: files.length ? files : Array.from(data.files ?? []).filter((file) => file.type.startsWith('image/')),
    urls: [],
  }
}
