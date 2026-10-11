import { describe, expect, it } from 'vitest'
import { applyBrush, eraseSelection, fillSelection, parseRasterColor, selectColor, sharpenPixels, type BrushOptions } from './raster'
import { dilateAlpha, photoEffectBounds } from './renderer'
import { newPhotoLayer } from './types'

function bitmap(width: number, colors: number[][]): ImageData {
  return { width, height: colors.length / width, data: new Uint8ClampedArray(colors.flat()), colorSpace: 'srgb' } as ImageData
}
const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], clear = [0, 0, 0, 0]
function memoryCanvas(image: ImageData) {
  const ctx = {
    getImageData: (left: number, top: number, width: number, height: number) => {
      const result = bitmap(width, Array.from({ length: width * height }, () => [0, 0, 0, 0]))
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result.data.set(image.data.subarray(((y + top) * image.width + x + left) * 4, ((y + top) * image.width + x + left) * 4 + 4), (y * width + x) * 4)
      return result
    },
    putImageData: (source: ImageData, left: number, top: number) => {
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) image.data.set(source.data.subarray((y * source.width + x) * 4, (y * source.width + x) * 4 + 4), ((y + top) * image.width + x + left) * 4)
    },
  }
  return { width: image.width, height: image.height, getContext: () => ctx } as unknown as HTMLCanvasElement
}
const brush = (overrides: Partial<BrushOptions> = {}): BrushOptions => ({ mode: 'brush', from: { x: 1.5, y: 0.5 }, to: { x: 1.5, y: 0.5 }, size: 1, hardness: 1, opacity: 1, color: '#ff0000', ...overrides })

describe('photo color selection', () => {
  it('stops at a color boundary and does not select disconnected matching pixels', () => {
    const image = bitmap(3, [red, blue, red, red, blue, blue])
    expect([...selectColor(image, 0, 0, 0)]).toEqual([255, 0, 0, 255, 0, 0])
    expect([...selectColor(image, 0, 0, 0, false)]).toEqual([255, 0, 255, 255, 0, 0])
  })
  it('respects alpha and tolerance, and handles invalid positions', () => {
    const image = bitmap(3, [red, [250, 2, 0, 255], [255, 0, 0, 0]])
    expect([...selectColor(image, 0, 0, 5)]).toEqual([255, 255, 0])
    expect([...selectColor(image, -1, 0)]).toEqual([0, 0, 0])
    expect([...selectColor(bitmap(2, [clear, [255, 255, 255, 0]]), 0, 0, 0)]).toEqual([255, 255])
  })
  it('fills only selected pixels with correct source-over opacity', () => {
    const image = bitmap(3, [red, blue, clear])
    fillSelection(image, new Uint8Array([255, 0, 255]), '#00ff00', 0.5)
    expect([...image.data]).toEqual([128, 128, 0, 255, ...blue, 0, 255, 0, 128])
  })
  it('erases alpha without destroying the underlying color channels', () => {
    const image = bitmap(2, [red, blue])
    eraseSelection(image, new Uint8Array([255, 0]), 0.5)
    expect([...image.data]).toEqual([255, 0, 0, 128, ...blue])
  })
  it('parses supported color formats including explicit transparency', () => {
    expect(parseRasterColor('#f08')).toEqual([255, 0, 136, 255])
    expect(parseRasterColor('#abcdef80')).toEqual([171, 205, 239, 128])
    expect(parseRasterColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 127.5])
    expect(parseRasterColor('transparent')).toEqual([0, 0, 0, 0])
  })
})

