import { useRef, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Plus, Type } from 'lucide-react'
import type { PhotoFont } from '../lib/photo/types'
import { loadPhotoFonts, parseGoogleFontUrl } from '../lib/photo/fonts'
import { Presence } from './Presence'
import { Modal } from './ui'
import './photo-fonts.css'

type Props = { fonts: PhotoFont[]; onChange: (fonts: PhotoFont[]) => void; onSelect: (family: string) => void }

export function PhotoFonts({ fonts, onChange, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState('')
  const latest = useRef(fonts); latest.current = fonts

  async function add(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(''); setBusy(true)
    try {
      const font = parseGoogleFontUrl(url)
      const existing = latest.current.findIndex(item => item.family.toLocaleLowerCase() === font.family.toLocaleLowerCase())
      if (existing < 0 && latest.current.length >= 200) throw new Error('В коллекции уже 200 шрифтов.')
      await loadPhotoFonts([font])
      const next = existing < 0 ? [...latest.current, font] : latest.current.map((item, index) => index === existing ? { ...font, id: item.id } : item)
      onChange(next)
      onSelect(font.family)
      setSelected(font.family)
      setUrl('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось добавить шрифт.') }
    finally { setBusy(false) }
  }

  async function apply(font: PhotoFont) {
    setError(''); setBusy(true)
    try { await loadPhotoFonts([font]); onSelect(font.family); setSelected(font.family) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить шрифт.') }
    finally { setBusy(false) }
  }

  return <>
    <button type="button" className="photo-font-library-button" onClick={() => setOpen(true)}><Type size={15}/> Коллекция шрифтов{fonts.length > 0 && <span>{fonts.length}</span>}</button>
    <Presence>{open && <Modal title="Коллекция шрифтов" onClose={() => setOpen(false)} className="photo-fonts-modal">
      <p className="photo-fonts-help">Шрифты сохраняются в аккаунте и доступны во всех роликах.</p>
      <form className="photo-fonts-form" onSubmit={event => void add(event)}>
        <label htmlFor="photo-google-font-url">Ссылка Google Fonts</label>
        <div className="photo-fonts-input-row"><input id="photo-google-font-url" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://fonts.google.com/specimen/Roboto" autoComplete="off" required disabled={busy}/><button type="submit" className="primary-button" disabled={busy || !url.trim()}>{busy ? <LoaderCircle size={16} className="photo-fonts-spinner"/> : <Plus size={16}/>} Добавить</button></div>
        <small>Поддерживаются ссылки на страницу шрифта и CSS2. Начертания из CSS2 сохраняются; ссылка на страницу добавляет обычное начертание.</small>
      </form>
      {error && <p className="photo-fonts-error" role="alert">{error}</p>}
      <div className="photo-font-list">
        {fonts.map(font => <button type="button" key={font.id} className={`photo-font-card ${selected === font.family ? 'is-selected' : ''}`} onClick={() => void apply(font)} disabled={busy} title={`Применить ${font.family}`}><span className="photo-font-name">{font.family}{selected === font.family && <Check size={15}/>}</span><span className="photo-font-preview" style={{ fontFamily: `"${font.family}", sans-serif` }}>Съёмка начинается • Aa 123</span></button>)}
        {!fonts.length && <p className="photo-fonts-empty">Добавьте ссылку на первый шрифт.</p>}
      </div>
    </Modal>}</Presence>
  </>
}

export default PhotoFonts
