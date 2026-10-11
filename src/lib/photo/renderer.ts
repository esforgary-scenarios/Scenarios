import type { ImageAsset } from '../../types'
import { PHOTO_MAX_SIZE, type PhotoLayer, type PhotoPaint, type PhotoProject } from './types'
import { sharpenPixels } from './raster'

const images = new Map<string, Promise<HTMLImageElement>>()
const renderTickets = new WeakMap<HTMLCanvasElement, number>()
const styledCache = new Map<string, { canvas: HTMLCanvasElement; source: HTMLCanvasElement; left: number; top: number }>()
let styledCachePixels = 0
let watchesFonts = false
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function clearPhotoRenderCache() { styledCache.clear(); styledCachePixels = 0 }

function canvas(width: number, height: number) {
  const result = document.createElement('canvas')
  result.width = Math.max(1, Math.ceil(width)); result.height = Math.max(1, Math.ceil(height))
  return result
}
function context(target: HTMLCanvasElement) {
  const result = target.getContext('2d', { willReadFrequently: true })
  if (!result) throw new Error('Браузер не смог создать холст фоторедактора.')
  result.imageSmoothingQuality = 'high'
  return result
}

export function loadPhotoImage(url: string): Promise<HTMLImageElement> {
  const existing = images.get(url)
  if (existing) return existing
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => { images.delete(url); reject(new Error('Не удалось загрузить изображение. Сайт может запрещать редактирование по ссылке — загрузите файл или вставьте саму картинку.')) }
    image.src = url
  })
  images.set(url, pending)
  // Decoded bitmaps can be large. Keep a small working set, not the whole account.
  if (images.size > 24) images.delete(images.keys().next().value!)
  return pending
}

function paintStyle(ctx: CanvasRenderingContext2D, paint: PhotoPaint, width: number, height: number, offset = 0) {
  if (paint.type === 'solid') return paint.color
  const angle = paint.angle * Math.PI / 180, dx = Math.cos(angle), dy = Math.sin(angle), extent = Math.abs(width * dx) / 2 + Math.abs(height * dy) / 2
  const gradient = ctx.createLinearGradient(offset + width / 2 - dx * extent, offset + height / 2 - dy * extent, offset + width / 2 + dx * extent, offset + height / 2 + dy * extent)
  gradient.addColorStop(0, paint.color); gradient.addColorStop(1, paint.color2)
  return gradient
}

function drawText(ctx: CanvasRenderingContext2D, layer: PhotoLayer) {
  const fontSize = Math.max(1, layer.fontSize), spacing = layer.letterSpacing
  ctx.font = `${layer.fontStyle} ${layer.fontWeight} ${fontSize}px "${layer.fontFamily.replace(/["\\\r\n]/g, '')}"`
  ctx.textBaseline = 'top'
  const widthOf = (text: string) => ctx.measureText(text).width + Math.max(0, [...text].length - 1) * spacing
  const lines: string[] = []
  for (const paragraph of layer.text.split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && widthOf(line + word) > layer.width) { lines.push(line.trimEnd()); line = word.trimStart() }
      else line += word
    }
    lines.push(line)
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], width = widthOf(line), y = index * fontSize * layer.lineHeight
    let x = layer.textAlign === 'right' ? layer.width - width : layer.textAlign === 'center' ? (layer.width - width) / 2 : 0
    if (!spacing) ctx.fillText(line, x, y)
    else for (const letter of line) { ctx.fillText(letter, x, y); x += ctx.measureText(letter).width + spacing }
  }
}

function drawShape(ctx: CanvasRenderingContext2D, layer: PhotoLayer) {
  const { width, height } = layer
  ctx.beginPath()
  if (layer.kind === 'rect') ctx.rect(0, 0, width, height)
  else if (layer.kind === 'ellipse') ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
  else {
    const points = layer.points.map(point => ({ x: point.x * width, y: point.y * height }))
    if (!points.length) return
    ctx.moveTo(points[0].x, points[0].y)
    if (layer.smooth && points.length > 2) {
      const count = points.length, total = layer.closed ? count : count - 1
      for (let index = 0; index < total; index++) {
        const p0 = points[layer.closed ? (index - 1 + count) % count : Math.max(0, index - 1)], p1 = points[index], p2 = points[(index + 1) % count], p3 = points[layer.closed ? (index + 2) % count : Math.min(count - 1, index + 2)]
        ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y)
      }
    } else for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
    if (layer.closed || layer.kind === 'polygon') ctx.closePath()
    else { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, layer.stroke.width); ctx.stroke(); return }
  }
  ctx.fill()
}

