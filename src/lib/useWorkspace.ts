import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quote, Video, WorkspaceData, WorkspaceRepository } from '../types'
import type { PhotoFont } from './photo/types'

export function useWorkspace(repository: WorkspaceRepository) {
  const [workspace, setWorkspace] = useState<WorkspaceData>({ videos: [], quotes: [], fonts: [] })
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState(false)
  const current = useRef<WorkspaceData>({ videos: [], quotes: [], fonts: [] })
  const dirty = useRef(false)
  const pending = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    if (pending.current) return pending.current
    const save = async () => {
      while (dirty.current) {
        const snapshot = current.current
        if (mounted.current) setStatus('saving')
        try {
          await repository.save(snapshot)
          if (current.current === snapshot) dirty.current = false
          if (mounted.current) { setError(''); setStatus(dirty.current ? 'pending' : 'saved') }
        } catch (cause) {
          if (mounted.current) {
            setStatus('error')
            setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения. Попробуйте ещё раз.')
          }
          throw cause
        }
      }
    }
    pending.current = save()
    try { await pending.current } finally { pending.current = null }
  }, [repository])

  const updateWorkspace = useCallback((change: (previous: WorkspaceData) => WorkspaceData) => {
    current.current = change(current.current)
    dirty.current = true
    setWorkspace(current.current)
    setStatus('pending')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(() => {}) }, 650)
  }, [flush])

  const update = useCallback((change: (previous: Video[]) => Video[]) => {
    updateWorkspace(previous => ({ ...previous, videos: change(previous.videos) }))
  }, [updateWorkspace])

  const updateQuotes = useCallback((change: (previous: Quote[]) => Quote[]) => {
    updateWorkspace(previous => ({ ...previous, quotes: change(previous.quotes) }))
  }, [updateWorkspace])

  const updateFonts = useCallback((change: (previous: PhotoFont[]) => PhotoFont[]) => {
    updateWorkspace(previous => ({ ...previous, fonts: change(previous.fonts ?? []) }))
  }, [updateWorkspace])

  useEffect(() => {
    let cancelled = false
    mounted.current = true
    repository.load().then((data) => {
      if (cancelled) return
      current.current = data
      setWorkspace(data)
      setLoading(false)
    }).catch((cause) => {
      if (cancelled) return
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить данные.')
      setLoadError(true)
      setLoading(false)
      setStatus('error')
    })
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', unload)
    return () => {
      cancelled = true
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      window.removeEventListener('beforeunload', unload)
    }
  }, [repository])
  return { ...workspace, fonts: workspace.fonts ?? [], loading, loadError, status, error, update, updateQuotes, updateFonts, flush }
}
