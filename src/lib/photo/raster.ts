export interface RasterPoint { x: number; y: number }
export interface BrushOptions {
  mode: 'brush' | 'erase' | 'clone' | 'blur' | 'sharpen'
  from: RasterPoint; to: RasterPoint; size: number; hardness: number; opacity: number; color: string
  sourceCanvas?: HTMLCanvasElement; sourceOffset?: RasterPoint; mask?: Uint8Array
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

/** Independent of canvas/DOM so saved masks and color operations are deterministic. */
export function parseRasterColor(value: string): [number, number, number, number] {
  const hex = value.replace(/^#/, '')
  if (/^[\da-f]{3,4}$/i.test(hex)) return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), hex[3] ? parseInt(hex[3] + hex[3], 16) : 255]
  if (/^[\da-f]{6}([\da-f]{2})?$/i.test(hex)) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255]
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 255 : clamp(+rgb[4]) * 255]
  return [0, 0, 0, value === 'transparent' ? 0 : 255]
}

/** Four-connected selection or a color range across the entire bitmap. */
export function selectColor(image: ImageData, x: number, y: number, tolerance = 32, contiguous = true): Uint8Array {
  const { data, width, height } = image
  const mask = new Uint8Array(width * height)
  x = Math.floor(x); y = Math.floor(y)
  if (x < 0 || y < 0 || x >= width || y >= height) return mask
  const start = y * width + x, sample = start * 4, limit = clamp(tolerance, 0, 255) ** 2 * 3
  const matches = (index: number) => {
    const offset = index * 4
    if (Math.abs(data[offset + 3] - data[sample + 3]) > tolerance) return false
    if (data[offset + 3] === 0 && data[sample + 3] === 0) return true
    return (data[offset] - data[sample]) ** 2 + (data[offset + 1] - data[sample + 1]) ** 2 + (data[offset + 2] - data[sample + 2]) ** 2 <= limit
  }
  if (!contiguous) {
    for (let index = 0; index < mask.length; index++) if (matches(index)) mask[index] = 255
    return mask
  }
  const queue = new Int32Array(width * height), visited = new Uint8Array(width * height)
  let head = 0, tail = 1
  queue[0] = start; visited[start] = 1
  const visit = (index: number) => {
    if (!visited[index]) { visited[index] = 1; if (matches(index)) queue[tail++] = index }
  }
  while (head < tail) {
    const index = queue[head++], column = index % width
    mask[index] = 255
    if (column > 0) visit(index - 1)
    if (column + 1 < width) visit(index + 1)
    if (index >= width) visit(index - width)
    if (index + width < mask.length) visit(index + width)
  }
  return mask
}

function sourceOver(data: Uint8ClampedArray, index: number, color: ArrayLike<number>, alpha: number) {
  const sourceAlpha = clamp(alpha) * color[3] / 255, oldAlpha = data[index + 3] / 255
  const resultAlpha = sourceAlpha + oldAlpha * (1 - sourceAlpha)
  for (let channel = 0; channel < 3; channel++) data[index + channel] = resultAlpha ? (color[channel] * sourceAlpha + data[index + channel] * oldAlpha * (1 - sourceAlpha)) / resultAlpha : 0
  data[index + 3] = resultAlpha * 255
}

export function fillSelection(image: ImageData, mask: Uint8Array, color: string, opacity = 1): void {
  const rgba = parseRasterColor(color)
  for (let index = 0; index < Math.min(mask.length, image.width * image.height); index++) if (mask[index]) sourceOver(image.data, index * 4, rgba, clamp(opacity) * mask[index] / 255)
}

export function eraseSelection(image: ImageData, mask: Uint8Array, opacity = 1): void {
  for (let index = 0; index < Math.min(mask.length, image.width * image.height); index++) image.data[index * 4 + 3] *= 1 - clamp(opacity) * mask[index] / 255
}

/** Unsharp convolution; untouched alpha avoids halos around transparent cutouts. */
export function sharpenPixels(data: Uint8ClampedArray, width: number, height: number, amount: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data), strength = clamp(amount, 0, 5)
  if (!strength) return output
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4
    if (!data[index + 3]) continue
    const neighbours = [Math.max(0, x - 1) + y * width, Math.min(width - 1, x + 1) + y * width, x + Math.max(0, y - 1) * width, x + Math.min(height - 1, y + 1) * width]
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0
      for (const neighbour of neighbours) sum += data[neighbour * 4 + 3] ? data[neighbour * 4 + channel] : data[index + channel]
      output[index + channel] = data[index + channel] + strength * (data[index + channel] - sum / 4)
    }
  }
  return output
}