/** Source pixels at layer dimensions, excluding transform, outline and all effects. */
export async function renderLayerSource(layer: PhotoLayer, assets: ImageAsset[], withFill = false): Promise<HTMLCanvasElement> {
  const result = canvas(clamp(layer.width, 1, PHOTO_MAX_SIZE), clamp(layer.height, 1, PHOTO_MAX_SIZE)), ctx = context(result)
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'
  if (layer.kind === 'image') {
    const asset = assets.find(candidate => candidate.id === layer.imageId)
    if (!asset) throw new Error(`Исходник слоя «${layer.name}» не найден.`)
    const image = await loadPhotoImage(asset.url)
    ctx.drawImage(image, 0, 0, result.width, result.height)
  } else if (layer.kind === 'text') {
    if (document.fonts) await document.fonts.load(`${layer.fontStyle} ${layer.fontWeight} ${Math.max(1, layer.fontSize)}px "${layer.fontFamily.replace(/["\\\r\n]/g, '')}"`, layer.text.slice(0, 100))
    drawText(ctx, layer)
  }
  else drawShape(ctx, layer)
  const paint = layer.kind === 'path' && !layer.closed ? layer.stroke : layer.fill
  if (withFill && paint.enabled) {
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = paintStyle(ctx, paint, result.width, result.height); ctx.fillRect(0, 0, result.width, result.height); ctx.globalCompositeOperation = 'source-over'
  }
  return result
}

/** Euclidean distance transform gives an outside contour, including interior holes. */
export function dilateAlpha(alpha: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(alpha.length)
  if (radius <= 0) { output.set(alpha); return output }
  const size = Math.max(width, height), field = new Float32Array(width * height), input = new Float64Array(size), distance = new Float64Array(size), vertices = new Int32Array(size), boundaries = new Float64Array(size + 1), infinity = 1e12
  const transform = (length: number) => {
    let last = 0; vertices[0] = 0; boundaries[0] = -Infinity; boundaries[1] = Infinity
    for (let q = 1; q < length; q++) {
      let intersection = ((input[q] + q * q) - (input[vertices[last]] + vertices[last] * vertices[last])) / (2 * q - 2 * vertices[last])
      while (intersection <= boundaries[last] && last > 0) { last--; intersection = ((input[q] + q * q) - (input[vertices[last]] + vertices[last] * vertices[last])) / (2 * q - 2 * vertices[last]) }
      last++; vertices[last] = q; boundaries[last] = intersection; boundaries[last + 1] = Infinity
    }
    last = 0
    for (let q = 0; q < length; q++) { while (boundaries[last + 1] < q) last++; distance[q] = (q - vertices[last]) ** 2 + input[vertices[last]] }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) input[x] = alpha[y * width + x] ? 0 : infinity
    transform(width)
    for (let x = 0; x < width; x++) field[y * width + x] = distance[x]
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) input[y] = field[y * width + x]
    transform(height)
    for (let y = 0; y < height; y++) output[y * width + x] = Math.round(clamp(radius + 0.5 - Math.sqrt(distance[y]), 0, 1) * 255)
  }
  return output
}

