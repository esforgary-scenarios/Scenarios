function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось подготовить изображение.')), 'image/png') }
    catch { reject(new Error('Изображение нельзя прочитать. Добавьте его файлом или вставьте из буфера обмена.')) }
  })
}
let worker: Worker | null = null
let processing = false
let releaseTimer: ReturnType<typeof setTimeout> | undefined

/** All model downloads and inference run in a dedicated worker, including on static Pages hosting. */
export async function removePhotoBackground(canvas: HTMLCanvasElement, onProgress: (message: string) => void, signal?: AbortSignal): Promise<Blob> {
  if (!canvas.width || !canvas.height) throw new Error('Сначала добавьте изображение на слой.')
  if (processing) throw new Error('Дождитесь завершения предыдущего удаления фона.')
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('Для удаления фона нужен браузер с поддержкой OffscreenCanvas, например актуальный Chrome или Edge.')
  processing = true; clearTimeout(releaseTimer)
  try {
    const input = await png(canvas)
    if (signal?.aborted) throw new Error('Удаление фона отменено.')
    onProgress('Загрузка модели удаления фона…')
    const taskWorker = worker ??= new Worker(new URL('./background.worker.ts', import.meta.url), { type: 'module' })
    const result = await new Promise<Blob>((resolve, reject) => {
      const id = crypto.randomUUID()
      const downloads = new Map<string, { current: number; total: number }>()
      let previousMessage = ''
      const cleanup = () => { taskWorker.removeEventListener('message', message); taskWorker.removeEventListener('error', error); signal?.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); taskWorker.terminate(); worker = null; reject(new Error('Удаление фона отменено.')) }
      const error = () => { cleanup(); taskWorker.terminate(); worker = null; reject(new Error('Не удалось запустить удаление фона. Проверьте подключение и свободную память. Исходный слой сохранён.')) }
      const message = (event: MessageEvent) => {
        if (event.data.id !== id) return
        if (event.data.type === 'complete') { cleanup(); resolve(event.data.blob); return }
        if (event.data.type === 'error') { cleanup(); taskWorker.terminate(); worker = null; reject(new Error('Не удалось удалить фон. Проверьте доступ к staticimgly.com и свободную память. Исходный слой сохранён.')); return }
        const { key, current, total } = event.data
        let next = 'Обработка границ объекта…'
        if (key === 'compute:inference') next = 'Выделение объекта на устройстве…'
        else if (key === 'compute:encode') next = 'Подготовка прозрачного PNG…'
        else if (!String(key).startsWith('compute:')) {
          downloads.set(key, { current, total })
          const values = [...downloads.values()], loaded = values.reduce((n, v) => n + v.current, 0), size = values.reduce((n, v) => n + v.total, 0)
          next = size ? `Загрузка модели: ${(loaded / 1048576).toFixed(1)} / ${(size / 1048576).toFixed(1)} МБ…` : 'Загрузка модели удаления фона…'
        }
        if (next !== previousMessage) { previousMessage = next; onProgress(next) }
      }
      taskWorker.addEventListener('message', message); taskWorker.addEventListener('error', error); signal?.addEventListener('abort', abort, { once: true })
      taskWorker.postMessage({ id, input })
    })
    if (signal?.aborted) throw new Error('Удаление фона отменено.')
    const bitmap = await createImageBitmap(result), output = document.createElement('canvas')
    output.width = canvas.width; output.height = canvas.height
    const context = output.getContext('2d')!
    context.drawImage(bitmap, 0, 0, output.width, output.height); bitmap.close()
    // Preserve pixels erased manually before applying the subject mask.
    context.globalCompositeOperation = 'destination-in'; context.drawImage(canvas, 0, 0)
    onProgress('Сохранение изображения без фона…')
    return await png(output)
  } finally {
    processing = false
    releaseTimer = setTimeout(() => { worker?.terminate(); worker = null }, 120000)
  }
}
