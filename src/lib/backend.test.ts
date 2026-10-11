import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newPhotoLayer, newPhotoProject } from './photo/types'

const mock = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }))

function setupCloud(videos: unknown[], quotes?: unknown, options: { empty?: boolean; conflict?: boolean; fonts?: unknown } = {}) {
  const save = vi.fn()
  const select = vi.fn()
  const eq = vi.fn()
  let stored: { videos: unknown[]; quotes?: unknown; fonts?: unknown; revision: number } | null = options.empty ? null : { videos, quotes, fonts: options.fonts, revision: 4 }
  const storage = {
    download: vi.fn(async () => ({ data: new Blob(['image']), error: null })),
    upload: vi.fn(async () => ({ data: {}, error: null })),
    remove: vi.fn(async () => ({ data: {}, error: null })),
  }
  type Query = {
    select: (fields: string) => Query; eq: (field: string, value: unknown) => Query
    update: (row: Record<string, unknown>) => Query; insert: (row: Record<string, unknown>) => Query
    maybeSingle: () => Promise<{ data: { videos?: unknown[]; quotes?: unknown; fonts?: unknown; revision: number } | null; error: { code: string } | null }>
  }
  const client = {
    rpc: vi.fn(async () => ({ data: true, error: null })),
    storage: { from: vi.fn(() => storage) },
    from: vi.fn(() => {
      let row: Record<string, unknown> | null = null
      let inserting = false
      const query: Query = {
        select: fields => { select(fields); return query },
        eq: (field, value) => { eq(field, value); return query },
        update: value => { row = value; save(value); return query },
        insert: value => { row = value; inserting = true; save(value); return query },
        maybeSingle: async () => {
          if (!row) return { data: stored, error: null }
          if (options.conflict) return { data: null, error: inserting ? { code: '23505' } : null }
          stored = { videos: row.videos as unknown[], quotes: row.quotes, fonts: row.fonts, revision: row.revision as number }
          return { data: { revision: stored.revision }, error: null }
        },
      }
      return query
    }),
  }
  mock.createClient.mockReturnValue(client)
  return { save, select, eq, storage, client }
}

const video = {
  id: 'saved-video', title: 'Сохранённый сценарий', completed: false,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Мой текст' }] }] },
  createdAt: '2026-01-01', updatedAt: '2026-09-15',
}
const quote = { id: 'saved-quote', text: '  Мысль для будущего ролика 🎬\n\nВторая строка  ', createdAt: '2026-10-01', updatedAt: '2026-10-02' }

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://supabase.example.org')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key-long-enough')
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('cloud cover and image persistence', () => {
  it('loads a legacy cover and gallery, then saves separate fields without deleting files', async () => {
    const cover = { id: 'cover', name: 'Превью', path: 'user/cover.png' }
    const gallery = { id: 'gallery', name: 'Галерея', path: 'user/gallery.png' }
    const cloud = setupCloud([{ ...video, coverId: cover.id, images: [cover, gallery] }])
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const loaded = await repository.load()
    expect(loaded.videos[0].cover).toMatchObject(cover)
    expect(loaded.videos[0].cover?.url).toMatch(/^blob:/)
    expect(loaded.videos[0].images).toHaveLength(1)
    expect(loaded.videos[0].content).toEqual(video.content)
    expect(loaded.quotes).toEqual([])
    expect(cloud.storage.download).toHaveBeenCalledTimes(2)
    await repository.save(loaded)
    expect(cloud.save).toHaveBeenCalledWith({ videos: [{ ...video, description: '', tags: [], cover, images: [gallery], links: [] }], quotes: [], fonts: [], revision: 5 })
    expect(cloud.storage.remove).not.toHaveBeenCalled()
    repository.dispose?.()
  })

  it('keeps external images and website links without contacting file storage', async () => {
    const cover = { id: 'external-cover', name: 'Превью', url: 'https://example.org/cover.png' }
    const image = { id: 'external-image', name: 'Кадр', url: 'https://example.org/photo.jpg?width=600' }
    const links = [{ id: 'source', title: 'Источник', url: 'https://example.org/article', description: 'Заметка к сценарию' }]
    const cloud = setupCloud([{ ...video, cover, images: [image], links }])
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const loaded = await repository.load()
    expect(loaded).toEqual({ videos: [{ ...video, description: '', tags: [], cover, images: [image], links }], quotes: [], fonts: [] })
    await repository.save(loaded)
    await repository.removeImage(cover)
    await repository.removeImage(image)
    expect(cloud.client.storage.from).not.toHaveBeenCalled()
    expect(cloud.save.mock.calls[0][0].videos[0]).toEqual({ ...video, description: '', tags: [], cover, images: [image], links })
    repository.dispose?.()
  })

  it('protects a file still referenced by a cover until the replacement is saved', async () => {
    const image = { id: 'cover', name: 'Превью', path: 'user/cover.png' }
    const cloud = setupCloud([{ ...video, cover: image, images: [] }])
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const { videos: [loaded], quotes } = await repository.load()
    await expect(repository.removeImage(loaded.cover!)).rejects.toThrow('Сначала сохраните')
    expect(cloud.storage.remove).not.toHaveBeenCalled()
    await repository.save({ videos: [{ ...loaded, cover: null }], quotes })
    await repository.removeImage(loaded.cover!)
    expect(cloud.storage.remove).toHaveBeenCalledWith(['user/cover.png'])
    repository.dispose?.()
  })

  it('rejects unsafe saved external URLs before any save or storage operation', async () => {
    const cloud = setupCloud([{ ...video, cover: { id: 'bad', name: 'Bad', url: 'javascript:alert(1)' }, images: [] }])
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    await expect(repository.load()).rejects.toThrow()
    expect(cloud.save).not.toHaveBeenCalled()
    expect(cloud.client.storage.from).not.toHaveBeenCalled()
    repository.dispose?.()
  })

  it('loads and saves per-video YouTube metadata in the workspace snapshot', async () => {
    const videos = [
      { ...video, description: '  Описание 🎬\n\nВторая строка  ', tags: ['Кино', 'мой ролик'], cover: null, images: [], links: [] },
      { ...video, id: 'other-video', description: '', tags: [], cover: null, images: [], links: [] },
    ]
    const cloud = setupCloud(videos)
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const loaded = await repository.load()
    expect(loaded).toEqual({ videos, quotes: [], fonts: [] })
    await repository.save(loaded)
    expect(cloud.save).toHaveBeenCalledWith({ videos, quotes: [], fonts: [], revision: 5 })
    expect(cloud.client.storage.from).not.toHaveBeenCalled()
    repository.dispose?.()
  })
})