function silhouette(source: HTMLCanvasElement, color: string) {
  const result = canvas(source.width, source.height), ctx = context(result)
  ctx.drawImage(source, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color; ctx.fillRect(0, 0, result.width, result.height)
  return result
}

function outline(source: HTMLCanvasElement, layer: PhotoLayer, padding: number) {
  const result = canvas(source.width + padding * 2, source.height + padding * 2), ctx = context(result)
  // Bound distance-transform arrays on 4K layers; retain the full-resolution face.
  const scale = Math.min(1, Math.sqrt(2_000_000 / (result.width * result.height)))
  const sample = canvas(result.width * scale, result.height * scale), sampleContext = context(sample)
  sampleContext.drawImage(source, padding * scale, padding * scale, source.width * scale, source.height * scale)
  const image = sampleContext.getImageData(0, 0, sample.width, sample.height), alpha = new Uint8Array(sample.width * sample.height)
  for (let index = 0; index < alpha.length; index++) alpha[index] = image.data[index * 4 + 3]
  const dilated = dilateAlpha(alpha, sample.width, sample.height, layer.stroke.width * scale)
  for (let index = 0; index < dilated.length; index++) { image.data[index * 4] = 255; image.data[index * 4 + 1] = 255; image.data[index * 4 + 2] = 255; image.data[index * 4 + 3] = dilated[index] }
  sampleContext.putImageData(image, 0, 0); ctx.drawImage(sample, 0, 0, result.width, result.height)
  ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(source, padding, padding)
  ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = paintStyle(ctx, layer.stroke, source.width, source.height, padding); ctx.fillRect(0, 0, result.width, result.height)
  return result
}

async function styledLayer(layer: PhotoLayer, assets: ImageAsset[], sourceOverride?: HTMLCanvasElement) {
  layer = { ...layer, stroke: { ...layer.stroke, width: clamp(layer.stroke.width, 0, 100) }, shadow: { ...layer.shadow, blur: clamp(layer.shadow.blur, 0, 100), offsetX: clamp(layer.shadow.offsetX, -256, 256), offsetY: clamp(layer.shadow.offsetY, -256, 256) }, glow: { ...layer.glow, blur: clamp(layer.glow.blur, 0, 100) }, effects: { ...layer.effects, blur: clamp(layer.effects.blur, 0, 50), depth: clamp(layer.effects.depth, 0, 100) } }
  const { x: _x, y: _y, rotation: _rotation, flipX: _flipX, flipY: _flipY, opacity: _opacity, blendMode: _blend, visible: _visible, locked: _locked, groupId: _group, id: _id, name: _name, clipToBelow: _clip, ...appearance } = layer
  const key = JSON.stringify([appearance, assets.find(asset => asset.id === layer.imageId)?.url, layer.kind === 'text' ? document.fonts?.status : ''])
  const cached = sourceOverride ? undefined : styledCache.get(key)
  if (cached) { styledCache.delete(key); styledCache.set(key, cached); return cached }
  const source = sourceOverride ?? await renderLayerSource(layer, assets), effects = layer.effects
  const { left, top, right, bottom } = photoEffectBounds(layer)
  const result = canvas(source.width + left + right, source.height + top + bottom), ctx = context(result)
  if (layer.shadow.enabled && layer.shadow.opacity > 0) {
    const shadow = silhouette(source, layer.shadow.color)
    ctx.save(); ctx.globalAlpha = clamp(layer.shadow.opacity, 0, 1); ctx.filter = `blur(${layer.shadow.blur}px)`; ctx.drawImage(shadow, left + layer.shadow.offsetX, top + layer.shadow.offsetY); ctx.restore()
  }
  if (layer.glow.enabled && layer.glow.opacity > 0) {
    const glow = silhouette(source, layer.glow.color)
    ctx.save(); ctx.globalAlpha = clamp(layer.glow.opacity, 0, 1); ctx.filter = `blur(${layer.glow.blur}px)`; ctx.drawImage(glow, left, top); ctx.restore()
  }
  if (effects.depth > 0) {
    const extruded = silhouette(source, effects.depthColor), radians = effects.depthAngle * Math.PI / 180, depth = Math.min(200, Math.ceil(effects.depth))
    for (let offset = depth; offset >= 1; offset--) ctx.drawImage(extruded, left + Math.cos(radians) * offset, top + Math.sin(radians) * offset)
  }
  const openPath = layer.kind === 'path' && !layer.closed
  if (!openPath && layer.stroke.enabled && layer.stroke.width > 0) { const outlinePadding = Math.ceil(layer.stroke.width) + 2; ctx.drawImage(outline(source, layer, outlinePadding), left - outlinePadding, top - outlinePadding) }
  const face = canvas(source.width, source.height), faceContext = context(face)
  faceContext.drawImage(source, 0, 0)
  const facePaint = openPath ? layer.stroke : layer.fill
  if (facePaint.enabled) {
    faceContext.globalCompositeOperation = 'source-in'; faceContext.fillStyle = paintStyle(faceContext, facePaint, face.width, face.height); faceContext.fillRect(0, 0, face.width, face.height); faceContext.globalCompositeOperation = 'source-over'
  } else if (layer.kind !== 'image') faceContext.clearRect(0, 0, face.width, face.height)
  if (effects.sharpness > 0) {
    const image = faceContext.getImageData(0, 0, face.width, face.height)
    image.data.set(sharpenPixels(image.data, image.width, image.height, effects.sharpness / 100 * 3)); faceContext.putImageData(image, 0, 0)
  }
  ctx.save(); ctx.filter = `brightness(${effects.brightness}%) contrast(${effects.contrast}%) saturate(${effects.saturation}%) hue-rotate(${effects.hue}deg) blur(${effects.blur}px)`; ctx.drawImage(face, left, top); ctx.restore()
  const styled = { canvas: result, source, left, top }, pixels = result.width * result.height + source.width * source.height
  if (!sourceOverride && pixels <= 20_000_000) {
    const previous = styledCache.get(key)
    if (previous) { styledCachePixels -= previous.canvas.width * previous.canvas.height + previous.source.width * previous.source.height; styledCache.delete(key) }
    while (styledCachePixels + pixels > 20_000_000 && styledCache.size) {
      const oldestKey = styledCache.keys().next().value!, oldest = styledCache.get(oldestKey)!
      styledCachePixels -= oldest.canvas.width * oldest.canvas.height + oldest.source.width * oldest.source.height
      styledCache.delete(oldestKey)
    }
    styledCache.set(key, styled); styledCachePixels += pixels
  }
  return styled
}

export function photoEffectBounds(layer: PhotoLayer) {
  const common = Math.max(layer.stroke.enabled ? clamp(layer.stroke.width, 0, 100) + 2 : 0, layer.glow.enabled ? clamp(layer.glow.blur, 0, 100) * 3 : 0, clamp(layer.effects.blur, 0, 50) * 3)
  const shadow = layer.shadow.enabled ? clamp(layer.shadow.blur, 0, 100) * 3 : 0, sx = layer.shadow.enabled ? clamp(layer.shadow.offsetX, -256, 256) : 0, sy = layer.shadow.enabled ? clamp(layer.shadow.offsetY, -256, 256) : 0
  const depth = clamp(layer.effects.depth, 0, 100), angle = layer.effects.depthAngle * Math.PI / 180, dx = Math.cos(angle) * depth, dy = Math.sin(angle) * depth
  return { left: Math.ceil(Math.max(common, shadow - sx, -dx, 0)) + 2, right: Math.ceil(Math.max(common, shadow + sx, dx, 0)) + 2, top: Math.ceil(Math.max(common, shadow - sy, -dy, 0)) + 2, bottom: Math.ceil(Math.max(common, shadow + sy, dy, 0)) + 2 }
}

function drawTransformed(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, layer: PhotoLayer, left = 0, top = left) {
  ctx.save(); ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2); ctx.rotate(layer.rotation * Math.PI / 180); ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1); ctx.drawImage(image, -layer.width / 2 - left, -layer.height / 2 - top); ctx.restore()
}

