import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDown, ArrowUp, Brush, Check, Circle, Copy, Crop, Download, Droplets, Eraser, Eye, EyeOff, Folder, FolderOpen, ImagePlus, Images, Layers, LoaderCircle, LockKeyhole, Maximize2, Minimize2, MousePointer2, PaintBucket, PenTool, Pentagon, Pipette, Plus, Redo2, Scissors, Sparkles, Stamp, Trash2, Type, Undo2, UnlockKeyhole, WandSparkles, X, ZoomIn, ZoomOut, Square } from 'lucide-react'
import { Modal, IconButton } from './ui'
import { Presence } from './Presence'
import Select from './Select'
import PhotoInspector, { PhotoColor, PhotoNumber, PhotoRange, PhotoSection } from './PhotoInspector'
import { loadPhotoFonts } from '../lib/photo/fonts'
import { getClipboardImages } from '../lib/clipboardImages'
import { collectDiscardedPhotoAssets, compactPhotoAssets } from '../lib/photo/assets'
import { newPhotoLayer, newPhotoProject, PHOTO_MAX_SIZE, type PhotoFont, type PhotoLayer, type PhotoProject } from '../lib/photo/types'
import { clamp, containsPoint, cropProject, localPoint, resizePhotoLayer, type Point } from '../lib/photo/geometry'
import { canvasBlob, loadPhotoImage, renderLayerSource, renderProject } from '../lib/photo/renderer'
import { applyBrush, eraseSelection, fillSelection, selectColor, type BrushOptions } from '../lib/photo/raster'
import type { ImageAsset, WorkspaceRepository } from '../types'
import './photoEditor.css'

type Tool = 'move' | 'brush' | 'erase' | 'fill' | 'select' | 'eyedropper' | 'clone' | 'blur' | 'sharpen' | 'crop' | 'path'
type Gesture = { type: 'move' | 'resize' | 'rotate' | 'node' | 'crop'; start: Point; before: PhotoProject; ids: string[]; node?: number } | { type: 'raster'; before: PhotoProject; layer: PhotoLayer; canvas: HTMLCanvasElement; source: HTMLCanvasElement; previous: Point; offset?: Point }
type Props = { project?: PhotoProject; gallery: ImageAsset[]; fonts: PhotoFont[]; repository: WorkspaceRepository; onChange: (project: PhotoProject) => void; onFontsChange: (fonts: PhotoFont[]) => void; onExport: (image: ImageAsset) => void; onCleanup: (assets: ImageAsset[]) => Promise<void>; beforeLeaveRef?: { current: (() => boolean) | null }; active: boolean }
const tools: { id: Tool; name: string; icon: typeof Brush }[] = [
  { id: 'move', name: 'Перемещение · V', icon: MousePointer2 }, { id: 'crop', name: 'Кадрирование · C', icon: Crop },
  { id: 'select', name: 'Умное выделение по цвету · W', icon: WandSparkles }, { id: 'brush', name: 'Кисть · B', icon: Brush },
  { id: 'erase', name: 'Ластик · E', icon: Eraser }, { id: 'fill', name: 'Заливка · G', icon: PaintBucket },
  { id: 'eyedropper', name: 'Пипетка · I', icon: Pipette }, { id: 'clone', name: 'Штамп · S', icon: Stamp },
  { id: 'blur', name: 'Размытие · R', icon: Droplets }, { id: 'sharpen', name: 'Резкость · H', icon: Sparkles }, { id: 'path', name: 'Кривая · P', icon: PenTool },
]
const cloneCanvas = (canvas: HTMLCanvasElement) => { const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height; copy.getContext('2d')!.drawImage(canvas, 0, 0); return copy }
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'Не удалось выполнить действие.'

