import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Pencil, Plus, Quote as QuoteIcon, Search, Trash2, X } from 'lucide-react'
import { createQuote, QUOTE_COLORS, QUOTE_TEXT_LIMIT, sortQuotesByColor } from '../lib/quotes'
import { animateUpdate } from '../lib/motion'
import type { Quote, QuoteColor } from '../types'
import { IconButton, Modal } from './ui'
import { Presence } from './Presence'
import Select from './Select'
import './quoteLibrary.css'

type QuoteLibraryProps = { quotes: Quote[]; onChange: (quotes: Quote[]) => void }
type CopyResult = { id: string; text: string; manual: boolean }

function QuoteColorPicker({ color = 'default', onChange }: { color?: QuoteColor; onChange: (color: QuoteColor) => void }) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const selected = QUOTE_COLORS.find(item => item.value === color) ?? QUOTE_COLORS[0]

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  return <div ref={root} className="quote-color-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
  }}>
    <button ref={trigger} type="button" className="quote-color-trigger" style={{ color: selected.hex }} title={`Цвет цитаты: ${selected.label}`} aria-label={`Цвет цитаты: ${selected.label}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <QuoteIcon size={20} aria-hidden="true"/><ChevronDown size={12} aria-hidden="true"/>
    </button>
    <Presence>{open && <div id={id} className="quote-color-palette" role="group" aria-label="Выбрать цвет цитаты">
      {QUOTE_COLORS.map(item => <button key={item.value} type="button" aria-pressed={color === item.value} onClick={() => {
        onChange(item.value)
        setOpen(false)
        trigger.current?.focus()
      }}><span className="quote-color-swatch" style={{ backgroundColor: item.hex }}>{color === item.value && <Check size={12} aria-hidden="true"/>}</span>{item.label}</button>)}
    </div>}</Presence>
  </div>
}

function QuotePreview({ text }: { text: string }) {
  const id = useId()
  const content = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [height, setHeight] = useState(0)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const element = content.current
    if (!element) return
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
      setHeight(element.scrollHeight)
      setOverflowing(element.scrollHeight > lineHeight * 4 + 2)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [text])

  return <div className="quote-preview">
    <blockquote id={id} className="quote-card-text" data-expanded={expanded} data-overflowing={overflowing} style={expanded ? { height: height || undefined } : undefined}><span ref={content}>{text}</span></blockquote>
    <div className="quote-expand-slot">
      {overflowing && <button type="button" className="text-button quote-expand-button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? 'Свернуть' : 'Развернуть'}{expanded ? <ChevronUp size={14} aria-hidden="true"/> : <ChevronDown size={14} aria-hidden="true"/>}</button>}
    </div>
  </div>
}

export default function QuoteLibrary({ quotes, onChange }: QuoteLibraryProps) {
  const id = useId()
  const latestQuotes = useRef(quotes)
  latestQuotes.current = quotes
  const manualCopy = useRef<HTMLTextAreaElement>(null)
  const copyVersion = useRef(0)
  const [query, setQuery] = useState('')
  const [colorFilter, setColorFilter] = useState<QuoteColor | 'all'>('all')
  const [sort, setSort] = useState<'added' | 'color'>('added')
  const [editor, setEditor] = useState<{ id: string | null } | null>(null)
  const [draft, setDraft] = useState('')
  const [draftColor, setDraftColor] = useState<QuoteColor>('default')
  const [deleteTarget, setDeleteTarget] = useState<Quote | null>(null)
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null)
  const search = query.trim().toLocaleLowerCase('ru')
  const matches = quotes.filter(quote => quote.text.toLocaleLowerCase('ru').includes(search) && (colorFilter === 'all' || (quote.color ?? 'default') === colorFilter))
  const filtered = sort === 'color' ? sortQuotesByColor(matches) : matches
  const filtering = !!search || colorFilter !== 'all'
  const tooLong = draft.length > QUOTE_TEXT_LIMIT
  const canSave = !!draft.trim() && !tooLong

  useEffect(() => {
    if (!copyResult) return
    if (copyResult.manual) {
      manualCopy.current?.focus({ preventScroll: true })
      manualCopy.current?.select()
      return
    }
    const timer = window.setTimeout(() => setCopyResult(null), 3500)
    return () => window.clearTimeout(timer)
  }, [copyResult])

  useEffect(() => () => { copyVersion.current += 1 }, [])

  function openEditor(quote?: Quote) {
    setDraft(quote?.text ?? '')
    setDraftColor(quote?.color ?? (colorFilter === 'all' ? 'default' : colorFilter))
    setEditor({ id: quote?.id ?? null })
  }

  function change(next: Quote[]) {
    latestQuotes.current = next
    onChange(next)
    copyVersion.current += 1
    setCopyResult(null)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!editor || !canSave) return
    const text = draft.trim()
    if (editor.id) {
      change(latestQuotes.current.map(quote => quote.id === editor.id ? { ...quote, text, color: draftColor, updatedAt: new Date().toISOString() } : quote))
    } else {
      change([createQuote(text, draftColor), ...latestQuotes.current])
      setQuery('')
    }
    if (colorFilter !== 'all' && colorFilter !== draftColor) setColorFilter('all')
    setEditor(null)
  }

  async function copy(quote: Quote) {
    const version = ++copyVersion.current
    try {
      await navigator.clipboard.writeText(quote.text)
      if (copyVersion.current === version) setCopyResult({ id: quote.id, text: quote.text, manual: false })
    } catch {
      if (copyVersion.current === version) setCopyResult({ id: quote.id, text: quote.text, manual: true })
    }
  }

  return <section className="quote-library" aria-label="Библиотека цитат">
    <div className="quote-library-tools">
      <div className="quote-library-search">
        <label className="search-box">
          <Search size={17} aria-hidden="true"/>
          <input type="search" value={query} onChange={event => animateUpdate(() => setQuery(event.target.value))} placeholder="Найти цитату" aria-label="Поиск по цитатам"/>
        </label>
        <span className="quote-library-count" role="status">{filtering ? `Найдено: ${filtered.length} из ${quotes.length}` : `Сохранено: ${quotes.length}`}</span>
      </div>
      <div className="quote-library-order">
        <Select label="Фильтр цитат по цвету" value={colorFilter} onChange={value => animateUpdate(() => setColorFilter(value as QuoteColor | 'all'))} options={[{ value: 'all', label: 'Все цвета' }, ...QUOTE_COLORS.map(color => ({ value: color.value, label: color.label, color: color.hex }))]}/>
        <Select label="Сортировка цитат" value={sort} onChange={value => animateUpdate(() => setSort(value as 'added' | 'color'))} options={[{ value: 'added', label: 'По добавлению' }, { value: 'color', label: 'По цвету' }]}/>
      </div>
      <button type="button" className="primary-button" onClick={() => openEditor()}><Plus size={17} aria-hidden="true"/>Добавить цитату</button>
    </div>

    {filtered.length > 0 ? <ul className="quote-grid" aria-label="Сохранённые цитаты">
      {filtered.map(quote => {
        const result = copyResult?.id === quote.id ? copyResult : null
        return <li key={quote.id} className="quote-card" data-motion-item={`quote-${quote.id}`}>
          <QuoteColorPicker color={quote.color} onChange={color => change(latestQuotes.current.map(item => item.id === quote.id ? { ...item, color, updatedAt: new Date().toISOString() } : item))}/>
          <QuotePreview text={quote.text}/>
          <div className="quote-card-footer">
            <button type="button" className="text-button quote-copy-button" onClick={() => { void copy(quote) }}>
              {result && !result.manual ? <Check size={15} aria-hidden="true"/> : <Copy size={15} aria-hidden="true"/>}
              {result && !result.manual ? 'Скопировано' : 'Скопировать'}
            </button>
            <div className="quote-card-actions">
              <IconButton title="Редактировать цитату" onClick={() => openEditor(quote)}><Pencil size={16}/></IconButton>
              <IconButton title="Удалить цитату" className="quote-delete-button" onClick={() => setDeleteTarget(quote)}><Trash2 size={16}/></IconButton>
            </div>
          </div>
          <Presence>{result && <div className="quote-copy-result">
            {result.manual ? <>
              <div className="quote-copy-message"><p role="status">Не удалось скопировать автоматически. Текст выделен — нажмите Ctrl+C или ⌘C.</p><IconButton title="Закрыть ручное копирование" onClick={() => setCopyResult(null)}><X size={16}/></IconButton></div>
              <label className="sr-only" htmlFor={`${id}-copy`}>Цитата для ручного копирования</label>
              <textarea id={`${id}-copy`} ref={manualCopy} className="quote-textarea quote-copy-input" value={result.text} rows={4} readOnly onFocus={event => event.currentTarget.select()}/>
            </> : <span className="sr-only" role="status">Цитата скопирована</span>}
          </div>}</Presence>
        </li>
      })}
    </ul> : <div className="quote-library-empty">
      <QuoteIcon size={27} aria-hidden="true"/>
      <h2>{filtering ? 'Цитаты не найдены' : 'Здесь пока нет цитат'}</h2>
      <p>{filtering ? 'Измените текст поиска или выбранный цвет.' : 'Сохраняйте здесь фразы для будущих сценариев.'}</p>
      {filtering && <button type="button" className="secondary-button" onClick={() => { setQuery(''); setColorFilter('all') }}>Сбросить фильтры</button>}
    </div>}

    <Presence>{editor && <Modal title={editor.id ? 'Редактировать цитату' : 'Добавить цитату'} className="quote-editor-modal" onClose={() => setEditor(null)}>
      <form onSubmit={save}>
        <div className="quote-editor-color"><span>Цвет значка</span><QuoteColorPicker color={draftColor} onChange={setDraftColor}/></div>
        <label className="quote-field-label" htmlFor={`${id}-text`}>Текст цитаты</label>
        <textarea id={`${id}-text`} className="quote-textarea" value={draft} onChange={event => setDraft(event.target.value)} rows={9} placeholder="Введите фразу…" aria-invalid={tooLong} aria-describedby={`${id}-hint ${id}-count${tooLong ? ` ${id}-error` : ''}`} onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}/>
        <div className="quote-editor-meta"><span id={`${id}-hint`}>Ctrl+Enter или ⌘Enter — сохранить</span><span id={`${id}-count`} className={tooLong ? 'danger' : ''}>{draft.length} / {QUOTE_TEXT_LIMIT}</span></div>
        {tooLong && <p id={`${id}-error`} className="quote-editor-error" role="alert">Цитата может содержать до {QUOTE_TEXT_LIMIT.toLocaleString('ru-RU')} символов. Сократите текст, чтобы сохранить его.</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEditor(null)}>Отмена</button><button type="submit" className="primary-button" disabled={!canSave}>{editor.id ? 'Сохранить' : 'Добавить'}</button></div>
      </form>
    </Modal>}</Presence>

    <Presence>{deleteTarget && <Modal title="Удалить цитату?" onClose={() => setDeleteTarget(null)}>
      <p className="modal-copy">Цитата будет удалена из библиотеки.</p>
      <blockquote className="quote-delete-preview">{deleteTarget.text}</blockquote>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)}>Отмена</button><button type="button" className="danger-button" onClick={() => {
        change(latestQuotes.current.filter(quote => quote.id !== deleteTarget.id))
        setDeleteTarget(null)
      }}>Удалить</button></div>
    </Modal>}</Presence>
  </section>
}
