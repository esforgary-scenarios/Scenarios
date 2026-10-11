import { useEffect, useId, useState, type FormEvent } from 'react'
import { Check, Copy, ExternalLink, Globe2, Link2, Pencil, Plus, Trash2 } from 'lucide-react'
import { createVideoLink } from '../lib/videoLinks'
import type { VideoLink } from '../types'
import { IconButton, Modal } from './ui'
import { Presence } from './Presence'

type LinkDraft = { id?: string; title: string; url: string; description: string }

export default function VideoLinks({ links, onChange }: { links: VideoLink[]; onChange: (links: VideoLink[]) => void }) {
  const [draft, setDraft] = useState<LinkDraft | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VideoLink | null>(null)
  const formId = useId()

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => { setNotice(null); setCopiedId(null) }, 4000)
    return () => clearTimeout(timer)
  }, [notice])

  function edit(link?: VideoLink) {
    setDraft(link ? { ...link, description: link.description ?? '' } : { title: '', url: '', description: '' })
    setError('')
    setNotice(null)
    setCopiedId(null)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    try {
      const link = createVideoLink(draft)
      onChange(draft.id ? links.map(item => item.id === draft.id ? link : item) : [...links, link])
      setNotice({ text: draft.id ? 'Ссылка обновлена' : 'Ссылка добавлена' })
      setCopiedId(null)
      setDraft(null)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить ссылку.') }
  }

  async function copy(link: VideoLink) {
    try {
      await navigator.clipboard.writeText(link.url)
      setCopiedId(link.id)
      setNotice({ text: 'Ссылка скопирована' })
    } catch {
      setCopiedId(null)
      setNotice({ text: 'Не удалось скопировать ссылку. Выделите адрес и скопируйте его вручную.', error: true })
    }
  }

  function remove() {
    if (!deleteTarget) return
    onChange(links.filter(link => link.id !== deleteTarget.id))
    if (draft?.id === deleteTarget.id) setDraft(null)
    setDeleteTarget(null)
    setCopiedId(null)
    setNotice({ text: 'Ссылка удалена' })
  }

  return <div className="video-links">
    <div className="video-links-heading">
      <div><h2>Ссылки</h2></div>
      {!draft && links.length > 0 && <button type="button" className="secondary-button" onClick={() => edit()}><Plus size={16}/>Добавить ссылку</button>}
    </div>

    <Presence>{draft && <form className="video-links-form" onSubmit={save}>
      <h3>{draft.id ? 'Редактировать ссылку' : 'Новая ссылка'}</h3>
      <label className="field-label" htmlFor={`${formId}-url`}>Адрес сайта</label>
      <input id={`${formId}-url`} className="link-input" type="text" inputMode="url" autoComplete="url" autoCapitalize="off" spellCheck={false} autoFocus required placeholder="example.com или https://example.com" value={draft.url} onChange={event => { setDraft({ ...draft, url: event.target.value }); setError('') }} aria-invalid={!!error} aria-describedby={error ? `${formId}-error` : undefined}/>
      <label className="field-label" htmlFor={`${formId}-title`}>Название <span className="link-optional">· необязательно</span></label>
      <input id={`${formId}-title`} className="link-input" type="text" placeholder="Например, статья для сценария" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/>
      <label className="field-label" htmlFor={`${formId}-description`}>Заметка <span className="link-optional">· необязательно</span></label>
      <textarea id={`${formId}-description`} className="link-input link-description-input" rows={3} placeholder="Что полезного по этой ссылке?" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/>
      <Presence>{error && <p id={`${formId}-error`} className="form-error" role="alert">{error}</p>}</Presence>
      <div className="video-links-form-actions"><button type="button" className="text-button" onClick={() => { setDraft(null); setError('') }}>Отмена</button><button type="submit" className="primary-button">{draft.id ? 'Сохранить изменения' : 'Добавить ссылку'}</button></div>
    </form>}</Presence>

    <Presence>{notice && <p className={`video-links-notice ${notice.error ? 'form-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}</Presence>

    {links.length ? <ul className="video-links-list">
      {links.map(link => <li key={link.id} className="link-card" data-motion-item={`link-${link.id}`}>
        <div className="link-card-main"><span className="link-site-icon" aria-hidden="true"><Globe2 size={20}/></span><div className="link-card-copy">
          <a className="link-title" href={link.url} target="_blank" rel="noopener noreferrer" title="Открыть в новой вкладке">{link.title || new URL(link.url).hostname}<ExternalLink size={14} aria-hidden="true"/><span className="sr-only"> (откроется в новой вкладке)</span></a>
          <a className="link-url" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть ${link.url} в новой вкладке`}>{link.url}</a>
          {link.description && <p className="link-description">{link.description}</p>}
        </div></div>
        <div className="link-card-actions">
          <IconButton title={copiedId === link.id ? `Скопировано: ${link.title}` : `Скопировать ссылку: ${link.title}`} onClick={() => { void copy(link) }}>{copiedId === link.id ? <Check size={17}/> : <Copy size={17}/>}</IconButton>
          <IconButton title={`Редактировать ссылку: ${link.title}`} onClick={() => edit(link)}><Pencil size={17}/></IconButton>
          <IconButton title={`Удалить ссылку: ${link.title}`} onClick={() => setDeleteTarget(link)}><Trash2 size={17}/></IconButton>
        </div>
      </li>)}
    </ul> : !draft && <div className="video-links-empty"><span className="video-links-empty-icon"><Link2 size={27}/></span><h3>Нет ссылок</h3><p>Добавьте сайт или источник для этого ролика.</p><button type="button" className="primary-button" onClick={() => edit()}><Plus size={17}/>Добавить ссылку</button></div>}

    <Presence>{deleteTarget && <Modal title="Удалить ссылку?" onClose={() => setDeleteTarget(null)}>
      <p className="video-links-delete-copy">Ссылка «{deleteTarget.title}» будет удалена из этого ролика.</p>
      <div className="video-links-form-actions"><button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)}>Отмена</button><button type="button" className="danger-button" onClick={remove}>Удалить ссылку</button></div>
    </Modal>}</Presence>
  </div>
}
