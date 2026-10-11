import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { Presence } from './Presence'
import './select.css'

type Option = { value: string; label: string; color?: string }
type Props = { value: string; onChange: (value: string) => void; options: Option[]; label: string; className?: string; disabled?: boolean; preserveEditorSelection?: boolean }

export default function Select({ value, onChange, options, label, className = '', disabled = false, preserveEditorSelection = false }: Props) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const search = useRef({ text: '', time: 0 })
  const [open, setOpen] = useState(false)
  const selectedIndex = options.findIndex(option => option.value === value)
  const [active, setActive] = useState(Math.max(0, selectedIndex))
  const [position, setPosition] = useState({ left: 0, top: 0, width: 180, maxHeight: 280, above: false })
  const selected = options[selectedIndex]

  function show() {
    if (disabled || !options.length) return
    setActive(Math.max(0, selectedIndex))
    setOpen(true)
    trigger.current?.focus({ preventScroll: true })
  }

  function choose(index: number) {
    const option = options[index]
    if (!option) return
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
    if (option.value !== value) onChange(option.value)
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const gap = 7, margin = 10
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - margin * 2)
      const wanted = Math.min(360, options.length * 38 + 14)
      const below = window.innerHeight - rect.bottom - gap - margin
      const above = rect.top - gap - margin
      const flip = below < wanted && above > below
      const maxHeight = Math.max(48, Math.min(wanted, flip ? above : below))
      setPosition({ left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)), top: flip ? Math.max(margin, rect.top - gap - maxHeight) : rect.bottom + gap, width, maxHeight, above: flip })
    }
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) place() }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scroll, true)
    const observer = new ResizeObserver(place)
    if (trigger.current) observer.observe(trigger.current)
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true) }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: Event) => {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss) }
  }, [open])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useLayoutEffect(() => {
    if (open) popup.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Tab') { setOpen(false); return }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) show()
      const current = open ? active : Math.max(0, selectedIndex)
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : open ? (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : current)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(active); else show()
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const now = Date.now()
      const text = (now - search.current.time < 700 ? search.current.text : '') + event.key.toLocaleLowerCase('ru')
      search.current = { text, time: now }
      const index = options.findIndex(option => option.label.toLocaleLowerCase('ru').startsWith(text))
      if (!open) show()
      if (index >= 0) setActive(index)
    }
  }

  return <div className={`custom-select ${className}`}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} disabled={disabled} className="custom-select-trigger" onKeyDown={keyDown} onMouseDown={event => { if (preserveEditorSelection) event.preventDefault() }} onClick={() => { if (open) setOpen(false); else show() }}>
      {selected?.color && <span className="select-color-dot" style={{ backgroundColor: selected.color }}/>}<span className="select-value">{selected?.label ?? value}</span><ChevronDown className="select-chevron" size={14} aria-hidden="true"/>
    </button>
    {createPortal(<Presence>{open && <div ref={popup} id={id} role="listbox" aria-label={label} className="custom-select-menu" data-side={position.above ? 'above' : 'below'} style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value} data-index={index} data-active={index === active} className="custom-select-option" onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        {option.color && <span className="select-color-dot" style={{ backgroundColor: option.color }}/>}<span>{option.label}</span><Check size={14} className="select-option-check" aria-hidden="true"/>
      </div>)}
    </div>}</Presence>, document.body)}
  </div>
}