/** One pointer segment. All modes respect the optional full-canvas selection mask. */
export function applyBrush(canvas: HTMLCanvasElement, options: BrushOptions): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Не удалось открыть изображение для рисования.')
  const radius = Math.max(0.5, options.size / 2), padding = options.mode === 'blur' || options.mode === 'sharpen' ? 2 : 0
  const left = Math.max(0, Math.floor(Math.min(options.from.x, options.to.x) - radius - padding)), top = Math.max(0, Math.floor(Math.min(options.from.y, options.to.y) - radius - padding))
  const right = Math.min(canvas.width, Math.ceil(Math.max(options.from.x, options.to.x) + radius + padding)), bottom = Math.min(canvas.height, Math.ceil(Math.max(options.from.y, options.to.y) + radius + padding))
  if (right <= left || bottom <= top) return
  const image = ctx.getImageData(left, top, right - left, bottom - top), original = new Uint8ClampedArray(image.data)
  const coverage = new Float32Array(image.width * image.height), distance = Math.hypot(options.to.x - options.from.x, options.to.y - options.from.y), steps = Math.max(1, Math.ceil(distance / Math.max(0.5, radius / 4)))
  const hardness = clamp(options.hardness), opacity = clamp(options.opacity), color = parseRasterColor(options.color)
  for (let step = 0; step <= steps; step++) {
    const cx = options.from.x + (options.to.x - options.from.x) * step / steps - left, cy = options.from.y + (options.to.y - options.from.y) * step / steps - top
    for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(image.height, Math.ceil(cy + radius)); y++) for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(image.width, Math.ceil(cx + radius)); x++) {
      const distanceFromCenter = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), normalized = distanceFromCenter / radius
      if (distanceFromCenter > radius + 0.5) continue
      const strength = hardness >= 0.999 ? clamp(radius + 0.5 - distanceFromCenter) : normalized <= hardness ? 1 : clamp((1 - normalized) / Math.max(0.001, 1 - hardness))
      const index = y * image.width + x
      coverage[index] = Math.max(coverage[index], strength)
    }
  }
  const clone = options.mode === 'clone' ? options.sourceCanvas?.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, options.sourceCanvas.width, options.sourceCanvas.height) : undefined
  const sharpened = options.mode === 'sharpen' ? sharpenPixels(original, image.width, image.height, 1.5) : undefined
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const pixel = y * image.width + x, index = pixel * 4, selected = options.mask ? options.mask[(y + top) * canvas.width + x + left] / 255 : 1
    const alpha = coverage[pixel] * opacity * selected
    if (!alpha) continue
    if (options.mode === 'erase') { image.data[index + 3] *= 1 - alpha; continue }
    if (options.mode === 'brush') { sourceOver(image.data, index, color, alpha); continue }
    if (options.mode === 'clone' && clone) {
      const sx = Math.round(x + left + (options.sourceOffset?.x ?? 0)), sy = Math.round(y + top + (options.sourceOffset?.y ?? 0))
      if (sx >= 0 && sy >= 0 && sx < clone.width && sy < clone.height) sourceOver(image.data, index, clone.data.subarray((sy * clone.width + sx) * 4, (sy * clone.width + sx) * 4 + 4), alpha)
      continue
    }
    if (options.mode === 'sharpen' && sharpened) {
      for (let channel = 0; channel < 3; channel++) image.data[index + channel] = original[index + channel] * (1 - alpha) + sharpened[index + channel] * alpha
    } else if (options.mode === 'blur') {
      let red = 0, green = 0, blue = 0, weightedAlpha = 0, samples = 0
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const sx = clamp(x + dx, 0, image.width - 1), sy = clamp(y + dy, 0, image.height - 1), source = (sy * image.width + sx) * 4, sampleAlpha = original[source + 3] / 255
        red += original[source] * sampleAlpha; green += original[source + 1] * sampleAlpha; blue += original[source + 2] * sampleAlpha; weightedAlpha += sampleAlpha; samples++
      }
      const blurred = [weightedAlpha ? red / weightedAlpha : 0, weightedAlpha ? green / weightedAlpha : 0, weightedAlpha ? blue / weightedAlpha : 0, weightedAlpha / samples * 255]
      for (let channel = 0; channel < 4; channel++) image.data[index + channel] = original[index + channel] * (1 - alpha) + blurred[channel] * alpha
    }
  }
  ctx.putImageData(image, left, top)
}
