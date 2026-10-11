import { describe, expect, it } from 'vitest'
import { collectDiscardedPhotoAssets, compactPhotoAssets } from './assets'
import { newPhotoLayer, newPhotoProject } from './types'

const first = { id: 'first', name: 'First', url: 'blob:first', path: 'user/first.png' }
const second = { id: 'second', name: 'Second', url: 'blob:second', path: 'user/second.png' }
const unused = { id: 'unused', name: 'Unused', url: 'blob:unused', path: 'user/unused.png' }
const imageLayer = (imageId: string) => newPhotoLayer('image', { id: 'layer', imageId })

describe('photo source lifecycle', () => {
  it('keeps an older raster source available for undo while pruning unrelated assets', () => {
    const previous = { ...newPhotoProject(), layers: [imageLayer(first.id)], assets: [first, unused] }
    const current = { ...previous, layers: [imageLayer(second.id)], assets: [first, second, unused] }
    const result = compactPhotoAssets(current, [previous])
    expect(result.assets).toEqual([first, second])
    expect(current.assets).toEqual([first, second, unused])
    expect(collectDiscardedPhotoAssets(current.assets, [result])).toEqual([unused])
  })

  it('protects sources needed only by redo and returns them for cleanup after redo is discarded', () => {
    const current = { ...newPhotoProject(), layers: [imageLayer(first.id)], assets: [first] }
    const redo = { ...current, layers: [imageLayer(second.id)], assets: [first, second] }
    const retained = compactPhotoAssets(current, [redo])
    expect(retained.assets).toEqual([first, second])
    const afterEdit = compactPhotoAssets(retained)
    expect(afterEdit.assets).toEqual([first])
    expect(collectDiscardedPhotoAssets(retained.assets, [afterEdit])).toEqual([second])
  })

  it('prunes loaded sources belonging to deleted layers when editor history ends', () => {
    const current = { ...newPhotoProject(), assets: [first, second, unused], layers: [] }
    const pruned = compactPhotoAssets(current)
    expect(pruned.assets).toEqual([])
    expect(collectDiscardedPhotoAssets(current.assets, [pruned])).toEqual([first, second, unused])
  })

  it('does not delete a shared private file under a different asset id and deduplicates cleanup', () => {
    const alias = { ...first, id: 'same-file', url: 'blob:refreshed' }
    const current = { ...newPhotoProject(), assets: [alias], layers: [imageLayer(alias.id)] }
    expect(collectDiscardedPhotoAssets([first, second, { ...second, id: 'second-alias' }], [current])).toEqual([second])
  })

  it('preserves referential identity when no compaction is necessary', () => {
    const current = { ...newPhotoProject(), assets: [first], layers: [imageLayer(first.id)] }
    expect(compactPhotoAssets(current)).toBe(current)
  })

  it('releases raster versions older than the retained undo window', () => {
    const versions = Array.from({ length: 35 }, (_, index) => ({ id: `image-${index}`, name: `Мазок ${index}`, url: `blob:${index}`, path: `user/${index}.png` }))
    const snapshots = versions.map(asset => ({ ...newPhotoProject(), layers: [imageLayer(asset.id)], assets: versions }))
    const current = snapshots.at(-1)!
    const history = snapshots.slice(-31, -1)
    const retained = compactPhotoAssets(current, history)
    expect(retained.assets).toEqual(versions.slice(4))
    expect(collectDiscardedPhotoAssets(versions, [retained])).toEqual(versions.slice(0, 4))
  })
})