export async function renderProject(project: PhotoProject, targetCanvas: HTMLCanvasElement, options: { onlyIds?: string[]; transparent?: boolean; layerSources?: Map<string, HTMLCanvasElement> } = {}): Promise<void> {
  if (!watchesFonts && document.fonts) { document.fonts.addEventListener('loadingdone', clearPhotoRenderCache); watchesFonts = true }
  const ticket = (renderTickets.get(targetCanvas) ?? 0) + 1
  renderTickets.set(targetCanvas, ticket)
  const width = clamp(project.width, 1, PHOTO_MAX_SIZE), height = clamp(project.height, 1, PHOTO_MAX_SIZE), rendered = canvas(width, height), ctx = context(rendered), scratch = canvas(width, height), scratchContext = context(scratch), baseMask = canvas(width, height), maskContext = context(baseMask)
  if (!options.transparent && project.background !== 'transparent') { ctx.fillStyle = project.background; ctx.fillRect(0, 0, width, height) }
  let hasBase = false
  for (const layer of project.layers) {
    if (renderTickets.get(targetCanvas) !== ticket) return
    if (!layer.clipToBelow) { maskContext.clearRect(0, 0, width, height); hasBase = false }
    if (!layer.visible) continue
    const included = !options.onlyIds || options.onlyIds.includes(layer.id)
    // Preserve a clipping base even when exporting only the layers above it.
    if (!included && !layer.clipToBelow) {
      const source = options.layerSources?.get(layer.id) ?? await renderLayerSource(layer, project.assets)
      maskContext.globalAlpha = clamp(layer.opacity, 0, 1); drawTransformed(maskContext, source, layer); maskContext.globalAlpha = 1; hasBase = true
      continue
    }
    if (!included) continue
    const styled = await styledLayer(layer, project.assets, options.layerSources?.get(layer.id))
    scratchContext.clearRect(0, 0, width, height)
    drawTransformed(scratchContext, styled.canvas, layer, styled.left, styled.top)
    if (layer.clipToBelow) {
      if (!hasBase) continue
      scratchContext.globalCompositeOperation = 'destination-in'; scratchContext.drawImage(baseMask, 0, 0); scratchContext.globalCompositeOperation = 'source-over'
    } else {
      maskContext.globalAlpha = clamp(layer.opacity, 0, 1); drawTransformed(maskContext, styled.source, layer); maskContext.globalAlpha = 1; hasBase = true
    }
    ctx.globalAlpha = clamp(layer.opacity, 0, 1); ctx.globalCompositeOperation = layer.blendMode; ctx.drawImage(scratch, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
  }
  if (renderTickets.get(targetCanvas) !== ticket) return
  targetCanvas.width = rendered.width; targetCanvas.height = rendered.height
  context(targetCanvas).drawImage(rendered, 0, 0)
}

export function canvasBlob(target: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { target.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось сохранить PNG. Попробуйте уменьшить размер холста.')), 'image/png') }
    catch { reject(new Error('Изображение по ссылке запрещает экспорт. Загрузите его файлом или вставьте картинку из буфера.')) }
  })
}