describe('cloud quote library persistence', () => {
  it('creates a new workspace with an independent quote library and restores it', async () => {
    const cloud = setupCloud([], undefined, { empty: true })
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    expect(await repository.load()).toEqual({ videos: [], quotes: [], fonts: [] })
    await repository.save({ videos: [], quotes: [quote], fonts: [] })
    expect(cloud.save).toHaveBeenCalledWith({ user_id: 'user', videos: [], quotes: [quote], fonts: [], revision: 1 })
    expect(await repository.load()).toEqual({ videos: [], quotes: [quote], fonts: [] })
    expect(cloud.select.mock.calls[0][0].split(/,\s*/)).toEqual(['videos', 'quotes', 'fonts', 'revision'])
    expect(cloud.client.storage.from).not.toHaveBeenCalled()
    repository.dispose?.()
  })

  it('preserves the quote library when saving video edits and media when saving quote edits', async () => {
    const cover = { id: 'cover', name: 'Превью', path: 'user/cover.png' }
    const gallery = { id: 'gallery', name: 'Кадр', path: 'user/gallery.png' }
    const cloud = setupCloud([{ ...video, cover, images: [gallery] }], [quote])
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const loaded = await repository.load()
    expect(loaded.quotes).toEqual([quote])
    const editedVideos = loaded.videos.map(item => ({ ...item, title: 'Новое название' }))
    await repository.save({ ...loaded, videos: editedVideos })
    expect(cloud.save.mock.calls[0][0].quotes).toEqual([quote])
    const editedQuote = { ...quote, text: 'Новая мысль\nСледующая строка', color: 'blue' as const, updatedAt: '2026-10-11' }
    await repository.save({ videos: editedVideos, quotes: [editedQuote] })
    expect(cloud.save.mock.calls[1][0]).toEqual({
      videos: [{ ...video, title: 'Новое название', description: '', tags: [], cover, images: [gallery], links: [] }],
      quotes: [editedQuote], fonts: [], revision: 6,
    })
    expect(await repository.load()).toEqual({ videos: editedVideos, quotes: [editedQuote], fonts: [] })
    await expect(repository.removeImage(loaded.videos[0].cover!)).rejects.toThrow('Сначала сохраните')
    expect(cloud.storage.remove).not.toHaveBeenCalled()
    expect(cloud.storage.download).toHaveBeenCalledTimes(2)
    repository.dispose?.()
  })

  it('rejects a malformed saved quote before downloading media or enabling saves', async () => {
    const cloud = setupCloud([{ ...video, cover: { id: 'cover', name: 'Превью', path: 'user/cover.png' }, images: [] }], [quote, { ...quote, id: 'invalid', text: null }])
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    await expect(repository.load()).rejects.toThrow()
    await expect(repository.save({ videos: [], quotes: [], fonts: [] })).rejects.toThrow()
    expect(cloud.storage.download).not.toHaveBeenCalled()
    expect(cloud.save).not.toHaveBeenCalled()
    repository.dispose?.()
  })

  it('uses the shared revision guard for quote changes and preserves files on conflict', async () => {
    const cover = { id: 'cover', name: 'Превью', path: 'user/cover.png' }
    const cloud = setupCloud([{ ...video, cover, images: [] }], [quote], { conflict: true })
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const loaded = await repository.load()
    await expect(repository.save({ videos: loaded.videos.map(item => ({ ...item, cover: null })), quotes: [], fonts: [] })).rejects.toThrow('другом устройстве')
    expect(cloud.eq).toHaveBeenCalledWith('user_id', 'user')
    expect(cloud.eq).toHaveBeenCalledWith('revision', 4)
    await expect(repository.removeImage(loaded.videos[0].cover!)).rejects.toThrow('Сначала сохраните')
    expect(cloud.storage.remove).not.toHaveBeenCalled()
    expect((await repository.load()).quotes).toEqual([quote])
    repository.dispose?.()
  })

  it('reports a concurrent first-save insert as a workspace conflict', async () => {
    const cloud = setupCloud([], undefined, { empty: true, conflict: true })
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    await repository.load()
    await expect(repository.save({ videos: [], quotes: [quote], fonts: [] })).rejects.toThrow('другом устройстве')
    expect(cloud.save).toHaveBeenCalledWith({ user_id: 'user', videos: [], quotes: [quote], fonts: [], revision: 1 })
    repository.dispose?.()
  })
})