describe('photo pixel effects', () => {
  it('sharpens contrast while preserving alpha and the original input', () => {
    const data = new Uint8ClampedArray([80, 80, 80, 255, 160, 160, 160, 120, 80, 80, 80, 255])
    const output = sharpenPixels(data, 3, 1, 1)
    expect(output[4]).toBe(200)
    expect(output[7]).toBe(120)
    expect(data[4]).toBe(160)
  })
  it('does not darken the edge of a cutout against transparent black', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0, 180, 90, 30, 255, 0, 0, 0, 0])
    expect([...sharpenPixels(data, 3, 1, 2)]).toEqual([...data])
  })
  it('expands the outer contour with a circular rather than square footprint', () => {
    const alpha = new Uint8Array(25); alpha[12] = 255
    const result = dilateAlpha(alpha, 5, 5, 1)
    expect(result[12]).toBe(255)
    expect(result[11]).toBe(128)
    expect(result[7]).toBe(128)
    expect(result[6]).toBeLessThan(result[7])
    expect(result[0]).toBe(0)
  })
  it('leaves a fully transparent image transparent and zero-radius masks unchanged', () => {
    expect([...dilateAlpha(new Uint8Array(9), 3, 3, 2)]).toEqual(new Array(9).fill(0))
    const alpha = new Uint8Array([0, 64, 255])
    expect([...dilateAlpha(alpha, 3, 1, 0)]).toEqual([...alpha])
  })
  it('matches a brute-force distance calculation across separated contour seeds', () => {
    const width = 7, height = 6, seeds = [2, 17, 31], alpha = new Uint8Array(width * height)
    seeds.forEach(index => { alpha[index] = 255 })
    const result = dilateAlpha(alpha, width, height, 2)
    for (let index = 0; index < alpha.length; index++) {
      const distance = Math.min(...seeds.map(seed => Math.hypot(index % width - seed % width, Math.floor(index / width) - Math.floor(seed / width))))
      expect(result[index]).toBe(Math.round(Math.min(1, Math.max(0, 2.5 - distance)) * 255))
    }
  })
  it('bounds a large shadow to its own direction without inflating every edge', () => {
    const layer = newPhotoLayer('image')
    layer.shadow = { enabled: true, color: '#000000', opacity: 1, blur: 0, offsetX: 4096, offsetY: 0 }
    expect(photoEffectBounds(layer)).toEqual({ left: 2, top: 2, right: 258, bottom: 2 })
  })
  it('bounds malformed large effect values before allocating offscreen canvases', () => {
    const layer = newPhotoLayer('image')
    layer.shadow = { enabled: true, color: '#000000', opacity: 1, blur: 10000, offsetX: 10000, offsetY: -10000 }
    layer.glow = { enabled: true, color: '#ffffff', opacity: 1, blur: 10000 }
    layer.effects.blur = 10000; layer.effects.depth = 10000
    const bounds = photoEffectBounds(layer)
    expect(Math.max(...Object.values(bounds))).toBeLessThanOrEqual(558)
    expect(bounds.left + bounds.right).toBeLessThanOrEqual(860)
    expect(bounds.top + bounds.bottom).toBeLessThanOrEqual(860)
  })
})

describe('raster painting tools', () => {
  it('paints a one-pixel brush with opacity and respects a selection', () => {
    const image = bitmap(3, [clear, clear, clear]), canvas = memoryCanvas(image)
    applyBrush(canvas, brush({ opacity: 0.5, mask: new Uint8Array([0, 255, 0]) }))
    expect([...image.data]).toEqual([...clear, 255, 0, 0, 128, ...clear])
  })
  it('erases only the brush area', () => {
    const image = bitmap(3, [red, red, red])
    applyBrush(memoryCanvas(image), brush({ mode: 'erase', opacity: 0.5 }))
    expect([...image.data]).toEqual([...red, 255, 0, 0, 128, ...red])
  })
  it('clones the anchored source rather than the last painted target', () => {
    const target = bitmap(3, [red, red, red]), source = memoryCanvas(bitmap(3, [blue, red, red]))
    applyBrush(memoryCanvas(target), brush({ mode: 'clone', sourceCanvas: source, sourceOffset: { x: -1, y: 0 } }))
    expect([...target.data]).toEqual([...red, ...blue, ...red])
  })
  it('applies blur and sharpening locally inside a selection', () => {
    const image = bitmap(3, [[80, 80, 80, 255], [160, 160, 160, 255], [80, 80, 80, 255]])
    applyBrush(memoryCanvas(image), brush({ mode: 'sharpen', mask: new Uint8Array([0, 255, 0]) }))
    expect(image.data[0]).toBe(80); expect(image.data[4]).toBeGreaterThan(160)
    const sharp = image.data[4]
    applyBrush(memoryCanvas(image), brush({ mode: 'blur', mask: new Uint8Array([0, 255, 0]) }))
    expect(image.data[0]).toBe(80); expect(image.data[4]).toBeLessThan(sharp); expect(image.data[7]).toBe(255)
  })
})
