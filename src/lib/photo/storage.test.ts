import { describe, expect, it } from 'vitest'
import { parseStoredFonts } from './storage'
import { newPhotoLayer, newPhotoProject } from './types'
import { parseStoredVideos, videoAssets } from '../media'

const source = { id: 'source', name: 'Исходник.png', path: 'user/source.png', url: 'blob:temporary-source' }
const video = { id: 'video', title: 'Ролик', completed: false, content: { type: 'doc' }, cover: null, images: [], createdAt: '2026-10-11', updatedAt: '2026-10-11' }
const font = { id: 'font', family: 'Roboto Slab', cssUrl: 'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@100..900&display=swap' }
const project = () => ({ ...newPhotoProject(), assets: [source], layers: [newPhotoLayer('image', { imageId: source.id, groupId: 'group', blendMode: 'soft-light' }), newPhotoLayer('text', { text: 'Авторский текст\nС переносом', fill: { enabled: true, type: 'linear' as const, color: '#58a6ff', color2: '#d2a8ff', angle: 45 }, clipToBelow: true, groupId: 'group' })] })

describe('photo project snapshots', () => {
  it('round-trips editable layers, effects, grouping and source assets independently of gallery and cover', () => {
    const sourceProject = project()
    const input = [{ ...video, photoProject: sourceProject }, { ...video, id: 'second' }]
    const before = JSON.stringify(input)
    const saved = parseStoredVideos(input)
    const loaded = parseStoredVideos(JSON.parse(JSON.stringify(saved)))
    expect(loaded[0].photoProject?.layers).toEqual(sourceProject.layers)
    expect(loaded[0].photoProject?.assets).toEqual([{ id: source.id, name: source.name, path: source.path }])
    expect(loaded[0].images).toEqual([])
    expect(loaded[0].cover).toBeNull()
    expect(loaded[1]).not.toHaveProperty('photoProject')
    expect(videoAssets(loaded[0])).toEqual(loaded[0].photoProject?.assets)
    expect(JSON.stringify(saved)).not.toContain('blob:')
    expect(JSON.stringify(input)).toBe(before)
  })

  it.each([
    (p: ReturnType<typeof project>) => ({ ...p, width: 100000 }),
    (p: ReturnType<typeof project>) => ({ ...p, version: 99 }),
    (p: ReturnType<typeof project>) => ({ ...p, layers: [{ ...p.layers[0], opacity: NaN }] }),
    (p: ReturnType<typeof project>) => ({ ...p, layers: [{ ...p.layers[0], imageId: 'missing' }] }),
    (p: ReturnType<typeof project>) => ({ ...p, layers: [{ ...p.layers[0], blendMode: 'invalid' }] }),
    (p: ReturnType<typeof project>) => ({ ...p, layers: [p.layers[0], p.layers[0]] }),
    (p: ReturnType<typeof project>) => ({ ...p, assets: [{ ...source, path: undefined, url: 'data:image/png;base64,aaa' }] }),
  ])('rejects malformed project snapshots before enabling saves', change => {
    expect(() => parseStoredVideos([{ ...video, photoProject: change(project()) }])).toThrow()
  })
})

describe('persistent Google Fonts collection', () => {
  it('loads missing legacy fonts and round-trips a collection without mutation', () => {
    expect(parseStoredFonts(undefined)).toEqual([])
    const input = [font]
    expect(parseStoredFonts(input)).toEqual(input)
    expect(parseStoredFonts(input)).not.toBe(input)
  })

  it.each([
    'http://fonts.googleapis.com/css2?family=Roboto',
    'https://fonts.googleapis.com.evil.test/css2?family=Roboto',
    'https://fonts.googleapis.com:8443/css2?family=Roboto',
    'https://user:password@fonts.googleapis.com/css2?family=Roboto',
    'https://example.org/style.css',
    'javascript:alert(1)',
    'https://fonts.googleapis.com/css2',
    'https://fonts.googleapis.com/other?family=Roboto',
  ])('rejects unsafe or unrelated stylesheets %s', cssUrl => {
    expect(() => parseStoredFonts([{ ...font, cssUrl }])).toThrow()
  })
})