export default function PhotoEditor({ project: initial, gallery, fonts, repository, onChange, onFontsChange, onExport, onCleanup, beforeLeaveRef, active }: Props) {
  const [project, setProject] = useState<PhotoProject>(() => initial ?? newPhotoProject())
  const projectRef = useRef(project); projectRef.current = project
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const onCleanupRef = useRef(onCleanup); onCleanupRef.current = onCleanup
  const [selected, setSelected] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('move')
  const [zoom, setZoom] = useState(1)
  const [maximized, setMaximized] = useState(false)
  const [fit, setFit] = useState(0.5)
  const [busy, setBusyState] = useState('')
  const busyRef = useRef('')
  const setBusy = (message: string) => { busyRef.current = message; setBusyState(message) }
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [importing, setImporting] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [undo, setUndo] = useState<PhotoProject[]>([])
  const [redo, setRedo] = useState<PhotoProject[]>([])
  const undoRef = useRef<PhotoProject[]>([]), redoRef = useRef<PhotoProject[]>([])
  const [brushColor, setBrushColor] = useState('#58a6ff')
  const [brushSize, setBrushSize] = useState(32)
  const [brushOpacity, setBrushOpacity] = useState(1)
  const [hardness, setHardness] = useState(0.8)
  const [tolerance, setTolerance] = useState(32)
  const [contiguous, setContiguous] = useState(true)
  const [selection, setSelection] = useState<{ layerId: string; mask: Uint8Array; preview: string } | null>(null)
  const [crop, setCrop] = useState<{ start: Point; end: Point } | null>(null)
  const [pathPoints, setPathPoints] = useState<Point[]>([])
  const [cloneOrigin, setCloneOrigin] = useState<{ id: string; point: Point } | null>(null)
  const [renderTick, setRenderTick] = useState(0)
  const [draggedLayer, setDraggedLayer] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<SVGSVGElement>(null), viewport = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null)
  const gesture = useRef<Gesture | null>(null), rendering = useRef(0), coalesce = useRef({ key: '', time: 0 })
  const uploaded = useRef<ImageAsset[]>([]), mounted = useRef(true), pendingRaster = useRef(false)
  const knownAssets = useRef(new Map((initial?.assets ?? []).map(asset => [asset.path || asset.url, asset])))
  const releaseAfterLoad = useRef(false), cancelAfterLoad = useRef(false), moveAfterLoad = useRef<Point | null>(null)
  const strokeFrame = useRef<number | null>(null)
  const backgroundAbort = useRef<AbortController | null>(null)
  const primary = project.layers.find(layer => layer.id === selected[selected.length - 1])
  const scale = fit * zoom

  const cleanupAssets = useCallback((candidates: ImageAsset[], retained: PhotoProject) => {
    const discarded = collectDiscardedPhotoAssets(candidates, [retained])
    if (!discarded.length) return
    void onCleanupRef.current(discarded).then(() => {
      const deleted = new Set(discarded.map(asset => asset.path || asset.url))
      for (const asset of projectRef.current.assets) deleted.delete(asset.path || asset.url)
      deleted.forEach(key => knownAssets.current.delete(key))
      uploaded.current = uploaded.current.filter(asset => !deleted.has(asset.path || asset.url))
    }).catch(() => { /* Keep candidates for the next save or exit; failed saves must never delete sources. */ })
  }, [])
  const publish = useCallback((next: PhotoProject) => {
    if (!mounted.current) return
    next.assets.forEach(asset => knownAssets.current.set(asset.path || asset.url, asset))
    const retained = compactPhotoAssets(next, [...undoRef.current, ...redoRef.current])
    projectRef.current = retained; setProject(retained); onChangeRef.current(retained)
    cleanupAssets([...knownAssets.current.values()], retained)
  }, [cleanupAssets])
  const commit = useCallback((next: PhotoProject, before = projectRef.current, key = '') => {
    if (!mounted.current || next === before) return
    if (next.layers.length > 200) { setError('В одном проекте можно сохранить до 200 слоёв. Объедините часть слоёв перед добавлением.'); return }
    const now = Date.now()
    if (!key || coalesce.current.key !== key || now - coalesce.current.time > 700) { undoRef.current = [...undoRef.current.slice(-29), before]; setUndo(undoRef.current) }
    coalesce.current = { key, time: now }; redoRef.current = []; setRedo([]); publish(next)
  }, [publish])
  const patchLayer = (changes: Partial<PhotoLayer>, id = primary?.id) => {
    if (!id || busyRef.current || pendingRaster.current || gesture.current) return
    const current = projectRef.current
    commit({ ...current, layers: current.layers.map(layer => layer.id === id ? { ...layer, ...changes } : layer) }, current, `property-${id}-${Object.keys(changes).join()}`)
  }
  const run = async (message: string, action: () => Promise<void>) => {
    if (busyRef.current || pendingRaster.current || gesture.current) return
    setBusy(message); setError('')
    try { await action() } catch (cause) { setError(errorMessage(cause)) } finally { setBusy('') }
  }
  useEffect(() => {
    if (!beforeLeaveRef) return
    const leave = () => {
      if (busyRef.current || pendingRaster.current || gesture.current) return false
      undoRef.current = []; redoRef.current = []; setUndo([]); setRedo([])
      publish(compactPhotoAssets(projectRef.current))
      return true
    }
    beforeLeaveRef.current = leave
    return () => { if (beforeLeaveRef.current === leave) beforeLeaveRef.current = null }
  }, [beforeLeaveRef, publish])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // StrictMode briefly tears down mounted effects; only a real departure discards undo sources.
      queueMicrotask(() => {
        if (mounted.current) return
        const current = projectRef.current, compact = compactPhotoAssets(current)
        projectRef.current = compact
        if (compact !== current) onChangeRef.current(compact)
        cleanupAssets([...knownAssets.current.values(), ...uploaded.current], compact)
      })
    }
  }, [cleanupAssets])
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer) } }, [notice])
  useEffect(() => { let alive = true; void loadPhotoFonts(fonts).then(() => { if (alive) setRenderTick(t => t + 1) }).catch(cause => { if (alive) setError(errorMessage(cause)) }); return () => { alive = false } }, [fonts])
  useEffect(() => {
    const element = viewport.current; if (!element) return
    const resize = () => { if (element.clientWidth) setFit(Math.max(0.02, Math.min((element.clientWidth - 64) / project.width, Math.max(96, element.clientHeight - 96) / project.height, 1))) }
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); return () => observer.disconnect()
  }, [project.width, project.height, active])
  useEffect(() => {
    if (!active || !canvas.current) return
    const revision = ++rendering.current
    const timer = requestAnimationFrame(() => {
      const target = document.createElement('canvas')
      void renderProject(project, target).then(() => {
        if (revision !== rendering.current || !canvas.current) return
        canvas.current.width = target.width; canvas.current.height = target.height
        canvas.current.getContext('2d')!.drawImage(target, 0, 0)
      }).catch(cause => { if (revision === rendering.current) setError(errorMessage(cause)) })
    })
    return () => { rendering.current++; cancelAnimationFrame(timer) }
  }, [project, active, renderTick])
  useEffect(() => { setSelection(null); setCloneOrigin(null) }, [selected.join(',')])
  useEffect(() => { setSelection(null); setCloneOrigin(null) }, [primary?.width, primary?.height, primary?.imageId])
  useEffect(() => { if (!active && (gesture.current || pendingRaster.current)) void finishGesture(true) }, [active])
  useEffect(() => () => backgroundAbort.current?.abort(), [])
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  function history(direction: 'undo' | 'redo') {
    if (busyRef.current || pendingRaster.current || gesture.current) return
    const stack = direction === 'undo' ? undoRef.current : redoRef.current, previous = stack.at(-1)
    if (!previous) return
    if (direction === 'undo') { undoRef.current = stack.slice(0, -1); redoRef.current = [...redoRef.current, projectRef.current] }
    else { redoRef.current = stack.slice(0, -1); undoRef.current = [...undoRef.current.slice(-29), projectRef.current] }
    setUndo(undoRef.current); setRedo(redoRef.current)
    coalesce.current.key = ''; publish(previous); setSelection(null); setCrop(null); setSelected(ids => ids.filter(id => previous.layers.some(l => l.id === id)))
  }
  function addLayer(kind: PhotoLayer['kind']) {
    if (busyRef.current || pendingRaster.current || gesture.current) return
    const current = projectRef.current
    const layer = newPhotoLayer(kind, { x: current.width * 0.15, y: current.height * 0.15, width: Math.max(1, current.width * 0.5), height: kind === 'text' ? 180 : Math.max(1, current.height * 0.45) })
    commit({ ...current, layers: [...current.layers, layer] }); setSelected([layer.id]); setTool('move')
  }
  async function addImage(asset: ImageAsset) {
    if (projectRef.current.layers.length >= 200) throw new Error('Достигнут предел 200 слоёв. Объедините часть слоёв.')
    const image = await loadPhotoImage(asset.url)
    if (!mounted.current) { await onCleanupRef.current(uploaded.current); return }
    const current = projectRef.current, factor = Math.min(current.width / image.naturalWidth, current.height / image.naturalHeight, 1)
    const layer = newPhotoLayer('image', { imageId: asset.id, name: asset.name, width: Math.max(1, image.naturalWidth * factor), height: Math.max(1, image.naturalHeight * factor), x: (current.width - image.naturalWidth * factor) / 2, y: (current.height - image.naturalHeight * factor) / 2 })
    commit({ ...current, layers: [...current.layers, layer], assets: current.assets.some(a => a.id === asset.id) ? current.assets : [...current.assets, asset] })
    setSelected([layer.id]); setTool('move'); setImporting(false)
  }
  async function importFiles(files: File[]) {
    await run('Добавляем изображение…', async () => {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        if (projectRef.current.layers.length >= 200) throw new Error('Достигнут предел 200 слоёв. Объедините часть слоёв.')
        const asset = await repository.upload(file); uploaded.current.push(asset)
        if (!mounted.current) { await onCleanupRef.current([asset]); return }
        await addImage(asset)
      }
    })
  }
  async function importUrl(source = imageUrl) {
    await run('Загружаем изображение…', async () => {
      const url = new URL(source.trim())
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Нужна прямая HTTPS-ссылка на изображение.')
      let response: Response
      try { response = await fetch(url.href, { mode: 'cors', credentials: 'omit' }) } catch { throw new Error('Сайт запрещает обработку этой картинки. Скопируйте саму картинку через Ctrl+C → Ctrl+V или загрузите файл.') }
      if (!response.ok) throw new Error('Картинка по ссылке недоступна.')
      const blob = await response.blob()
      const asset = await repository.upload(new File([blob], 'Изображение по ссылке', { type: blob.type })); uploaded.current.push(asset); await addImage(asset); setImageUrl('')
    })
  }
  function selectLayer(id: string, multi = false) {
    if (busyRef.current || pendingRaster.current || gesture.current) return
    const layer = projectRef.current.layers.find(l => l.id === id)
    const group = layer?.groupId && !multi ? projectRef.current.layers.filter(l => l.groupId === layer.groupId).map(l => l.id) : [id]
    setSelected(ids => multi ? ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id] : group)
  }
  function deleteLayers() {
    if (busyRef.current || pendingRaster.current || gesture.current) return
    const current = projectRef.current, ids = selected.filter(id => !current.layers.find(l => l.id === id)?.locked)
    commit({ ...current, layers: current.layers.filter(l => !ids.includes(l.id)) }); setSelected([])
  }
  function duplicate() {
    if (busyRef.current || pendingRaster.current || gesture.current) return
    const current = projectRef.current, groupIds = new Map<string, string>()
    const copies = current.layers.filter(l => selected.includes(l.id)).map(l => {
      if (l.groupId && !groupIds.has(l.groupId)) groupIds.set(l.groupId, crypto.randomUUID())
      return { ...structuredClone(l), id: crypto.randomUUID(), x: l.x + 20, y: l.y + 20, name: `${l.name} · копия`, groupId: l.groupId ? groupIds.get(l.groupId) : undefined }
    })
    commit({ ...current, layers: [...current.layers, ...copies] }); setSelected(copies.map(l => l.id))
  }
  function groupLayers(ungroup = false) {
    if (busyRef.current || pendingRaster.current || gesture.current) return
    const current = projectRef.current, groupId = ungroup ? undefined : crypto.randomUUID()
    commit({ ...current, layers: current.layers.map(l => selected.includes(l.id) && !l.locked ? { ...l, groupId } : l) })
  }
  function reorder(id: string, destination: number) {
    if (busyRef.current || pendingRaster.current || gesture.current) return
    const current = projectRef.current, layers = [...current.layers], index = layers.findIndex(l => l.id === id)
    if (index < 0 || layers[index].locked) return
    const [layer] = layers.splice(index, 1); layers.splice(clamp(destination, 0, layers.length), 0, layer)
    commit({ ...current, layers })
  }
  async function mergeLayers() {
    await run('Объединяем слои…', async () => {
      const current = projectRef.current, ids = selected.filter(id => !current.layers.find(l => l.id === id)?.locked)
      if (!ids.length) return
      const result = document.createElement('canvas'); await renderProject(current, result, { onlyIds: ids, transparent: true })
      const asset = await repository.upload(new File([await canvasBlob(result)], 'Объединённый слой.png', { type: 'image/png' })); uploaded.current.push(asset)
      if (!mounted.current) { await onCleanupRef.current([asset]); return }
      const layer = newPhotoLayer('image', { name: 'Объединённый слой', imageId: asset.id, x: 0, y: 0, width: current.width, height: current.height, blendMode: ids.length === 1 ? current.layers.find(l => l.id === ids[0])!.blendMode : 'source-over' })
      const topIndex = Math.max(...ids.map(id => current.layers.findIndex(l => l.id === id)))
      const layers = current.layers.flatMap((l, i) => i === topIndex ? [layer] : ids.includes(l.id) ? [] : [l])
      commit({ ...current, layers, assets: [...current.assets, asset] }); setSelected([layer.id])
    })
  }
  async function exportImage(toGallery: boolean) {
    await run(toGallery ? 'Сохраняем в галерею…' : 'Готовим PNG…', async () => {
      await loadPhotoFonts(fonts.filter(font => projectRef.current.layers.some(layer => layer.kind === 'text' && layer.fontFamily === font.family)))
      const result = document.createElement('canvas'); await renderProject(projectRef.current, result)
      const blob = await canvasBlob(result), name = `Композиция ${new Date().toLocaleDateString('ru-RU')}.png`
      if (toGallery) { const asset = await repository.upload(new File([blob], name, { type: 'image/png' })); if (!mounted.current) { await onCleanupRef.current([asset]); return }; onExport(asset); setNotice('Готовая картинка добавлена в галерею') }
      else { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 2000) }
    })
  }
  function canvasPoint(event: { clientX: number; clientY: number }): Point {
    const box = overlay.current!.getBoundingClientRect()
    return { x: (event.clientX - box.left) * projectRef.current.width / box.width, y: (event.clientY - box.top) * projectRef.current.height / box.height }
  }
  async function saveRaster(layer: PhotoLayer, bitmap: HTMLCanvasElement, before = projectRef.current) {
    const asset = await repository.upload(new File([await canvasBlob(bitmap)], `${layer.name}.png`, { type: 'image/png' })); uploaded.current.push(asset)
    if (!mounted.current) { await onCleanupRef.current([asset]); return }
    const current = projectRef.current
    const replacement = { ...layer, kind: 'image' as const, imageId: asset.id, fill: { ...layer.fill, enabled: false } }
    commit({ ...current, assets: [...current.assets, asset], layers: current.layers.some(l => l.id === layer.id) ? current.layers.map(l => l.id === layer.id ? replacement : l) : [...current.layers, replacement] }, before)
    setSelected([layer.id])
  }
  async function removeBackground() {
    if (!primary || primary.locked || primary.kind !== 'image') return
    const layer = primary
    await run('Загружаем модель удаления фона…', async () => {
      const controller = new AbortController(); backgroundAbort.current = controller
      try {
        const { removePhotoBackground } = await import('../lib/photo/background')
        const source = await renderLayerSource(layer, projectRef.current.assets, true)
        const blob = await removePhotoBackground(source, setBusy, controller.signal), url = URL.createObjectURL(blob)
        try { const image = await loadPhotoImage(url); const result = cloneCanvas(source); result.getContext('2d')!.clearRect(0, 0, result.width, result.height); result.getContext('2d')!.drawImage(image, 0, 0, result.width, result.height); await saveRaster(layer, result); setSelection(null) } finally { URL.revokeObjectURL(url) }
      } finally { backgroundAbort.current = null }
    })
  }
  function showSelection(layer: PhotoLayer, mask: Uint8Array, width: number, height: number) {
    const preview = document.createElement('canvas'); preview.width = width; preview.height = height
    const context = preview.getContext('2d')!, pixels = context.createImageData(width, height)
    for (let i = 0; i < mask.length; i++) { pixels.data[i * 4] = 88; pixels.data[i * 4 + 1] = 166; pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = mask[i] * 0.4 }
    context.putImageData(pixels, 0, 0); setSelection({ layerId: layer.id, mask, preview: preview.toDataURL() })
  }
  async function editSelection(mode: 'erase' | 'fill' | 'invert') {
    if (!primary || !selection || primary.locked) return
    const layer = primary
    await run('Обрабатываем выделение…', async () => {
      const bitmap = await renderLayerSource(layer, projectRef.current.assets, true), context = bitmap.getContext('2d')!, pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
      if (mode === 'invert') { showSelection(layer, selection.mask.map(v => 255 - v), bitmap.width, bitmap.height); return }
      if (mode === 'erase') eraseSelection(pixels, selection.mask)
      else fillSelection(pixels, selection.mask, brushColor, brushOpacity)
      context.putImageData(pixels, 0, 0); await saveRaster(layer, bitmap); setSelection(null)
    })
  }
  function finishPath() {
    if (pathPoints.length < 2 || busyRef.current || pendingRaster.current) return
    const current = projectRef.current, xs = pathPoints.map(p => p.x), ys = pathPoints.map(p => p.y), x = Math.min(...xs) - 4, y = Math.min(...ys) - 4, width = Math.max(8, Math.max(...xs) - x + 4), height = Math.max(8, Math.max(...ys) - y + 4)
    const layer = newPhotoLayer('path', { x, y, width, height, points: pathPoints.map(p => ({ x: (p.x - x) / width, y: (p.y - y) / height })), closed: false, smooth: true, fill: { enabled: false, type: 'solid', color: brushColor, color2: '#ffffff', angle: 90 }, stroke: { enabled: true, type: 'solid', color: brushColor, color2: '#ffffff', angle: 90, width: 6 } })
    commit({ ...current, layers: [...current.layers, layer] }); setSelected([layer.id]); setPathPoints([]); setTool('move')
  }
  async function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (busyRef.current || pendingRaster.current || event.button !== 0) return
    event.preventDefault(); root.current?.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId)
    const point = canvasPoint(event), current = projectRef.current
    if (tool === 'path') { setPathPoints(points => [...points, point]); return }
    if (tool === 'crop') { gesture.current = { type: 'crop', start: point, before: current, ids: [] }; setCrop({ start: point, end: point }); return }
    if (tool === 'eyedropper') {
      try { const rgba = canvas.current!.getContext('2d')!.getImageData(clamp(Math.floor(point.x), 0, current.width - 1), clamp(Math.floor(point.y), 0, current.height - 1), 1, 1).data; setBrushColor('#' + Array.from(rgba.slice(0, 3)).map(c => c.toString(16).padStart(2, '0')).join('')); setNotice('Цвет выбран') } catch (cause) { setError(errorMessage(cause)) }
      return
    }
    if (tool === 'move') {
      const handle = (event.target as SVGElement).getAttribute('data-handle'), node = (event.target as SVGElement).getAttribute('data-node')
      if (primary && !primary.locked && (handle || node !== null)) { gesture.current = { type: node !== null ? 'node' : handle === 'rotate' ? 'rotate' : 'resize', start: point, before: current, ids: [primary.id], node: node === null ? undefined : Number(node) }; return }
      const hit = [...current.layers].reverse().find(l => l.visible && !l.locked && containsPoint(l, point))
      if (!hit) { if (!event.shiftKey) setSelected([]); return }
      let ids = selected.includes(hit.id) ? selected : hit.groupId ? current.layers.filter(l => l.groupId === hit.groupId).map(l => l.id) : [hit.id]
      if (event.shiftKey) { selectLayer(hit.id, true); return }
      ids = ids.filter(id => !current.layers.find(l => l.id === id)?.locked)
      setSelected(ids); gesture.current = { type: 'move', start: point, before: current, ids }; return
    }
    let layer = primary
    if (layer?.locked) { setNotice('Слой заблокирован'); return }
    if (!layer && tool !== 'brush') { setNotice('Выберите слой в списке справа'); return }
    if (!layer) layer = newPhotoLayer('image', { name: 'Кисть', x: 0, y: 0, width: current.width, height: current.height })
    const local = localPoint(layer, point)
    if (tool === 'clone' && event.altKey) { setCloneOrigin({ id: layer.id, point: local }); setNotice('Источник штампа выбран'); return }
    if (tool === 'clone' && cloneOrigin?.id !== layer.id) { setNotice('Alt + щелчок: выбрать источник штампа'); return }
    pendingRaster.current = true; setBusy('Готовим инструмент…'); releaseAfterLoad.current = false; cancelAfterLoad.current = false; moveAfterLoad.current = null
    try {
      const bitmap = layer.imageId || layer.kind !== 'image' ? await renderLayerSource(layer, current.assets, true) : Object.assign(document.createElement('canvas'), { width: current.width, height: current.height })
      if (!mounted.current || cancelAfterLoad.current) return
      if (tool === 'select' || tool === 'fill') {
        const context = bitmap.getContext('2d')!, pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
        const mask = tool === 'fill' && selection?.layerId === layer.id ? selection.mask : selectColor(pixels, local.x, local.y, tolerance, contiguous)
        if (tool === 'select') {
          if (selection?.layerId === layer.id && (event.shiftKey || event.altKey)) for (let i = 0; i < mask.length; i++) mask[i] = event.altKey ? Math.max(0, selection.mask[i] - mask[i]) : Math.max(selection.mask[i], mask[i])
          showSelection(layer, mask, bitmap.width, bitmap.height)
        } else { setBusy('Заливаем область…'); fillSelection(pixels, mask, brushColor, brushOpacity); context.putImageData(pixels, 0, 0); await saveRaster(layer, bitmap); setBusy('') }
        return
      }
      const source = cloneCanvas(bitmap)
      gesture.current = { type: 'raster', before: current, layer, canvas: bitmap, source, previous: local, offset: cloneOrigin ? { x: cloneOrigin.point.x - local.x, y: cloneOrigin.point.y - local.y } : undefined }
      paintPoint(local)
      if (moveAfterLoad.current) paintPoint(localPoint(layer, moveAfterLoad.current))
    } catch (cause) { setError(errorMessage(cause)); gesture.current = null; setBusy('') }
    finally { pendingRaster.current = false; setBusy(''); if (releaseAfterLoad.current && gesture.current?.type === 'raster') void finishGesture(cancelAfterLoad.current) }
  }
  function paintPoint(point: Point) {
    const g = gesture.current; if (!g || g.type !== 'raster') return
    applyBrush(g.canvas, { mode: tool as BrushOptions['mode'], from: g.previous, to: point, size: brushSize, hardness, opacity: brushOpacity, color: brushColor, sourceCanvas: g.source, sourceOffset: g.offset, mask: selection?.layerId === g.layer.id ? selection.mask : undefined })
    g.previous = point
    if (strokeFrame.current !== null) return
    strokeFrame.current = requestAnimationFrame(() => {
      strokeFrame.current = null
      const target = canvas.current; if (!target || gesture.current !== g) return
      const previewLayer = { ...g.layer, kind: 'image' as const, fill: { ...g.layer.fill, enabled: false } }
      const previewProject = { ...g.before, layers: g.before.layers.some(l => l.id === g.layer.id) ? g.before.layers.map(l => l.id === g.layer.id ? previewLayer : l) : [...g.before.layers, previewLayer] }
      const revision = ++rendering.current, buffer = document.createElement('canvas')
      void renderProject(previewProject, buffer, { layerSources: new Map([[g.layer.id, g.canvas]]) }).then(() => {
        if (revision === rendering.current && gesture.current === g) { const context = target.getContext('2d')!; context.clearRect(0, 0, target.width, target.height); context.drawImage(buffer, 0, 0) }
      }).catch(cause => setError(errorMessage(cause)))
    })
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const point = canvasPoint(event)
    if (pendingRaster.current) { moveAfterLoad.current = point; return }
    const g = gesture.current; if (!g) return
    if (g.type === 'raster') { paintPoint(localPoint(g.layer, point)); return }
    if (g.type === 'crop') { setCrop({ start: g.start, end: { x: clamp(point.x, 0, g.before.width), y: clamp(point.y, 0, g.before.height) } }); return }
    const layers = g.before.layers.map(l => {
      if (!g.ids.includes(l.id)) return l
      if (g.type === 'move') return { ...l, x: clamp(Math.round(l.x + point.x - g.start.x), -65000, 65000), y: clamp(Math.round(l.y + point.y - g.start.y), -65000, 65000) }
      if (g.type === 'rotate') return { ...l, rotation: Math.round(Math.atan2(point.y - l.y - l.height / 2, point.x - l.x - l.width / 2) * 180 / Math.PI + 90) }
      if (g.type === 'node') { const p = localPoint(l, point); return { ...l, points: l.points.map((v, i) => i === g.node ? { x: clamp(p.x / l.width, 0, 1), y: clamp(p.y / l.height, 0, 1) } : v) } }
      return resizePhotoLayer(l, g.start, point, event.shiftKey)
    })
    const next = { ...g.before, layers }; projectRef.current = next; setProject(next)
  }
  async function finishGesture(cancel = false) {
    if (pendingRaster.current) { releaseAfterLoad.current = true; cancelAfterLoad.current ||= cancel; return }
    const g = gesture.current; if (!g) return
    gesture.current = null
    if (cancel) { publish(g.before); setCrop(null); setRenderTick(t => t + 1); return }
    if (g.type === 'raster') {
      setBusy('Сохраняем мазок…')
      try { await saveRaster(g.layer, g.canvas, g.before) } catch (cause) { setError(errorMessage(cause)); publish(g.before) } finally { setBusy(''); setRenderTick(t => t + 1) }
    } else if (g.type !== 'crop') commit(projectRef.current, g.before)
    else setCrop(value => value ? { ...value } : value)
  }

  // UI is kept together with the canvas so keyboard shortcuts never hijack other tabs.
  return <div className={`photo-editor ${maximized && active ? 'photo-maximized' : ''}`} ref={root} tabIndex={0} aria-label="Фоторедактор" onKeyDown={event => {
    if (!active || busyRef.current || pendingRaster.current || (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true],[role=combobox],[role=dialog]'))) return
    const key = event.code
    if ((event.ctrlKey || event.metaKey) && key === 'KeyZ') { event.preventDefault(); history(event.shiftKey ? 'redo' : 'undo'); return }
    if ((event.ctrlKey || event.metaKey) && key === 'KeyD') { event.preventDefault(); duplicate(); return }
    if ((event.ctrlKey || event.metaKey) && key === 'KeyA') { event.preventDefault(); setSelected(project.layers.filter(l => !l.locked).map(l => l.id)); return }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); if (selection) void editSelection('erase'); else deleteLayers(); return }
    if (key === 'Escape') { if (!gesture.current && !selection && !crop && !pathPoints.length) setMaximized(false); void finishGesture(true); setSelection(null); setCrop(null); setPathPoints([]); return }
    if (key === 'Enter' && tool === 'path') { event.preventDefault(); finishPath(); return }
    const shortcuts: Record<string, Tool> = { KeyV: 'move', KeyC: 'crop', KeyW: 'select', KeyB: 'brush', KeyE: 'erase', KeyG: 'fill', KeyI: 'eyedropper', KeyS: 'clone', KeyR: 'blur', KeyH: 'sharpen', KeyP: 'path' }
    if (shortcuts[key]) { event.preventDefault(); setTool(shortcuts[key]) }
  }} onPaste={event => {
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea')) return
    event.stopPropagation()
    const files = Array.from(event.clipboardData.items).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter((f): f is File => Boolean(f))
    if (files.length) { event.preventDefault(); void importFiles(files) }
    else { const payload = getClipboardImages(event.clipboardData); if (payload.urls.length) { event.preventDefault(); void importUrl(payload.urls[0]) } }
  }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); void importFiles(Array.from(event.dataTransfer.files)) } }}>
    <div className="photo-topbar"><div className="photo-button-row"><button onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}><ImagePlus size={17}/>Изображение</button><button onClick={() => addLayer('text')} disabled={Boolean(busy)}><Type size={17}/>Текст</button><button onClick={() => setImporting(true)} disabled={Boolean(busy)}><Images size={17}/>Из галереи</button></div><div className="photo-button-row"><IconButton title="Отменить · Ctrl+Z" disabled={!undo.length || Boolean(busy)} onClick={() => history('undo')}><Undo2 size={17}/></IconButton><IconButton title="Повторить · Ctrl+Shift+Z" disabled={!redo.length || Boolean(busy)} onClick={() => history('redo')}><Redo2 size={17}/></IconButton><IconButton title={maximized ? "Свернуть редактор" : "Развернуть редактор"} onClick={() => setMaximized(v => !v)}>{maximized ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</IconButton><span className="photo-divider"/><button onClick={() => void exportImage(false)} disabled={Boolean(busy)}><Download size={16}/>PNG</button><button className="photo-export" onClick={() => void exportImage(true)} disabled={Boolean(busy)}><Images size={16}/>В галерею</button></div></div>
    <Presence>{error && <div className="photo-message photo-error" role="alert">{error}<IconButton title="Скрыть ошибку" onClick={() => setError('')}><X size={15}/></IconButton></div>}</Presence>
    <Presence>{notice && <div className="photo-message" role="status"><Check size={15}/>{notice}</div>}</Presence>
    <div className="photo-body">
      <div className="photo-tools" role="toolbar" aria-label="Инструменты фоторедактора">{tools.map(t => <button key={t.id} title={t.name} aria-label={t.name} aria-pressed={tool === t.id} disabled={Boolean(busy)} onClick={() => { setTool(t.id); root.current?.focus({ preventScroll: true }) }}><t.icon size={20}/></button>)}<span className="photo-divider"/><button title="Прямоугольник" aria-label="Добавить прямоугольник" disabled={Boolean(busy)} onClick={() => addLayer('rect')}><Square size={20}/></button><button title="Эллипс" aria-label="Добавить эллипс" disabled={Boolean(busy)} onClick={() => addLayer('ellipse')}><Circle size={20}/></button><button title="Многоугольник" aria-label="Добавить многоугольник" disabled={Boolean(busy)} onClick={() => addLayer('polygon')}><Pentagon size={20}/></button><label className="photo-tool-color" title="Цвет инструмента"><input aria-label="Цвет инструмента" type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)}/></label></div>
      <div className="photo-center"><div className="photo-contextbar">
        <span>{tools.find(t => t.id === tool)?.name.split(' · ')[0]}</span>
        {['brush', 'erase', 'clone', 'blur', 'sharpen'].includes(tool) && <><PhotoNumber label="Кисть, px" min={1} max={500} value={brushSize} onChange={setBrushSize}/><PhotoNumber label="Сила, %" min={1} max={100} value={brushOpacity * 100} onChange={v => setBrushOpacity(v / 100)}/><PhotoNumber label="Жёсткость, %" min={0} max={100} value={hardness * 100} onChange={v => setHardness(v / 100)}/></>}
        {['select', 'fill'].includes(tool) && <><PhotoNumber label="Допуск" min={0} max={255} value={tolerance} onChange={setTolerance}/><label className="photo-check"><input type="checkbox" checked={contiguous} onChange={e => setContiguous(e.target.checked)}/>Смежные пиксели</label></>}
        {primary && primary.kind !== 'image' && ['brush', 'erase', 'fill', 'clone', 'blur', 'sharpen'].includes(tool) && <small>Слой станет изображением · Ctrl+Z отменит</small>}
        {tool === 'move' && <small>Shift — несколько слоёв / пропорции</small>}{tool === 'clone' && <small>Alt + щелчок — источник</small>}{tool === 'crop' && <small>Выделите область на холсте</small>}{tool === 'path' && <><small>Щелчок — узел</small><button disabled={pathPoints.length < 2} onClick={finishPath}><Check size={14}/>Завершить</button></>}
      </div>
      {selection && <div className="photo-selectionbar"><span>Область выделена</span><button disabled={Boolean(busy)} onClick={() => void editSelection('invert')}>Инверсия</button><button disabled={Boolean(busy)} onClick={() => void editSelection('fill')}>Залить</button><button disabled={Boolean(busy)} onClick={() => void editSelection('erase')}>Удалить область</button><IconButton title="Снять выделение" onClick={() => setSelection(null)}><X size={14}/></IconButton></div>}
      {crop && !gesture.current && <div className="photo-selectionbar"><span>{Math.round(Math.abs(crop.end.x - crop.start.x))} × {Math.round(Math.abs(crop.end.y - crop.start.y))}</span><button onClick={() => { commit(cropProject(project, crop.start, crop.end)); setCrop(null); setTool('move') }}><Check size={14}/>Обрезать</button><button onClick={() => setCrop(null)}>Отмена</button></div>}
      <div className={`photo-viewport tool-${tool}`} ref={viewport}><div className="photo-canvas-wrap" style={{ width: project.width * scale, height: project.height * scale }}><canvas ref={canvas} aria-label="Изображение на холсте"/><svg ref={overlay} viewBox={`0 0 ${project.width} ${project.height}`} className="photo-canvas-overlay" onPointerDown={event => void pointerDown(event)} onPointerMove={pointerMove} onPointerUp={() => void finishGesture()} onPointerCancel={() => void finishGesture(true)} onDoubleClick={() => { if (tool === 'path') finishPath() }}>
        {project.layers.filter(l => selected.includes(l.id) && l.visible).map(layer => <g key={layer.id} transform={`translate(${layer.x + layer.width / 2} ${layer.y + layer.height / 2}) rotate(${layer.rotation}) translate(${-layer.width / 2} ${-layer.height / 2})`}>
          {selection?.layerId === layer.id && <image href={selection.preview} width={layer.width} height={layer.height} transform={`${layer.flipX ? `translate(${layer.width} 0) scale(-1 1)` : ''} ${layer.flipY ? `translate(0 ${layer.height}) scale(1 -1)` : ''}`} pointerEvents="none"/>}
          <rect width={layer.width} height={layer.height} fill="none" stroke={layer.locked ? '#8b949e' : '#58a6ff'} strokeWidth={1.5 / scale} strokeDasharray={tool !== 'move' ? `${4 / scale} ${4 / scale}` : undefined} pointerEvents="none"/>
          {tool === 'move' && primary?.id === layer.id && !layer.locked && <><rect data-handle="resize" x={layer.width - 5 / scale} y={layer.height - 5 / scale} width={10 / scale} height={10 / scale} fill="#58a6ff" stroke="#0d1117" strokeWidth={1 / scale} className="photo-resize-handle"/><line x1={layer.width / 2} x2={layer.width / 2} y1={0} y2={-24 / scale} stroke="#58a6ff" strokeWidth={1 / scale}/><circle data-handle="rotate" cx={layer.width / 2} cy={-24 / scale} r={5 / scale} fill="#0d1117" stroke="#58a6ff" strokeWidth={2 / scale} className="photo-rotate-handle"/>{['polygon', 'path'].includes(layer.kind) && layer.points.map((p, i) => <circle key={i} data-node={i} cx={(layer.flipX ? 1 - p.x : p.x) * layer.width} cy={(layer.flipY ? 1 - p.y : p.y) * layer.height} r={4 / scale} fill="#ffffff" stroke="#58a6ff" strokeWidth={1 / scale} onDoubleClick={event => { event.stopPropagation(); if (layer.points.length > 2) patchLayer({ points: layer.points.filter((_, n) => i !== n) }) }}/>)}</>}
        </g>)}
        {crop && <rect x={Math.min(crop.start.x, crop.end.x)} y={Math.min(crop.start.y, crop.end.y)} width={Math.abs(crop.end.x - crop.start.x)} height={Math.abs(crop.end.y - crop.start.y)} fill="#58a6ff22" stroke="#ffffff" strokeWidth={1.5 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`}/>}
        {!!pathPoints.length && <g><polyline points={pathPoints.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={brushColor} strokeWidth={2 / scale}/>{pathPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 / scale} fill="#fff"/>)}</g>}
      </svg>{!project.layers.length && <div className="photo-empty"><ImagePlus size={32}/><strong>Добавьте изображение или текст</strong><span>Перетащите файл сюда или нажмите Ctrl + V</span></div>}</div></div>
      <div className="photo-statusbar"><span>{project.width} × {project.height}<span className="footer-dot">·</span>{project.layers.length} слоёв</span><div><IconButton title="Уменьшить масштаб" onClick={() => setZoom(z => clamp(z / 1.25, 0.25, 4))}><ZoomOut size={15}/></IconButton><button onClick={() => setZoom(1)} title="Вписать в окно">{Math.round(scale * 100)}%</button><IconButton title="Увеличить масштаб" onClick={() => setZoom(z => clamp(z * 1.25, 0.25, 4))}><ZoomIn size={15}/></IconButton></div></div>
      {busy && <div className="photo-busy" role="status"><LoaderCircle className="spin" size={22}/><span>{busy}</span>{backgroundAbort.current && <button onClick={() => backgroundAbort.current?.abort()}>Отменить обработку</button>}</div>}
      </div>
      <aside className="photo-sidebar" aria-label="Слои и свойства" inert={Boolean(busy)}><div className="photo-layers-heading"><strong><Layers size={16}/>Слои</strong><div><IconButton title="Новый пустой слой кисти" onClick={() => { setSelected([]); setTool('brush'); setNotice('Рисуйте на холсте — появится новый слой') }}><Plus size={17}/></IconButton><IconButton title="Копировать слой" disabled={!selected.length || Boolean(busy)} onClick={duplicate}><Copy size={16}/></IconButton><IconButton title="Удалить выбранные слои" disabled={!selected.length || Boolean(busy)} onClick={deleteLayers}><Trash2 size={16}/></IconButton></div></div>
        <div className="photo-layer-list">{[...project.layers].reverse().map(layer => <div key={layer.id} className={`photo-layer ${selected.includes(layer.id) ? 'selected' : ''} ${layer.groupId ? 'grouped' : ''}`} draggable={!layer.locked && !busy} onDragStart={event => { event.dataTransfer.setData('text/plain', layer.id); setDraggedLayer(layer.id) }} onDragEnd={() => setDraggedLayer(null)} onDragOver={event => { if (draggedLayer) event.preventDefault() }} onDrop={event => { if (!draggedLayer) return; event.preventDefault(); event.stopPropagation(); reorder(draggedLayer, project.layers.findIndex(l => l.id === layer.id)); setDraggedLayer(null) }}>
          <IconButton title={layer.visible ? `Скрыть ${layer.name}` : `Показать ${layer.name}`} disabled={Boolean(busy)} onClick={() => patchLayer({ visible: !layer.visible }, layer.id)}>{layer.visible ? <Eye size={15}/> : <EyeOff size={15}/>}</IconButton><button className="photo-layer-select" aria-pressed={selected.includes(layer.id)} onClick={event => selectLayer(layer.id, event.shiftKey || event.ctrlKey || event.metaKey)}>{layer.groupId ? <Folder size={16}/> : layer.kind === 'text' ? <Type size={16}/> : layer.kind === 'image' ? <Images size={16}/> : <Pentagon size={16}/>}<span>{layer.clipToBelow && '↳ '}{layer.name}</span></button><IconButton title={layer.locked ? `Разблокировать ${layer.name}` : `Заблокировать ${layer.name}`} disabled={Boolean(busy)} onClick={() => patchLayer({ locked: !layer.locked }, layer.id)}>{layer.locked ? <LockKeyhole size={14}/> : <UnlockKeyhole size={14}/>}</IconButton>
        </div>)}{!project.layers.length && <p className="photo-hint photo-layer-empty">Здесь появятся ваши слои</p>}</div>
        <div className="photo-layer-actions"><IconButton title="Поднять слой" disabled={!primary || primary.locked || Boolean(busy)} onClick={() => primary && reorder(primary.id, project.layers.findIndex(l => l.id === primary.id) + 1)}><ArrowUp size={16}/></IconButton><IconButton title="Опустить слой" disabled={!primary || primary.locked || Boolean(busy)} onClick={() => primary && reorder(primary.id, project.layers.findIndex(l => l.id === primary.id) - 1)}><ArrowDown size={16}/></IconButton><IconButton title="Сгруппировать выбранные слои" disabled={selected.length < 2 || Boolean(busy)} onClick={() => groupLayers()}><Folder size={16}/></IconButton><IconButton title="Разгруппировать" disabled={!primary?.groupId || Boolean(busy)} onClick={() => groupLayers(true)}><FolderOpen size={16}/></IconButton><button disabled={!selected.length || Boolean(busy)} onClick={() => void mergeLayers()} title="Объединить выбранные слои в изображение"><Layers size={15}/>Объединить</button></div>
        {primary ? <><label className="photo-layer-name"><span>Имя слоя</span><input aria-label="Имя слоя" value={primary.name} maxLength={100} disabled={primary.locked} onChange={e => patchLayer({ name: e.target.value })}/></label><button className="photo-remove-bg" disabled={primary.kind !== 'image' || primary.locked || Boolean(busy)} onClick={() => void removeBackground()}><Scissors size={16}/>Удалить фон</button><PhotoInspector layer={primary} fonts={fonts} onFontsChange={onFontsChange} onChange={patchLayer}/></> : <PhotoSection title="Холст" initial><div className="photo-field-grid"><PhotoNumber label="Ширина холста" min={16} max={PHOTO_MAX_SIZE} value={project.width} onChange={width => commit({ ...project, width: Math.round(width) }, project, 'canvas-width')}/><PhotoNumber label="Высота холста" min={16} max={PHOTO_MAX_SIZE} value={project.height} onChange={height => commit({ ...project, height: Math.round(height) }, project, 'canvas-height')}/></div><Select label="Размер холста" value="custom" options={[{ value: 'custom', label: 'Свой размер' }, { value: '1280x720', label: 'Превью · 1280 × 720' }, { value: '1920x1080', label: 'Full HD · 1920 × 1080' }, { value: '1080x1920', label: 'Вертикальный · 1080 × 1920' }, { value: '1080x1080', label: 'Квадрат · 1080 × 1080' }]} onChange={v => { if (v !== 'custom') { const [width, height] = v.split('x').map(Number); commit({ ...project, width, height }) } }}/><label className="photo-check"><input type="checkbox" checked={project.background === 'transparent'} onChange={e => commit({ ...project, background: e.target.checked ? 'transparent' : '#0d1117' })}/>Прозрачный фон</label>{project.background !== 'transparent' && <PhotoColor label="Фон холста" value={project.background} onChange={background => commit({ ...project, background }, project, 'background')}/>}<p className="photo-hint">Нажмите на слой, чтобы изменить его свойства. Пустое место снимает выделение.</p></PhotoSection>}
      </aside>
    </div>
    <input type="file" className="hidden-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple ref={fileInput} onChange={event => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = '' }}/>
    <Presence>{importing && <Modal title="Добавить изображение" onClose={() => !busy && setImporting(false)}><div className="photo-import-grid">{gallery.map(asset => <button key={asset.id} disabled={Boolean(busy)} onClick={() => void run('Открываем изображение…', () => addImage(asset))}><img src={asset.url} alt={asset.name}/><span>{asset.name}</span></button>)}</div>{!gallery.length && <p className="modal-copy">Галерея этого ролика пока пустая.</p>}<button className="secondary-button" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><ImagePlus size={17}/>Загрузить файл</button><form className="photo-url-form" onSubmit={event => { event.preventDefault(); void importUrl() }}><label htmlFor="photo-image-url">Или прямая ссылка на изображение</label><input id="photo-image-url" type="url" required value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…"/><p className="photo-hint">Для редактирования сохраняется копия изображения. Исходный сайт должен разрешать её загрузку.</p><button className="primary-button" disabled={Boolean(busy)}>Добавить</button></form>{error && <p className="form-error" role="alert">{error}</p>}</Modal>}</Presence>
  </div>
}
