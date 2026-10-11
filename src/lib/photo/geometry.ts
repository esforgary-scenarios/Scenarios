import type { PhotoLayer } from './types'
export type Point = { x: number; y: number }
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export function localPoint(layer: PhotoLayer, point: Point): Point {
  const a = -layer.rotation * Math.PI / 180, dx = point.x - layer.x - layer.width / 2, dy = point.y - layer.y - layer.height / 2
  const x = dx * Math.cos(a) - dy * Math.sin(a) + layer.width / 2
  const y = dx * Math.sin(a) + dy * Math.cos(a) + layer.height / 2
  return { x: layer.flipX ? layer.width - x : x, y: layer.flipY ? layer.height - y : y }
}
export function containsPoint(layer: PhotoLayer, point: Point) {
  const p = localPoint(layer, point)
  return p.x >= 0 && p.y >= 0 && p.x <= layer.width && p.y <= layer.height
}
/** Resize from bottom-right in the layer's rotated frame, keeping its top-left fixed. */
export function resizePhotoLayer(layer: PhotoLayer, start: Point, end: Point, preserveRatio = false): PhotoLayer {
  const unflipped = { ...layer, flipX: false, flipY: false }, first = localPoint(unflipped, start), last = localPoint(unflipped, end)
  let width = clamp(layer.width + last.x - first.x, 1, 4096), height = clamp(layer.height + last.y - first.y, 1, 4096)
  if (preserveRatio) { const factor = Math.min(width / layer.width, 4096 / layer.height); width = layer.width * factor; height = layer.height * factor }
  const angle = layer.rotation * Math.PI / 180, dx = (width - layer.width) / 2, dy = (height - layer.height) / 2
  return { ...layer, width, height, x: layer.x + Math.cos(angle) * dx - Math.sin(angle) * dy - dx, y: layer.y + Math.sin(angle) * dx + Math.cos(angle) * dy - dy }
}
export function cropProject<T extends { width: number; height: number; layers: PhotoLayer[] }>(project: T, start: Point, end: Point): T {
  const x = clamp(Math.round(Math.min(start.x, end.x)), 0, project.width - 1)
  const y = clamp(Math.round(Math.min(start.y, end.y)), 0, project.height - 1)
  const width = clamp(Math.round(Math.abs(end.x - start.x)), 1, project.width - x)
  const height = clamp(Math.round(Math.abs(end.y - start.y)), 1, project.height - y)
  return { ...project, width, height, layers: project.layers.map(layer => ({ ...layer, x: layer.x - x, y: layer.y - y })) }
}
