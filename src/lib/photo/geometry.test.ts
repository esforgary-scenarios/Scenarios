import { describe, expect, it } from 'vitest'
import { localPoint, containsPoint, cropProject, resizePhotoLayer } from './geometry'
import { newPhotoLayer, newPhotoProject } from './types'
describe('photo geometry', () => {
  it('maps rotated and flipped layers back to bitmap pixels', () => {
    const layer = newPhotoLayer('image', { x: 10, y: 20, width: 100, height: 100, rotation: 90 })
    expect(localPoint(layer, { x: 110, y: 20 }).x).toBeCloseTo(0)
    expect(localPoint({ ...layer, flipX: true }, { x: 110, y: 20 }).x).toBeCloseTo(100)
    expect(containsPoint(layer, { x: 500, y: 300 })).toBe(false)
  })
  it('crop keeps visual placement by translating every layer', () => {
    const project = { ...newPhotoProject(), layers: [newPhotoLayer('text', { x: 60, y: 50 })] }
    const cropped = cropProject(project, { x: 20, y: 30 }, { x: 220, y: 130 })
    expect([cropped.width, cropped.height, cropped.layers[0].x, cropped.layers[0].y]).toEqual([200, 100, 40, 20])
    expect(project.layers[0].x).toBe(60)
  })
  it('resizing a flipped layer grows toward its unflipped handle', () => {
    const layer = newPhotoLayer('image', { x: 0, y: 0, width: 100, height: 100, flipX: true })
    expect(resizePhotoLayer(layer, { x: 100, y: 100 }, { x: 140, y: 120 }).width).toBe(140)
  })
  it('rotated resize leaves the top-left world point fixed', () => {
    const layer = newPhotoLayer('image', { x: 0, y: 0, width: 100, height: 100, rotation: 90 })
    const resized = resizePhotoLayer(layer, { x: 0, y: 100 }, { x: -20, y: 140 })
    expect([resized.width, resized.height]).toEqual([140, 120])
    expect(localPoint(resized, { x: 100, y: 0 }).x).toBeCloseTo(0)
    expect(localPoint(resized, { x: 100, y: 0 }).y).toBeCloseTo(0)
  })
})
