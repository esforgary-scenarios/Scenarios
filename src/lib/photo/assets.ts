import type { ImageAsset } from '../../types'
import type { PhotoProject } from './types'

const assetKey = (asset: ImageAsset) => asset.path ? `path:${asset.path}` : `url:${asset.url}`

/** Keep undo sources in the saved asset registry until that history is discarded. */
export function compactPhotoAssets(project: PhotoProject, history: readonly PhotoProject[] = []): PhotoProject {
  const projects = [project, ...history]
  const needed = new Set(projects.flatMap(p => p.layers.flatMap(layer => layer.kind === 'image' && layer.imageId ? [layer.imageId] : [])))
  const assets: ImageAsset[] = [], seen = new Set<string>()
  for (const source of projects) for (const asset of source.assets) {
    if (needed.has(asset.id) && !seen.has(asset.id)) { assets.push(asset); seen.add(asset.id) }
  }
  if (project.assets.length === assets.length && project.assets.every((asset, index) => asset === assets[index])) return project
  return { ...project, assets }
}

/** Candidates still used by any current/history project remain protected. Caller must flush workspace before deletion. */
export function collectDiscardedPhotoAssets(candidates: readonly ImageAsset[], retainedProjects: readonly PhotoProject[]): ImageAsset[] {
  const retained = new Set(retainedProjects.flatMap(project => project.assets.map(assetKey)))
  const seen = new Set<string>()
  return candidates.filter(asset => {
    const key = assetKey(asset)
    if (retained.has(key) || seen.has(key)) return false
    seen.add(key); return true
  })
}
