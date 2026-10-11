import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClipboardImages } from './clipboardImages'

function clipboard(values: Record<string, string> = {}, files: File[] = []): DataTransfer {
  return {
    getData: (type: string) => values[type] ?? '',
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    files,
  } as unknown as DataTransfer
}

/** The browser's inert-template parser supplies these source attributes. */
function htmlSources(sources: string[]) {
  const querySelectorAll = vi.fn(() => sources.map((src) => ({ getAttribute: () => src })))
  const template = { innerHTML: '', content: { querySelectorAll } }
  const createElement = vi.fn(() => template)
  vi.stubGlobal('document', { createElement })
  return { template, createElement, querySelectorAll }
}

afterEach(() => vi.unstubAllGlobals())

describe('clipboard image extraction', () => {
  it('ignores missing data, normal prose and arbitrary links', () => {
    expect(getClipboardImages(null)).toEqual({ files: [], urls: [] })
    for (const text of ['Обычный текст', 'https://example.com/article', 'Фото: https://example.com/a.png']) {
      expect(getClipboardImages(clipboard({ 'text/plain': text }))).toEqual({ files: [], urls: [] })
    }
  })

  it('accepts exact HTTPS image URLs with supported extensions, queries and fragments', () => {
    for (const extension of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'PNG']) {
      const url = `https://example.com/image.${extension}?width=1200#preview`
      expect(getClipboardImages(clipboard({ 'text/plain': ` ${url} ` })))
        .toEqual({ files: [], urls: [url] })
    }
  })

  it('rejects unsafe schemes, credentials and ambiguous plain-text URL lists', () => {
    for (const url of [
      'http://example.com/a.png', 'data:image/png;base64,abc',
      'blob:https://example.com/a.png', 'javascript:alert(1)',
      'file:///a.png', 'https://user:password@example.com/a.png',
      'https://example.com/a.png\nhttps://example.com/b.png',
      'https://example.com/image.svg',
    ]) expect(getClipboardImages(clipboard({ 'text/plain': url }))).toEqual({ files: [], urls: [] })
  })

  it('reads URI-list lines and comments, deduplicating against plain text', () => {
    const url = 'https://example.com/a.png?x=1'
    const data = clipboard({
      'text/uri-list': `# Copied image\r\n${url}\r\nhttps://example.com/article\r\nhttps://example.com/b.gif`,
      'text/plain': url,
    })
    expect(getClipboardImages(data)).toEqual({ files: [], urls: [url, 'https://example.com/b.gif'] })
  })

  it('prefers safe HTML image sources over binary duplicates and other text formats', () => {
    const html = '<img src="https://example.com/render?id=1">'
    const dom = htmlSources([
      'https://example.com/render?id=1', 'https://example.com/render?id=1',
      'data:image/png;base64,abc', 'blob:https://example.com/id', 'javascript:alert(1)',
    ])
    const file = new File(['image'], 'clipboard.png', { type: 'image/png' })
    const data = clipboard({ 'text/html': html, 'text/plain': 'https://example.com/other.png' }, [file])
    expect(getClipboardImages(data)).toEqual({ files: [], urls: ['https://example.com/render?id=1'] })
    expect(dom.createElement).toHaveBeenCalledWith('template')
    expect(dom.template.innerHTML).toBe(html)
    expect(dom.querySelectorAll).toHaveBeenCalledWith('img[src]')
  })

  it('falls back to image files when HTML has no safe image source', () => {
    htmlSources(['blob:https://example.com/id', 'http://example.com/a.png'])
    const image = new File(['image'], 'clipboard.png', { type: 'image/png' })
    const text = new File(['text'], 'notes.txt', { type: 'text/plain' })
    expect(getClipboardImages(clipboard({ 'text/html': '<img>' }, [image, text])))
      .toEqual({ files: [image], urls: [] })
  })

  it('uses file-list fallback when clipboard items are unavailable', () => {
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    const data = { getData: () => '', files: [file] } as unknown as DataTransfer
    expect(getClipboardImages(data)).toEqual({ files: [file], urls: [] })
  })

  it('prefers a plain image URL over its clipboard file duplicate', () => {
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    const url = 'https://example.com/photo.png'
    expect(getClipboardImages(clipboard({ 'text/plain': url }, [file])))
      .toEqual({ files: [], urls: [url] })
  })
})
