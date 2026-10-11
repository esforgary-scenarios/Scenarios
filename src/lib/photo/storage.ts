import { newPhotoLayer, PHOTO_MAX_SIZE, type PhotoFont, type PhotoLayer, type PhotoPaint, type PhotoProject } from './types'

const ERROR = 'Не удалось прочитать фоторедактор: неверный формат данных.'
const BLENDS: GlobalCompositeOperation[] = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'destination-in', 'destination-out', 'source-atop', 'source-in', 'source-out', 'destination-over', 'destination-atop', 'copy', 'xor', 'lighter']
const KINDS: PhotoLayer['kind'][] = ['image', 'text', 'rect', 'ellipse', 'polygon', 'path']
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(ERROR); return value as Record<string, unknown> }
const text = (value: unknown, max = 200): string => { if (typeof value !== 'string' || value.length > max) throw new Error(ERROR); return value }
const number = (value: unknown, min: number, max: number): number => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(ERROR); return value }
const boolean = (value: unknown): boolean => { if (typeof value !== 'boolean') throw new Error(ERROR); return value }
const choice = <T extends string>(value: unknown, choices: readonly T[]): T => { if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(ERROR); return value as T }
const color = (value: unknown): string => { if (typeof value !== 'string' || !/^(?:transparent|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/i.test(value)) throw new Error(ERROR); return value }
function paint(value: unknown): PhotoPaint {
  const item = object(value)
  return { enabled: boolean(item.enabled), type: choice(item.type, ['solid', 'linear']), color: color(item.color), color2: color(item.color2), angle: number(item.angle, -3600, 3600) }
}

function layer(value: unknown): PhotoLayer {
  const item = object(value)
  const kind = choice(item.kind, KINDS)
  const base = newPhotoLayer(kind)
  const input = { ...base, ...item }
  const shadow = object(input.shadow), glow = object(input.glow), effects = object(input.effects)
  if (!Array.isArray(input.points) || input.points.length > 4096) throw new Error(ERROR)
  const id = text(item.id, 200)
  if (!id) throw new Error(ERROR)
  return {
    id, name: text(input.name, 500), kind, visible: boolean(input.visible), locked: boolean(input.locked),
    ...(input.groupId === undefined ? {} : { groupId: text(input.groupId, 200) }),
    x: number(input.x, -65536, 65536), y: number(input.y, -65536, 65536), width: number(input.width, 1, PHOTO_MAX_SIZE), height: number(input.height, 1, PHOTO_MAX_SIZE),
    rotation: number(input.rotation, -360000, 360000), opacity: number(input.opacity, 0, 1), blendMode: choice(input.blendMode, BLENDS),
    flipX: boolean(input.flipX), flipY: boolean(input.flipY), clipToBelow: boolean(input.clipToBelow),
    ...(input.imageId === undefined ? {} : { imageId: text(input.imageId, 200) }),
    text: text(input.text, 100000), fontFamily: text(input.fontFamily, 200), fontSize: number(input.fontSize, 1, 2048), fontWeight: number(input.fontWeight, 1, 1000),
    fontStyle: choice(input.fontStyle, ['normal', 'italic']), textAlign: choice(input.textAlign, ['left', 'center', 'right']), letterSpacing: number(input.letterSpacing, -200, 1000), lineHeight: number(input.lineHeight, 0.1, 10),
    fill: paint(input.fill), stroke: { ...paint(input.stroke), width: number(object(input.stroke).width, 0, 256) },
    shadow: { enabled: boolean(shadow.enabled), color: color(shadow.color), opacity: number(shadow.opacity, 0, 1), blur: number(shadow.blur, 0, 256), offsetX: number(shadow.offsetX, -4096, 4096), offsetY: number(shadow.offsetY, -4096, 4096) },
    glow: { enabled: boolean(glow.enabled), color: color(glow.color), opacity: number(glow.opacity, 0, 1), blur: number(glow.blur, 0, 256) },
    effects: { brightness: number(effects.brightness, 0, 1000), contrast: number(effects.contrast, 0, 1000), saturation: number(effects.saturation, 0, 1000), hue: number(effects.hue, -3600, 3600), blur: number(effects.blur, 0, 256), sharpness: number(effects.sharpness, 0, 100), depth: number(effects.depth, 0, 256), depthAngle: number(effects.depthAngle, -3600, 3600), depthColor: color(effects.depthColor) },
    points: input.points.map(point => { const p = object(point); return { x: number(p.x, -100, 100), y: number(p.y, -100, 100) } }), closed: boolean(input.closed), smooth: boolean(input.smooth),
  }
}

export type StoredPhotoProject<T> = Omit<PhotoProject, 'assets'> & { assets: T[] }

/** Snapshot validation is shared by cloud loading and saving; no binary URLs are retained. */
export function parsePhotoProject<T extends { id: string }>(value: unknown, readAsset: (value: unknown) => T): StoredPhotoProject<T> | undefined {
  if (value === undefined) return undefined
  const item = object(value)
  if (item.version !== 1 || !Array.isArray(item.layers) || item.layers.length > 200 || !Array.isArray(item.assets) || item.assets.length > 1000) throw new Error(ERROR)
  const layers = item.layers.map(layer), assets = item.assets.map(readAsset)
  if (new Set(layers.map(item => item.id)).size !== layers.length || new Set(assets.map(item => item.id)).size !== assets.length) throw new Error(ERROR)
  const assetIds = new Set(assets.map(item => item.id))
  if (layers.some(item => item.kind === 'image' && (!item.imageId || !assetIds.has(item.imageId)))) throw new Error(ERROR)
  return { version: 1, width: number(item.width, 1, PHOTO_MAX_SIZE), height: number(item.height, 1, PHOTO_MAX_SIZE), background: color(item.background), layers, assets }
}

export function parseStoredFonts(value: unknown): PhotoFont[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 200) throw new Error('Неверный формат коллекции шрифтов.')
  const fonts = value.map(item => {
    const font = object(item), id = text(font.id), family = text(font.family), cssUrl = text(font.cssUrl, 4000)
    let url: URL
    try { url = new URL(cssUrl) } catch { throw new Error('Некорректная ссылка Google Fonts.') }
    if (!id || !family.trim() || /[\u0000-\u001f\u007f{}<>]/.test(family) || url.protocol !== 'https:' || url.hostname !== 'fonts.googleapis.com' || url.port || url.username || url.password || !['/css', '/css2'].includes(url.pathname) || !url.searchParams.get('family')) throw new Error('Поддерживаются ссылки Google Fonts.')
    return { id, family, cssUrl: url.href }
  })
  if (new Set(fonts.map(font => font.id)).size !== fonts.length) throw new Error('В коллекции шрифтов повторяются идентификаторы.')
  return fonts
}
