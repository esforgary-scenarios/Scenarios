import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react'
import { Bold, Check, Copy, Italic, Strikethrough } from 'lucide-react'
import { metadataTextError, YOUTUBE_DESCRIPTION_LIMIT } from '../lib/youtubeMetadata'
import { Presence } from './Presence'
import './videoMetadata.css'

type VideoDescriptionProps = { value: string; onChange: (value: string) => void }

export default function VideoDescription({ value, onChange }: VideoDescriptionProps) {
  const id = useId()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const selection = useRef<{ start: number; end: number } | null>(null)
  const latestValue = useRef(value)
  latestValue.current = value
  const [actionError, setActionError] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const validationError = metadataTextError(value, YOUTUBE_DESCRIPTION_LIMIT)
  const error = validationError || actionError

  useLayoutEffect(() => {
    if (!selection.current || !textarea.current) return
    textarea.current.focus({ preventScroll: true })
    textarea.current.setSelectionRange(selection.current.start, selection.current.end)
    selection.current = null
  }, [value])

  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 4000)
    return () => clearTimeout(timer)
  }, [copyState])

  function change(next: string) {
    latestValue.current = next
    setActionError('')
    setCopyState('idle')
    onChange(next)
  }

  function format(marker: '*' | '_' | '-') {
    const field = textarea.current
    if (!field) return
    const { selectionStart: start, selectionEnd: end } = field
    const selected = value.slice(start, end)
    let next: string
    let nextSelection: { start: number; end: number }

    if (selected.length >= 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      next = value.slice(0, start) + selected.slice(1, -1) + value.slice(end)
      nextSelection = { start, end: end - 2 }
    } else if (start > 0 && value[start - 1] === marker && value[end] === marker) {
      next = value.slice(0, start - 1) + selected + value.slice(end + 1)
      nextSelection = { start: start - 1, end: end - 1 }
    } else {
      next = value.slice(0, start) + marker + selected + marker + value.slice(end)
      nextSelection = { start: start + 1, end: end + 1 }
    }

    if (next.length > YOUTUBE_DESCRIPTION_LIMIT) {
      setActionError('Для форматирования не хватает места: описание может содержать до 5000 символов.')
      field.focus({ preventScroll: true })
      return
    }
    selection.current = nextSelection
    change(next)
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget
    const pasted = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    const length = value.length - (field.selectionEnd - field.selectionStart) + pasted.length
    if (length > YOUTUBE_DESCRIPTION_LIMIT) {
      event.preventDefault()
      setActionError('Текст не вставлен: описание вместе с ним превышает лимит 5000 символов.')
    }
  }

  async function copy() {
    const text = latestValue.current
    if (!text || metadataTextError(text, YOUTUBE_DESCRIPTION_LIMIT)) return
    try {
      await navigator.clipboard.writeText(text)
      if (latestValue.current === text) setCopyState('copied')
    } catch {
      if (latestValue.current !== text) return
      setCopyState('manual')
      textarea.current?.focus({ preventScroll: true })
      textarea.current?.select()
    }
  }

  return <section className="video-metadata" aria-labelledby={`${id}-heading`}>
    <div className="metadata-heading">
      <div><h2 id={`${id}-heading`}>Описание</h2><p>Текст для поля «Описание» в YouTube Studio.</p></div>
      <button type="button" className="secondary-button metadata-copy" onClick={() => { void copy() }} disabled={!value || !!validationError}>
        {copyState === 'copied' ? <Check size={16} aria-hidden="true"/> : <Copy size={16} aria-hidden="true"/>}
        {copyState === 'copied' ? 'Скопировано' : 'Скопировать описание'}
      </button>
    </div>
    <div className={`metadata-description-editor${validationError ? ' is-invalid' : ''}`}>
      <div className="metadata-toolbar" role="group" aria-label="Форматирование описания">
        <button type="button" className="metadata-format" title="Жирный: *текст*" aria-label="Жирный: обернуть выделение в звёздочки" onMouseDown={event => event.preventDefault()} onClick={() => format('*')}><Bold size={17}/></button>
        <button type="button" className="metadata-format" title="Курсив: _текст_" aria-label="Курсив: обернуть выделение в подчёркивания" onMouseDown={event => event.preventDefault()} onClick={() => format('_')}><Italic size={17}/></button>
        <button type="button" className="metadata-format" title="Зачёркнутый: -текст-" aria-label="Зачёркнутый: обернуть выделение в дефисы" onMouseDown={event => event.preventDefault()} onClick={() => format('-')}><Strikethrough size={17}/></button>
        <span>Форматирование YouTube</span>
      </div>
      <label className="sr-only" htmlFor={`${id}-text`}>Описание видео</label>
      <textarea ref={textarea} id={`${id}-text`} className="metadata-description-input" value={value} maxLength={YOUTUBE_DESCRIPTION_LIMIT} onChange={event => change(event.target.value)} onPaste={paste} rows={15} placeholder={'О чём это видео?\n\n00:00 Вступление\n\nСсылки и #хештеги'} aria-invalid={!!validationError} aria-describedby={`${id}-help ${id}-count${error ? ` ${id}-error` : ''}`} spellCheck/>
    </div>
    <div className="metadata-footer">
      <p id={`${id}-help`}>Ссылки, таймкоды, #хештеги и переносы строк сохраняются.</p>
      <span id={`${id}-count`} className={`metadata-count${validationError ? ' is-invalid' : ''}`} aria-label={`${value.length} из ${YOUTUBE_DESCRIPTION_LIMIT} символов`}>{value.length} / {YOUTUBE_DESCRIPTION_LIMIT}</span>
    </div>
    <Presence>{error && <p id={`${id}-error`} className="metadata-error" role="alert">{error}</p>}</Presence>
    <Presence>{copyState !== 'idle' && <p className={`metadata-notice${copyState === 'manual' ? ' is-warning' : ''}`} role="status">{copyState === 'copied' ? 'Описание скопировано. Вставьте его в YouTube Studio.' : 'Не удалось скопировать автоматически. Текст выделен — нажмите Ctrl+C или ⌘C.'}</p>}</Presence>
  </section>
}
