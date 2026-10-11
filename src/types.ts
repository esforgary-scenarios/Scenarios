import type { JSONContent } from '@tiptap/core'
import type { PhotoFont, PhotoProject } from './lib/photo/types'

export interface ImageAsset { id: string; name: string; url: string; path?: string }
export interface VideoLink { id: string; title: string; url: string; description?: string }
export type QuoteColor = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'
export interface Quote { id: string; text: string; color?: QuoteColor; createdAt: string; updatedAt: string }
export interface Video {
  id: string
  title: string
  description?: string
  tags?: string[]
  content: JSONContent
  completed: boolean
  cover: ImageAsset | null
  images: ImageAsset[]
  links?: VideoLink[]
  photoProject?: PhotoProject
  createdAt: string
  updatedAt: string
}
export interface WorkspaceData { videos: Video[]; quotes: Quote[]; fonts?: PhotoFont[] }
export interface WorkspaceRepository {
  load(): Promise<WorkspaceData>
  save(data: WorkspaceData): Promise<void>
  upload(file: File): Promise<ImageAsset>
  removeImage(image: ImageAsset): Promise<void>
  dispose?(): void
}
