import { removeBackground } from '@imgly/background-removal'

// The library caches the session's first configuration callback.
let activeId = ''
self.onmessage = async (event: MessageEvent<{ id: string; input: Blob }>) => {
  const { id, input } = event.data
  activeId = id
  try {
    const blob = await removeBackground(input, {
      device: 'cpu', model: 'isnet_quint8', proxyToWorker: false, rescale: true, debug: false,
      output: { format: 'image/png', quality: 1 },
      progress: (key, current, total) => self.postMessage({ id: activeId, type: 'progress', key, current, total }),
    })
    self.postMessage({ id, type: 'complete', blob })
  } catch (error) {
    console.error('Photo background removal failed', error)
    self.postMessage({ id, type: 'error' })
  }
}
