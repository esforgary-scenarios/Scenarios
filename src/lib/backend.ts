import { createClient } from '@supabase/supabase-js'
import type { ImageAsset, Video, WorkspaceRepository } from '../types'
import { AUTH_STORAGE_KEY, authStorage } from './sessionStorage'
import { normalizeExternalImageUrl, parseStoredVideos, videoAssets, type StoredImageAsset } from './media'
import { parseStoredQuotes } from './quotes'
import { parseStoredFonts } from './photo/storage'

export { clearAuthStorage, getRememberExpiry, isAuthExpired, prepareSignIn, watchAuthExpiry } from './sessionStorage'

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
export const backendConfigured = /^https:\/\/[^/]+/.test(projectUrl) && publishableKey.length > 20
export const supabase = backendConfigured ? createClient(projectUrl, publishableKey, {
  auth: { storage: authStorage, storageKey: AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null

const BUCKET = 'script-assets'
const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const CONFLICT_MESSAGE = 'Данные изменились на другом устройстве. Скопируйте несохранённые тексты, затем обновите страницу, чтобы загрузить актуальную версию.'

export async function validateImage(file: File): Promise<void> {
  if (!MIME_EXTENSIONS[file.type]) throw new Error('Поддерживаются изображения PNG, JPEG, WebP и GIF.')
  if (file.size > MAX_IMAGE_SIZE) throw new Error('Изображение должно быть не больше 10 МБ.')
  if (!file.size) throw new Error('Файл изображения пуст.')
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const ascii = (start: number, end: number) => String.fromCharCode(...header.slice(start, end))
  const matches = file.type === 'image/png' ? header[0] === 137 && ascii(1, 4) === 'PNG' && header[4] === 13 && header[5] === 10 && header[6] === 26 && header[7] === 10
    : file.type === 'image/jpeg' ? header[0] === 255 && header[1] === 216 && header[2] === 255
    : file.type === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
    : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  if (!matches) throw new Error('Содержимое файла не соответствует формату изображения.')
}

export function createCloudRepository(userId: string): WorkspaceRepository {
  if (!supabase) throw new Error('Сначала подключите Supabase.')
  const client = supabase
  let revision: number | null = null
  let loaded = false
  let disposed = false
  const imageUrls = new Map<string, string>()
  let savedImagePaths = new Set<string>()

  function ownPath(path: string) {
    if (!path.startsWith(`${userId}/`) || path.includes('..') || /[\\\u0000-\u001f\u007f]/.test(path)) throw new Error('Нет доступа к изображению.')
    return path
  }

  async function restoreImage(image: StoredImageAsset): Promise<ImageAsset> {
    if (!image.path) return { id: image.id, name: image.name, url: normalizeExternalImageUrl(image.url ?? '') }
    const path = ownPath(image.path)
    const cached = imageUrls.get(path)
    if (cached) return { ...image, url: cached }
    const { data, error } = await client.storage.from(BUCKET).download(path)
    if (error) throw new Error(`Не удалось загрузить изображение «${image.name}». Проверьте подключение и повторите вход.`)
    if (disposed) throw new Error('Рабочая сессия закрыта.')
    const url = URL.createObjectURL(data)
    imageUrls.set(path, url)
    return { ...image, url }
  }

  return {
    async load() {
      const { data: active, error: sessionError } = await client.rpc('kadr_session_active')
      if (sessionError) throw new Error('Не удалось проверить вход. Проверьте подключение и выполните supabase/schema.sql в SQL Editor.')
      if (!active) throw new Error('Срок входа истёк. Выйдите из аккаунта и войдите снова.')
      const { data, error } = await client.from('workspaces').select('videos, quotes, fonts, revision').eq('user_id', userId).maybeSingle()
      if (error) throw new Error('Не удалось загрузить данные. Проверьте подключение, настройки Supabase и срок входа.')
      const videos = data ? parseStoredVideos(data.videos) : []
      const quotes = parseStoredQuotes(data?.quotes)
      const fonts = parseStoredFonts(data?.fonts)
      // Downloads are authenticated; blob URLs stay usable while the workspace is open.
      const result: Video[] = []
      for (const video of videos) {
        const images: ImageAsset[] = []
        for (let index = 0; index < video.images.length; index += 4) images.push(...await Promise.all(video.images.slice(index, index + 4).map(restoreImage)))
        const cover = video.cover ? await restoreImage(video.cover) : null
        const { photoProject: storedProject, ...rest } = video
        const assets: ImageAsset[] = []
        if (storedProject) for (let index = 0; index < storedProject.assets.length; index += 4) assets.push(...await Promise.all(storedProject.assets.slice(index, index + 4).map(restoreImage)))
        result.push({ ...rest, cover, images, ...(storedProject ? { photoProject: { ...storedProject, assets } } : {}) })
      }
      revision = data?.revision ?? null
      savedImagePaths = new Set(result.flatMap(video => videoAssets(video).flatMap(image => image.path ? [image.path] : [])))
      loaded = true
      return { videos: result, quotes, fonts }
    },
    async save(data) {
      if (!loaded || disposed) throw new Error('Сначала дождитесь загрузки данных.')
      const snapshot = parseStoredVideos(data.videos)
      const quotes = parseStoredQuotes(data.quotes)
      const fonts = parseStoredFonts(data.fonts)
      for (const video of snapshot) for (const image of videoAssets(video)) if (image.path) ownPath(image.path)
      const nextRevision = (revision ?? 0) + 1
      const row = { user_id: userId, videos: snapshot, quotes, fonts, revision: nextRevision }
      const query = revision === null ? client.from('workspaces').insert(row).select('revision').maybeSingle()
        : client.from('workspaces').update({ videos: snapshot, quotes, fonts, revision: nextRevision }).eq('user_id', userId).eq('revision', revision).select('revision').maybeSingle()
      const { data: saved, error } = await query
      if (error?.code === '23505' || (!error && !saved)) throw new Error(CONFLICT_MESSAGE)
      if (error) throw new Error('Не удалось сохранить данные. Проверьте подключение и срок входа, затем повторите сохранение.')
      revision = saved!.revision
      savedImagePaths = new Set(snapshot.flatMap(video => videoAssets(video).flatMap(image => image.path ? [image.path] : [])))
    },
    async upload(file) {
      await validateImage(file)
      if (disposed) throw new Error('Рабочая сессия закрыта.')
      const id = crypto.randomUUID()
      const path = `${userId}/${id}.${MIME_EXTENSIONS[file.type]}`
      const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw new Error('Не удалось загрузить изображение. Проверьте подключение и настройки хранилища Supabase.')
      if (disposed) throw new Error('Рабочая сессия закрыта.')
      const url = URL.createObjectURL(file)
      imageUrls.set(path, url)
      return { id, name: file.name || `Изображение.${MIME_EXTENSIONS[file.type]}`, path, url }
    },
    async removeImage(image) {
      if (!image.path) return
      const path = ownPath(image.path)
      // The UI first saves the updated workspace. A failed/conflicting save must keep the file intact.
      if (!loaded || savedImagePaths.has(path)) throw new Error('Сначала сохраните удаление изображения из сценария.')
      const { error } = await client.storage.from(BUCKET).remove([path])
      if (error) throw new Error('Сценарий сохранён, но удалить файл из хранилища не удалось.')
      const url = imageUrls.get(path)
      if (url) URL.revokeObjectURL(url)
      imageUrls.delete(path)
    },
    dispose() {
      disposed = true
      imageUrls.forEach(url => URL.revokeObjectURL(url))
      imageUrls.clear()
    },
  }
}
