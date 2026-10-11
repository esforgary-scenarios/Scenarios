import { useEffect, useRef, type ReactNode } from 'react'
import { Clapperboard, X } from 'lucide-react'

export function Brand() { return <div className="brand"><span className="brand-icon"><Clapperboard size={23} strokeWidth={1.8} /></span><span>кадр<span className="brand-dot">.</span></span></div> }
export function IconButton({ title, children, onClick, className = '', disabled = false }: {title:string;children:ReactNode;onClick:()=>void;className?:string;disabled?:boolean}) {
  return <button type="button" className={`icon-button ${className}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>
}
export function Modal({ title, onClose, children, className = '' }: {title:string;onClose:()=>void;children:ReactNode;className?:string}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href], [tabindex="0"]')
        if (!elements?.length) { event.preventDefault(); return }
        const first = elements[0], last = elements[elements.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); previous?.focus() }
  }, [])
  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={panel} tabIndex={-1} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><IconButton title="Закрыть" onClick={onClose}><X size={20}/></IconButton></div>{children}</div></div>
}