describe('cloud photo project persistence', () => {
  const source = { id: 'photo-source', name: 'Исходник', path: 'user/photo-source.png' }
  const fonts = [{ id: 'font', family: 'Roboto', cssUrl: 'https://fonts.googleapis.com/css2?family=Roboto:wght@100..900&display=swap' }]

  it('restores private project sources and shared fonts, then saves editable layers without blob URLs', async () => {
    const photoProject = { ...newPhotoProject(), assets: [source], layers: [newPhotoLayer('image', { imageId: source.id }), newPhotoLayer('text', { text: 'Заголовок', fontFamily: fonts[0].family })] }
    const cloud = setupCloud([{ ...video, cover: null, images: [], photoProject }], [quote], { fonts })
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const loaded = await repository.load()
    expect(loaded.fonts).toEqual(fonts)
    expect(loaded.videos[0].photoProject?.assets[0].url).toMatch(/^blob:/)
    expect(loaded.videos[0].images).toEqual([])
    expect(loaded.videos[0].cover).toBeNull()
    expect(cloud.storage.download).toHaveBeenCalledWith(source.path)
    await repository.save(loaded)
    expect(cloud.save.mock.calls[0][0]).toMatchObject({ fonts, quotes: [quote], videos: [{ photoProject }] })
    expect(JSON.stringify(cloud.save.mock.calls[0][0])).not.toContain('blob:')
    const reloaded = await repository.load()
    expect(reloaded).toEqual(loaded)
    repository.dispose?.()
  })

  it('retains an image removed from the gallery while its photo project still uses it', async () => {
    const photoProject = { ...newPhotoProject(), assets: [source], layers: [newPhotoLayer('image', { imageId: source.id })] }
    const cloud = setupCloud([{ ...video, cover: source, images: [source], photoProject }])
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const loaded = await repository.load()
    const image = loaded.videos[0].photoProject!.assets[0]
    await repository.save({ ...loaded, videos: loaded.videos.map(item => ({ ...item, cover: null, images: [] })) })
    await expect(repository.removeImage(image)).rejects.toThrow('Сначала сохраните')
    expect(cloud.storage.remove).not.toHaveBeenCalled()
    await repository.save({ ...loaded, videos: [] })
    await repository.removeImage(image)
    expect(cloud.storage.remove).toHaveBeenCalledWith([source.path])
    repository.dispose?.()
  })

  it('rejects private source paths belonging to a different account without storage access', async () => {
    const photoProject = { ...newPhotoProject(), assets: [{ ...source, path: 'other/private.png' }], layers: [newPhotoLayer('image', { imageId: source.id })] }
    const cloud = setupCloud([{ ...video, cover: null, images: [], photoProject }])
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    await expect(repository.load()).rejects.toThrow('Нет доступа')
    expect(cloud.storage.download).not.toHaveBeenCalled()
    repository.dispose?.()
  })

  it('protects sources if a concurrent edit rejects a photo deletion', async () => {
    const photoProject = { ...newPhotoProject(), assets: [source], layers: [newPhotoLayer('image', { imageId: source.id })] }
    const cloud = setupCloud([{ ...video, cover: null, images: [], photoProject }], [], { conflict: true, fonts })
    const { createCloudRepository } = await import('./backend')
    const repository = createCloudRepository('user')
    const loaded = await repository.load()
    await expect(repository.save({ ...loaded, videos: [] })).rejects.toThrow('другом устройстве')
    await expect(repository.removeImage(loaded.videos[0].photoProject!.assets[0])).rejects.toThrow('Сначала сохраните')
    expect(cloud.storage.remove).not.toHaveBeenCalled()
    repository.dispose?.()
  })
})
