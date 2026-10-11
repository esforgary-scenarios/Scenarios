import type { ImageAsset, Video } from '../types'
import { parseVideoLinks } from './videoLinks'
import { parsePhotoProject, type StoredPhotoProject } from './photo/storage'

export type StoredImageAsset = Omit<ImageAsset, 'url'> & { url?: string }
export type StoredVideo = Omit<Video, 'cover' | 'images' | 'photoProject'> & {
  cover: StoredImageAsset | null
  images: StoredImageAsset[]
  photoProject?: StoredPhotoProject<StoredImageAsset>
}

const DATA_ERROR = 'Не удалось прочитать сценарии: неверный формат данных. Обратитесь к владельцу проекта.'

/** External images are direct browser requests; never upload them to private storage. */
export function normalizeExternalImageUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || /[\u0000-\u0020\u007f\\]/.test(trimmed)) throw new Error('Укажите корректную HTTPS-ссылку на изображение.')
  let url: URL
  try { url = new URL(trimmed) } catch { throw new Error('Укажите корректную HTTPS-ссылку на изображение.') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Используйте HTTPS-ссылку без логина и пароля.')
  return url.href
}

export function createExternalImage(url: string, name?: string): ImageAsset {
  const safeUrl = normalizeExternalImageUrl(url)
  return { id: crypto.randomUUID(), name: name?.trim() || 'Изображение по ссылке', url: safeUrl }
}

function readImage(value: unknown): StoredImageAsset {
  if (!value || typeof value !== 'object') throw new Error(DATA_ERROR)
  const image = value as Record<string, unknown>
  if (typeof image.id !== 'string' || !image.id || typeof image.name !== 'string') throw new Error(DATA_ERROR)
  if (image.path !== undefined) {
    if (typeof image.path !== 'string' || !image.path) throw new Error(DATA_ERROR)
    // Stored file URLs are temporary. Each repository resolves its trusted path on load.
    return { id: image.id, name: image.name, path: image.path }
  }
  if (typeof image.url !== 'string') throw new Error(DATA_ERROR)
  return { id: image.id, name: image.name, url: normalizeExternalImageUrl(image.url) }
}

/** Reads both snapshot formats without mutating source records or author content. */
export function parseStoredVideos(value: unknown): StoredVideo[] {
  if (!Array.isArray(value)) throw new Error(DATA_ERROR)
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new Error(DATA_ERROR)
    const video = item as Record<string, unknown>
    if (typeof video.id !== 'string' || typeof video.title !== 'string' || typeof video.completed !== 'boolean'
      || !video.content || typeof video.content !== 'object' || Array.isArray(video.content) || !Array.isArray(video.images)
      || typeof video.createdAt !== 'string' || typeof video.updatedAt !== 'string'
      || (video.description !== undefined && typeof video.description !== 'string')
      || (video.tags !== undefined && (!Array.isArray(video.tags) || video.tags.some(tag => typeof tag !== 'string')))) throw new Error(DATA_ERROR)
    const images = video.images.map(readImage)
    const { coverId, photoProject: rawPhotoProject, ...rest } = video
    const photoProject = parsePhotoProject(rawPhotoProject, readImage)
    let cover: StoredImageAsset | null
    let gallery = images
    if (video.cover !== undefined) {
      cover = video.cover === null ? null : readImage(video.cover)
    } else {
      if (coverId !== undefined && coverId !== null && typeof coverId !== 'string') throw new Error(DATA_ERROR)
      cover = images.find(image => image.id === coverId) ?? null
      if (cover) {
        const coverId = cover.id
        gallery = images.filter(image => image.id !== coverId)
      }
    }
    return {
      ...rest, description: video.description ?? '', tags: video.tags === undefined ? [] : [...video.tags as string[]],
      cover, images: gallery, links: parseVideoLinks(video.links),
      ...(photoProject ? { photoProject } : {}),
    } as StoredVideo
  })
}

export function videoAssets<T extends StoredImageAsset>(video: { cover: T | null; images: T[]; photoProject?: { assets: T[] } }): T[] {
  return [...(video.cover ? [video.cover] : []), ...video.images, ...(video.photoProject?.assets ?? [])]
}
