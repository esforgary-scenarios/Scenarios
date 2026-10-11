import type { ImageAsset } from '../../types'

export interface PhotoPaint { enabled: boolean; type: 'solid' | 'linear'; color: string; color2: string; angle: number }
export interface PhotoLayer {
  id: string; name: string; kind: 'image' | 'text' | 'rect' | 'ellipse' | 'polygon' | 'path'
  visible: boolean; locked: boolean; groupId?: string
  x: number; y: number; width: number; height: number; rotation: number; opacity: number
  blendMode: GlobalCompositeOperation; flipX: boolean; flipY: boolean; clipToBelow: boolean
  imageId?: string; text: string; fontFamily: string; fontSize: number; fontWeight: number
  fontStyle: 'normal' | 'italic'; textAlign: 'left' | 'center' | 'right'; letterSpacing: number; lineHeight: number
  fill: PhotoPaint; stroke: PhotoPaint & { width: number }
  shadow: { enabled: boolean; color: string; opacity: number; blur: number; offsetX: number; offsetY: number }
  glow: { enabled: boolean; color: string; opacity: number; blur: number }
  effects: { brightness: number; contrast: number; saturation: number; hue: number; blur: number; sharpness: number; depth: number; depthAngle: number; depthColor: string }
  points: { x: number; y: number }[]; closed: boolean; smooth: boolean
}
export interface PhotoProject { version: 1; width: number; height: number; background: string; layers: PhotoLayer[]; assets: ImageAsset[] }
export interface PhotoFont { id: string; family: string; cssUrl: string }
export const PHOTO_MAX_SIZE = 4096
export function newPhotoProject(): PhotoProject { return { version: 1, width: 1280, height: 720, background: 'transparent', layers: [], assets: [] } }
export function newPhotoLayer(kind: PhotoLayer['kind'], overrides: Partial<PhotoLayer> = {}): PhotoLayer {
  return {
    id: crypto.randomUUID(), name: ({ image: 'Изображение', text: 'Текст', rect: 'Прямоугольник', ellipse: 'Эллипс', polygon: 'Многоугольник', path: 'Кривая' })[kind], kind,
    visible: true, locked: false, x: 80, y: 80, width: 400, height: 240, rotation: 0, opacity: 1,
    blendMode: 'source-over', flipX: false, flipY: false, clipToBelow: false,
    text: 'Ваш текст', fontFamily: 'Arial', fontSize: 64, fontWeight: 700, fontStyle: 'normal', textAlign: 'left', letterSpacing: 0, lineHeight: 1.2,
    fill: { enabled: kind !== 'image', type: 'solid', color: '#ffffff', color2: '#58a6ff', angle: 90 },
    stroke: { enabled: false, type: 'solid', color: '#58a6ff', color2: '#d2a8ff', angle: 90, width: 6 },
    shadow: { enabled: false, color: '#000000', opacity: 0.6, blur: 16, offsetX: 8, offsetY: 8 },
    glow: { enabled: false, color: '#58a6ff', opacity: 0.8, blur: 20 },
    effects: { brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0, sharpness: 0, depth: 0, depthAngle: 45, depthColor: '#30363d' },
    points: [{ x: 0.5, y: 0 }, { x: 1, y: 0.38 }, { x: 0.8, y: 1 }, { x: 0.2, y: 1 }, { x: 0, y: 0.38 }], closed: true, smooth: false,
    ...overrides,
  }
}
