import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Check, Copy, Plus, X } from 'lucide-react'
import { countTags, mergeTags, parseTagInput, tagsToClipboard, YOUTUBE_TAGS_LIMIT } from '../lib/youtubeMetadata'
import { animateUpdate } from '../lib/motion'
import { Presence } from './Presence'
import './videoMetadata.css'

type VideoTagsProps = { value: string[]; onChange: (value: string[]) => void }

export default function VideoTags({ value, onChange }: VideoTagsProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const fallback = useRef<HTMLTextAreaElement>(null)
  const values = useRef(value)
  values.current = value
  const draftValue = useRef('')
  const composing = useRef(false)
  const [draft, setDraft] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [manualText, setManualText] = useState('')
  const copyVersion = useRef(0)
  const seen = new Set<string>()
  const pendingTags = [...value, ...parseTagInput(draft)].filter(tag => {
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const count = countTags(pendingTags)
  const error = mergeTags(value, draft).error

  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 4000)
    return () => clearTimeout(timer)
  }, [copyState])

  useEffect(() => {
    if (copyState !== 'manual') return
    fallback.current?.focus({ preventScroll: true })
    fallback.current?.select()
  }, [copyState, manualText])

  function clearCopy() {
    copyVersion.current += 1
    setCopyState('idle')
  }

  function updateDraft(next: string) {
    draftValue.current = next
    setDraft(next)
    clearCopy()
  }

  function updateTags(next: string[]) {
    values.current = next
    animateUpdate(() => onChange(next))
    clearCopy()
  }

  function commit(nextDraft = draftValue.current): string[] | null {
    if (composing.current) return null
    const result = mergeTags(values.current, nextDraft)
    if (result.error) return null
    if (result.tags.length !== values.current.length || result.tags.some((tag, index) => tag !== values.current[index])) updateTags(result.tags)
    updateDraft('')
    return result.tags
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Backspace' && !draftValue.current && values.current.length) {
      event.preventDefault()
      const previous = values.current[values.current.length - 1]
      updateTags(values.current.slice(0, -1))
      updateDraft(previous)
    }
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text/plain')
    if (composing.current || !/[,\r\n]/.test(text)) return
    event.preventDefault()
    const field = event.currentTarget
    // An input cannot display line breaks. Keep rejected lists editable with
    // visible separators instead of letting the browser strip their newlines.
    const next = (draftValue.current.slice(0, field.selectionStart ?? draftValue.current.length) + text + draftValue.current.slice(field.selectionEnd ?? draftValue.current.length)).replace(/\r\n?|\n/g, ', ')
    updateDraft(next)
    commit(next)
  }

  async function copy() {
    // Use the synchronous commit result: a preceding blur may already have
    // updated the controlled list, and the draft must never be omitted.
    const tags = commit()
    if (!tags?.length) return
    const text = tagsToClipboard(tags)
    const version = copyVersion.current
    try {
      await navigator.clipboard.writeText(text)
      if (copyVersion.current === version) setCopyState('copied')
    } catch {
      if (copyVersion.current !== version) return
      setManualText(text)
      setCopyState('manual')
    }
  }

  return <section className="video-metadata" aria-labelledby={`${id}-heading`}>
    <div className="metadata-heading">
      <div><h2 id={`${id}-heading`}>Теги</h2><p>Ключевые слова для поля «Теги» в YouTube Studio.</p></div>
      <button type="button" className="secondary-button metadata-copy" onClick={() => { void copy() }} disabled={!pendingTags.length || !!error}>
        {copyState === 'copied' ? <Check size={16} aria-hidden="true"/> : <Copy size={16} aria-hidden="true"/>}
        {copyState === 'copied' ? 'Скопировано' : 'Скопировать теги'}
      </button>
    </div>
    <label className="metadata-field-label" htmlFor={`${id}-input`}>Теги видео</label>
    <div className={`metadata-tags-editor${error ? ' is-invalid' : ''}`}>
      {!!value.length && <ul className="metadata-tag-list" aria-label="Добавленные теги">
        {value.map((tag, index) => {
          const key = JSON.stringify([tag, value.slice(0, index).filter(item => item === tag).length])
          return <li key={key} className="metadata-tag" data-motion-item={`${id}-tag-${key}`}><span>{tag}</span><button type="button" aria-label={`Удалить тег «${tag}»`} title={`Удалить тег «${tag}»`} onClick={() => updateTags(values.current.filter((_, position) => position !== index))}><X size={14} aria-hidden="true"/></button></li>
        })}
      </ul>}
      <div className="metadata-tag-entry">
        <input ref={input} id={`${id}-input`} type="text" value={draft} onChange={event => {
          const next = event.target.value
          updateDraft(next)
          if (!composing.current && /[,\r\n]/.test(next)) commit(next)
        }} onKeyDown={keyDown} onPaste={paste} onBlur={() => { commit() }} onCompositionStart={() => { composing.current = true }} onCompositionEnd={event => {
          composing.current = false
          updateDraft(event.currentTarget.value)
          if (/[,\r\n]/.test(event.currentTarget.value)) commit(event.currentTarget.value)
        }} placeholder="Введите тег и нажмите Enter" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={!!error} aria-describedby={`${id}-help ${id}-count${error ? ` ${id}-error` : ''}`}/>
        <button type="button" className="metadata-add-tag" title="Добавить тег" aria-label="Добавить тег" disabled={!draft.trim() || !!error} onMouseDown={event => event.preventDefault()} onClick={() => { commit(); input.current?.focus() }}><Plus size={17} aria-hidden="true"/></button>
      </div>
    </div>
    <div className="metadata-footer">
      <p id={`${id}-help`}>Enter или запятая добавляют тег. Можно вставить список через запятые или с новой строки.</p>
      <span id={`${id}-count`} className={`metadata-count${count > YOUTUBE_TAGS_LIMIT ? ' is-invalid' : ''}`} aria-label={`${count} из ${YOUTUBE_TAGS_LIMIT} символов`}>{count} / {YOUTUBE_TAGS_LIMIT}</span>
    </div>
    <p className="metadata-hint">Лимит учитывает запятые и кавычки у тегов с пробелами. Повторяющиеся теги объединяются.</p>
    <Presence>{error && <p id={`${id}-error`} className="metadata-error" role="alert">{error}</p>}</Presence>
    <Presence>{copyState === 'copied' && <p className="metadata-notice" role="status">Теги скопированы через запятую. Вставьте их в YouTube Studio.</p>}</Presence>
    <Presence>{copyState === 'manual' && <div className="metadata-copy-fallback">
      <p className="metadata-notice is-warning" role="status">Не удалось скопировать автоматически. Текст выделен — нажмите Ctrl+C или ⌘C.</p>
      <label className="sr-only" htmlFor={`${id}-copy`}>Теги для ручного копирования</label>
      <textarea ref={fallback} id={`${id}-copy`} className="metadata-fallback-input" rows={3} value={manualText} readOnly onFocus={event => event.currentTarget.select()}/>
    </div>}</Presence>
  </section>
}
