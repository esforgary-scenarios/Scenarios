import { describe, expect, it } from 'vitest'
import { createVideoLink, normalizeWebsiteUrl, parseVideoLinks } from './videoLinks'

describe('website links', () => {
  it.each([
    ['  example.com/article?q=two#part  ', 'https://example.com/article?q=two#part'],
    ['https://Example.COM', 'https://example.com/'],
    ['http://example.com/source', 'http://example.com/source'],
    ['example.com:8443/source', 'https://example.com:8443/source'],
    ['localhost:3000', 'https://localhost:3000/'],
    ['пример.рф/статья', 'https://xn--e1afmkfd.xn--p1ai/%D1%81%D1%82%D0%B0%D1%82%D1%8C%D1%8F'],
  ])('normalizes %j', (input, expected) => {
    expect(normalizeWebsiteUrl(input)).toBe(expected)
  })

  it.each([
    '', 'javascript:alert(1)', 'data:text/html,<h1>Hello</h1>', 'file:///tmp/source', 'ftp://example.com',
    'blob:https://example.com/id', 'mailto:example@example.com', '//example.com', '/source', '#fragment',
    'https://user:secret@example.com', 'user:secret@example.com', 'https://example.com/a\nb',
    'example.com\\other', 'not a website', 'https://', 'https://example.com:99999',
  ])('rejects unsafe or invalid URL %j', input => {
    expect(() => normalizeWebsiteUrl(input)).toThrow()
  })

  it('uses the website name when no title is entered and trims optional fields', () => {
    const link = createVideoLink({ title: ' ', url: 'example.com', description: '  Точная цитата\nСледующий абзац  ' })
    expect(link).toMatchObject({ title: 'example.com', url: 'https://example.com/', description: 'Точная цитата\nСледующий абзац' })
    expect(link.id).toBeTruthy()
  })

  it('preserves identity when editing and removes a cleared note', () => {
    expect(createVideoLink({ id: 'existing', title: '  Обновлённое название  ', url: 'http://example.org', description: '  ' }))
      .toEqual({ id: 'existing', title: 'Обновлённое название', url: 'http://example.org/' })
  })
})

describe('saved website links', () => {
  it('defaults missing links to an empty list', () => {
    expect(parseVideoLinks(undefined)).toEqual([])
  })

  it('preserves order and authored text without mutating records', () => {
    const input = [
      { id: 'first', title: '  Авторское название  ', url: 'https://example.com/first', description: '  Исходная заметка\n  ' },
      { id: 'last', title: 'Второй', url: 'https://example.com/last' },
    ]
    const before = JSON.stringify(input)
    const result = parseVideoLinks(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    expect(result[0]).not.toBe(input[0])
    expect(JSON.stringify(input)).toBe(before)
  })

  it.each([
    null, {}, [null], [{ title: 'Источник', url: 'https://example.com' }],
    [{ id: 'source', title: 'Источник', url: 7 }],
    [{ id: 'source', title: 'Источник', url: 'https://example.com', description: false }],
    [{ id: 'source', title: 'Один', url: 'https://example.com' }, { id: 'source', title: 'Два', url: 'https://example.org' }],
  ])('rejects malformed snapshots %j', input => {
    expect(() => parseVideoLinks(input)).toThrow()
  })
})
