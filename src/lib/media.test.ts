import { describe, expect, it } from 'vitest'
import { createExternalImage, normalizeExternalImageUrl, parseStoredVideos, videoAssets } from './media'

const cover = { id: 'cover-image', name: 'Моё превью', path: 'user/cover.png' }
const first = { id: 'first-image', name: 'Первый кадр', path: 'user/first.png' }
const last = { id: 'last-image', name: 'Последний кадр', path: 'user/last.png' }
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Авторский сценарий', marks: [{ type: 'bold' }] }] }] }
const legacy = () => ({ id: 'my-video', title: 'Мой ролик', content, completed: true, coverId: cover.id, images: [first, cover, last], createdAt: '2026-01-01', updatedAt: '2026-04-11' })

describe('stored cover migration', () => {
  it('moves an old cover out of the gallery without changing text, metadata, order, or source records', () => {
    const input = [legacy(), { ...legacy(), id: 'second-video', coverId: null }]
    const before = JSON.stringify(input)
    const result = parseStoredVideos(input)
    expect(result.map(video => video.id)).toEqual(['my-video', 'second-video'])
    expect(result[0].cover).toEqual(cover)
    expect(result[0].images).toEqual([first, last])
    expect(result[0].content).toBe(content)
    expect(result[0].links).toEqual([])
    expect(result[0].description).toBe('')
    expect(result[0].tags).toEqual([])
    expect(result[0]).toMatchObject({ title: 'Мой ролик', completed: true, createdAt: '2026-01-01', updatedAt: '2026-04-11' })
    expect(result[0]).not.toHaveProperty('coverId')
    expect(result[1].cover).toBeNull()
    expect(result[1].images).toEqual(input[1].images)
    expect(JSON.stringify(input)).toBe(before)
    expect(videoAssets(result[0])).toHaveLength(3)
  })

  it('keeps all images when a legacy cover reference does not resolve', () => {
    const input = { ...legacy(), coverId: 'missing' }
    const [result] = parseStoredVideos([input])
    expect(result.cover).toBeNull()
    expect(result.images).toEqual(input.images)
  })

  it('is idempotent and respects an explicitly cleared cover even with a stale legacy key', () => {
    const migrated = parseStoredVideos([legacy()])
    expect(parseStoredVideos(migrated)).toEqual(migrated)
    const [cleared] = parseStoredVideos([{ ...legacy(), cover: null }])
    expect(cleared.cover).toBeNull()
    expect(cleared.images).toEqual(legacy().images)
  })

  it('serializes separate covers and external links while excluding temporary file URLs', () => {
    const external = { id: 'link', name: 'Ссылка', url: 'https://images.example.org/image.jpg?token=abc' }
    const [result] = parseStoredVideos([{ ...legacy(), cover: { ...cover, url: 'blob:temporary' }, images: [external, { ...first, url: 'blob:temporary-2' }] }])
    expect(result.cover).toEqual(cover)
    expect(result.images).toEqual([external, first])
    expect(JSON.stringify(result)).not.toContain('blob:')
  })

  it('rejects malformed images without mutating or silently dropping saved data', () => {
    const input = { ...legacy(), images: [{ ...first, path: undefined, url: 'javascript:alert(1)' }] }
    const before = JSON.stringify(input)
    expect(() => parseStoredVideos([input])).toThrow()
    expect(JSON.stringify(input)).toBe(before)
  })

  it('preserves an intentionally empty workspace', () => {
    expect(parseStoredVideos([])).toEqual([])
  })

  it('round-trips per-video website links without changing authored content or media', () => {
    const links = [{ id: 'source', title: 'Источник', url: 'https://example.org/article?q=1#chapter', description: 'Нужный фрагмент\nИ ещё одна мысль' }]
    const input = [{ ...legacy(), cover, images: [first, last], links }, { ...legacy(), id: 'second-video', cover: null, links: [] }]
    const before = JSON.stringify(input)
    const saved = parseStoredVideos(input)
    const loaded = parseStoredVideos(JSON.parse(JSON.stringify(saved)))
    expect(loaded[0].links).toEqual(links)
    expect(loaded[1].links).toEqual([])
    expect(loaded[0].content).toEqual(content)
    expect(saved[0].content).toBe(content)
    expect(loaded[0].cover).toEqual(cover)
    expect(loaded[0].images).toEqual([first, last])
    expect(JSON.stringify(input)).toBe(before)
  })

  it('rejects unsafe saved website links without mutating or dropping author data', () => {
    const input = [{ ...legacy(), links: [{ id: 'source', title: 'Источник', url: 'javascript:alert(1)' }] }]
    const before = JSON.stringify(input)
    expect(() => parseStoredVideos(input)).toThrow()
    expect(JSON.stringify(input)).toBe(before)
  })

  it('round-trips description and tags for each video without changing authored formatting', () => {
    const description = '  Авторское описание 🎬\n\nhttps://example.org/watch?x=1&y=2  '
    const tags = ['Кино', 'мой ролик', 'КИНО', '🎬']
    const input = [{ ...legacy(), description, tags }, { ...legacy(), id: 'second-video', description: 'Другой ролик', tags: ['другое'] }]
    const before = JSON.stringify(input)
    const saved = parseStoredVideos(input)
    const loaded = parseStoredVideos(JSON.parse(JSON.stringify(saved)))
    expect(loaded[0]).toMatchObject({ description, tags, content })
    expect(loaded[1]).toMatchObject({ description: 'Другой ролик', tags: ['другое'] })
    expect(saved[0].tags).not.toBe(tags)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('preserves legacy metadata exceeding current editor limits or containing unsupported characters', () => {
    const title = '<Заголовок> ' + 'я'.repeat(110)
    const description = '  <Авторский текст>\n' + 'я'.repeat(5001)
    const tags = ['мой тег', 'мой тег', '<архив>', 'я'.repeat(501)]
    const [result] = parseStoredVideos([{ ...legacy(), title, description, tags }])
    expect(result).toMatchObject({ title, description, tags })
    expect(parseStoredVideos(JSON.parse(JSON.stringify([result])))).toEqual([result])
  })

  it.each([
    { description: null }, { description: 42 }, { description: {} },
    { tags: null }, { tags: 'one, two' }, { tags: [null] }, { tags: [1] }, { tags: [{}] },
  ])('rejects the whole snapshot for invalid metadata types %j without changing the input', metadata => {
    const input = [legacy(), { ...legacy(), id: 'invalid-video', ...metadata }]
    const before = JSON.stringify(input)
    expect(() => parseStoredVideos(input)).toThrow('неверный формат данных')
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('external image URLs', () => {
  it('creates a direct HTTPS image without a storage path', () => {
    const image = createExternalImage('  https://example.org/image.png?size=2  ', '  Кадр  ')
    expect(image).toMatchObject({ name: 'Кадр', url: 'https://example.org/image.png?size=2' })
    expect(image.id).toBeTruthy()
    expect(image).not.toHaveProperty('path')
  })

  it.each([
    'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'blob:https://example.org/123',
    'http://example.org/image.png', '//example.org/image.png', '/image.png',
    'https://user:password@example.org/image.png', 'https://example.org/a\nb.png',
    'https://example.org\\other/image.png', 'https://example.org/a b.png', '',
  ])('rejects unsafe or invalid URL %j', value => {
    expect(() => normalizeExternalImageUrl(value)).toThrow()
  })
})
