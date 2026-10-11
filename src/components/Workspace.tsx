import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowLeft, ArrowUp, Check, CheckCheck, CheckCircle2, Clapperboard, Clock3, Cloud, Download, FileText, Film, GripVertical, ImageOff, ImagePlus, Images, Info, Link, LoaderCircle, LogOut, MoreHorizontal, Palette, Pencil, Plus, Quote, Search, Tags, Text, Trash2, X } from 'lucide-react'
import ScriptEditor from './ScriptEditor'
import VideoLinks from './VideoLinks'
import VideoDescription from './VideoDescription'
import VideoTags from './VideoTags'
import QuoteLibrary from './QuoteLibrary'
import { Brand, IconButton, Modal } from './ui'
import { Presence } from './Presence'
import { animateUpdate } from '../lib/motion'
import { useWorkspace } from '../lib/useWorkspace'
import { getClipboardImages, type ClipboardImages } from '../lib/clipboardImages'
import { createExternalImage } from '../lib/media'
import { metadataTextError, YOUTUBE_TITLE_LIMIT } from '../lib/youtubeMetadata'
import type { ImageAsset, Video, WorkspaceRepository } from '../types'

const PhotoEditor = lazy(() => import('./PhotoEditor'))

function AssetImage({ image, alt }: { image: ImageAsset; alt: string }) {
  const [failed, setFailed] = useState(false)
  const [loadedUrl, setLoadedUrl] = useState('')
  useEffect(() => setFailed(false), [image.url])
  return failed
    ? <span className="image-unavailable" title="Изображение по этой ссылке недоступно"><ImageOff size={22}/><span>Недоступно</span></span>
    : <img src={image.url} alt={alt} className={`asset-image${loadedUrl === image.url ? ' is-loaded' : ''}`} onLoad={() => setLoadedUrl(image.url)} onError={() => setFailed(true)} referrerPolicy="no-referrer"/>
}

function SortableVideo({ video, index, onSelect, onToggle, onDelete, busy }: {
  video: Video; index: number; onSelect: () => void; onToggle: () => void; onDelete: () => void; busy: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: video.id })
  return <div ref={setNodeRef} data-motion-item={`video-${video.id}`} style={{ transform: CSS.Transform.toString(transform), transition }} className={`video-item ${isDragging ? 'dragging' : ''}`}>
    <button className="drag-handle" aria-label={`Переместить ролик ${video.title}`} title="Удерживайте и перетащите; с клавиатуры: пробел и стрелки" {...attributes} {...listeners}><GripVertical size={17}/></button>
    <button className="video-select" onClick={onSelect}>
      <span className="video-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="video-thumbnail">{video.cover ? <AssetImage image={video.cover} alt=""/> : <Film size={24}/>}</span>
      <span className="video-item-copy"><span className="video-item-title">{video.title || 'Без названия'}</span><span className={`video-item-status ${video.completed ? 'complete' : ''}`}>{video.completed ? 'Снято' : 'В работе'}</span></span>
    </button>
    <span className="video-updated">{new Date(video.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
    <button className={`video-check ${video.completed ? 'checked' : ''}`} role="checkbox" aria-checked={video.completed} aria-label={`Снято: ${video.title}`} onClick={onToggle}>{video.completed && <Check size={14} strokeWidth={3}/>}</button>
    <div className="video-row-actions"><IconButton title={`Удалить ролик: ${video.title}`} onClick={onDelete} disabled={busy}><Trash2 size={17}/></IconButton></div>
  </div>
}

const assetsOf = (video: Video) => [...video.images, ...(video.cover ? [video.cover] : []), ...(video.photoProject?.assets ?? [])]
const sameAsset = (a: ImageAsset, b: ImageAsset) => a.path && b.path ? a.path === b.path : a.id === b.id || a.url === b.url

export default function Workspace({ repository, email, onExit }: {
  repository: WorkspaceRepository; email: string; onExit: () => Promise<void>
}) {
  const { videos, quotes, fonts, loading, loadError, status, error, update, updateQuotes, updateFonts, flush } = useWorkspace(repository)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [homeTab, setHomeTab] = useState<'videos' | 'quotes'>('videos')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')
  const [activeTab, setActiveTab] = useState<'script' | 'gallery' | 'photo' | 'links' | 'description' | 'tags'>('script')
  const [photoOpened, setPhotoOpened] = useState(false)
  const [stats, setStats] = useState({ words: 0, characters: 0 })
  const [help, setHelp] = useState(false)
  const [menu, setMenu] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Video | null>(null)
  const [imageEditor, setImageEditor] = useState<ImageAsset | null>(null)
  const [imageName, setImageName] = useState('')
  const [linkTarget, setLinkTarget] = useState<'cover' | 'gallery' | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [exitFailed, setExitFailed] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const coverUpload = useRef(false)
  const photoBeforeLeave = useRef<(() => boolean) | null>(null)
  const videosRef = useRef(videos)
  videosRef.current = videos
  const current = videos.find(video => video.id === selectedId)
  const titleError = current ? metadataTextError(current.title, YOUTUBE_TITLE_LIMIT) : ''
  const index = current ? videos.findIndex(video => video.id === current.id) : 0
  const completed = videos.filter(video => video.completed).length
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 180, tolerance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const filtered = videos.filter(video => (filter === 'all' || (filter === 'done' ? video.completed : !video.completed)) && video.title.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))
  const change = useCallback((fn: (previous: Video[]) => Video[]) => update(previous => {
    const next = fn(previous)
    videosRef.current = next
    return next
  }), [update])
  const patch = useCallback((id: string, changes: Partial<Video>) => change(all => all.map(video => video.id === id ? { ...video, ...changes, updatedAt: new Date().toISOString() } : video)), [change])
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer) } }, [notice])
  useEffect(() => {
    setMenu(false); setImageEditor(null); setLinkTarget(null); setActiveTab('script'); setPhotoOpened(false)
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [selectedId])
  useEffect(() => { if (activeTab === 'photo') setPhotoOpened(true) }, [activeTab])
  useEffect(() => {
    const resize = () => { const element = titleRef.current; if (element) { element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px` } }
    resize(); window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [current?.title, current?.id])

  function addVideo() {
    const now = new Date().toISOString(), id = crypto.randomUUID()
    change(all => [...all, { id, title: 'Новый сценарий', content: { type: 'doc', content: [{ type: 'paragraph' }] }, completed: false, cover: null, images: [], links: [], description: '', tags: [], createdAt: now, updatedAt: now }])
    setSelectedId(id)
  }
  function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return
    change(all => arrayMove(all, all.findIndex(video => video.id === event.active.id), all.findIndex(video => video.id === event.over!.id)))
  }
  function moveVideo(direction: number) {
    if (!current || index + direction < 0 || index + direction >= videos.length) return
    change(all => arrayMove(all, index, index + direction)); setMenu(false)
  }
  async function removeUnused(assets: ImageAsset[]) {
    await flush()
    for (const asset of assets) {
      if (!videosRef.current.some(video => assetsOf(video).some(other => sameAsset(asset, other)))) await repository.removeImage(asset)
    }
  }
  function chooseFiles(asCover = false) {
    coverUpload.current = asCover
    if (uploadRef.current) { uploadRef.current.multiple = !asCover; uploadRef.current.click() }
  }
  function openLink(asCover = false) { setImageUrl(''); setUrlError(''); setLinkTarget(asCover ? 'cover' : 'gallery') }
  async function attachMedia(payload: ClipboardImages, asCover = false) {
    if (!current || busy || (!payload.files.length && !payload.urls.length)) return
    const targetId = current.id, previousCover = current.cover
    setBusy(true); setActionError('')
    const added: ImageAsset[] = []
    try {
      const urls = asCover ? payload.urls.slice(0, 1) : payload.urls
      for (const url of urls) added.push(createExternalImage(url))
      const files = asCover ? (added.length ? [] : payload.files.slice(0, 1)) : payload.files
      for (const file of files) added.push(await repository.upload(file))
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось добавить изображение.') }
    try {
      if (added.length) {
        animateUpdate(() => change(all => all.map(video => video.id === targetId ? {
          ...video, ...(asCover ? { cover: added[0] } : { images: [...video.images, ...added] }), updatedAt: new Date().toISOString(),
        } : video)))
        if (asCover && previousCover) await removeUnused([previousCover])
        setNotice(asCover ? 'Превью обновлено' : `Добавлено изображений: ${added.length}`)
      }
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось сохранить изображение.') }
    finally { setBusy(false) }
  }
  async function addLink(event: FormEvent) {
    event.preventDefault()
    try { createExternalImage(imageUrl.trim()) } catch (cause) { setUrlError(cause instanceof Error ? cause.message : 'Проверьте ссылку.'); return }
    const asCover = linkTarget === 'cover'
    setLinkTarget(null)
    await attachMedia({ files: [], urls: [imageUrl.trim()] }, asCover)
  }
  async function removeCover() {
    if (!current?.cover || busy) return
    const previous = current.cover
    setBusy(true); patch(current.id, { cover: null })
    try { await removeUnused([previous]); setNotice('Превью удалено') }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось удалить превью.') }
    finally { setBusy(false) }
  }
  async function useAsCover() {
    if (!current || !imageEditor || busy) return
    const previous = current.cover, image = imageEditor
    setBusy(true); setImageEditor(null)
    animateUpdate(() => patch(current.id, { cover: image, images: current.images.filter(item => item.id !== image.id) }))
    try { if (previous) await removeUnused([previous]); setNotice('Изображение перенесено в превью') }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось сохранить превью.') }
    finally { setBusy(false) }
  }
  async function deleteVideo() {
    if (!deleteTarget || busy) return
    if (deleteTarget.id === selectedId && photoBeforeLeave.current && !photoBeforeLeave.current()) { setActionError('Дождитесь завершения обработки изображения.'); setDeleteTarget(null); return }
    setBusy(true); setActionError('')
    const target = deleteTarget
    try {
      animateUpdate(() => change(all => all.filter(video => video.id !== target.id)))
      if (selectedId === target.id) setSelectedId(null)
      setDeleteTarget(null)
      await removeUnused(assetsOf(target)); setNotice('Ролик удалён')
    } catch (cause) { setDeleteTarget(null); setActionError(cause instanceof Error ? cause.message : 'Не удалось удалить ролик.') }
    finally { setBusy(false) }
  }
  async function deleteImage() {
    if (!current || !imageEditor || busy) return
    const target = imageEditor
    setBusy(true); setImageEditor(null)
    try {
      animateUpdate(() => patch(current.id, { images: current.images.filter(image => image.id !== target.id) }))
      await removeUnused([target]); setNotice('Изображение удалено')
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось удалить изображение.') }
    finally { setBusy(false) }
  }
  function downloadScript() {
    if (!current) return
    function text(node: Video['content']): string { return node.text ?? (node.content ?? []).map(text).join(node.type === 'doc' ? '\n\n' : '') }
    const blob = new Blob([current.title + '\n\n' + text(current.content)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${current.title.replace(/[<>:"/\\|?*]/g, '_') || 'Сценарий'}.txt`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000); setMenu(false)
  }
  async function exit() {
    if (photoBeforeLeave.current && !photoBeforeLeave.current()) { setActionError('Дождитесь завершения обработки изображения.'); return }
    setBusy(true)
    try { await flush(); await onExit() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения перед выходом.'); setExitFailed(true); setBusy(false) }
  }
  function leaveVideo() {
    if (photoBeforeLeave.current && !photoBeforeLeave.current()) { setActionError('Дождитесь завершения обработки изображения.'); return }
    setSelectedId(null)
  }

  if (loading) return <div className="loading-screen"><Brand/><LoaderCircle className="spin"/><p>Загрузка…</p></div>
  if (loadError) return <div className="loading-screen"><Brand/><Info size={28}/><p role="alert">{error}</p><button className="primary-button" onClick={() => window.location.reload()}>Загрузить ещё раз</button><button className="text-button" onClick={() => void exit()}>Вернуться ко входу</button></div>
  return <div className={`workspace ${!current ? 'library-workspace' : ''}`} onPaste={event => {
    if (!current || !['script', 'gallery'].includes(activeTab) || event.defaultPrevented || help || imageEditor || linkTarget || deleteTarget) return
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]')) return
    const payload = getClipboardImages(event.clipboardData)
    if (payload.files.length || payload.urls.length) { event.preventDefault(); void attachMedia(payload) }
  }}><div className="app-shell">
    <header className="topbar">
      <button className="brand-home" aria-label="К списку роликов" onClick={() => { leaveVideo(); setHomeTab('videos') }}><Brand/></button>
      <div className="topbar-actions">
        <span className={`save-state ${status}`} role="status">{status === 'saving' || status === 'pending' ? <LoaderCircle size={16} className="spin"/> : status === 'error' ? <Info size={16}/> : <Cloud size={16}/>}<span key={status}>{status === 'saved' ? 'Все изменения сохранены' : status === 'error' ? 'Не сохранено' : 'Сохраняем…'}</span></span>
        <IconButton title="Как пользоваться" onClick={() => setHelp(true)}><Info size={19}/></IconButton>
        <div className="account"><span className="account-avatar">{email.slice(0, 1).toUpperCase()}</span><strong>{email.split('@')[0]}</strong></div>
        <IconButton title="Выйти из аккаунта" disabled={busy} onClick={() => void exit()}><LogOut size={18}/></IconButton>
      </div>
    </header>
    <main className="main-area">
      <Presence>{(error || actionError) && <div className="error-banner" role="alert"><Info size={18}/><span>{actionError || error}</span>{error && <button onClick={() => void flush().catch(() => {})}>Повторить сохранение</button>}<IconButton title="Скрыть уведомление" onClick={() => setActionError('')}><X size={16}/></IconButton></div>}</Presence>
      {!current ? <div className="home-library">
        <div className="section-tabs home-tabs" role="tablist" aria-label="Разделы библиотеки" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'))
          const index = tabs.findIndex(tab => tab === event.target)
          if (index < 0) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
          tabs[next].focus(); tabs[next].click()
        }}>
          {([{ id: 'videos', label: 'Ролики', icon: Film, count: videos.length }, { id: 'quotes', label: 'Цитаты', icon: Quote, count: quotes.length }] as const).map(tab => <button key={tab.id} id={`home-tab-${tab.id}`} type="button" role="tab" aria-selected={homeTab === tab.id} aria-controls={`home-panel-${tab.id}`} tabIndex={homeTab === tab.id ? 0 : -1} className={`section-tab ${homeTab === tab.id ? 'active' : ''}`} onClick={() => setHomeTab(tab.id)}><tab.icon size={17}/>{tab.label}<span className="count-badge">{tab.count}</span></button>)}
        </div>
        <div className="tab-panel" id="home-panel-videos" role="tabpanel" aria-labelledby="home-tab-videos" hidden={homeTab !== 'videos'}>
        <div className="library-page">
        <div className="library-main">

        <div className="library-tools">
          <div className="search-box"><Search size={18}/><input aria-label="Поиск роликов" placeholder="Найти ролик…" value={query} onChange={event => animateUpdate(() => setQuery(event.target.value))}/></div>
          <div className="filter-tabs" aria-label="Фильтр роликов">{([['all', 'Все'], ['active', 'В работе'], ['done', 'Снято']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} aria-pressed={filter === value} onClick={() => animateUpdate(() => setFilter(value))}>{label}</button>)}</div>
        </div>
        <section className="video-table" aria-label="Список роликов">
          <div className="video-table-heading" aria-hidden="true"><span>Ролик</span><span>Изменён</span><span>Снято</span><span/></div>
          <div className="video-list"><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}><SortableContext items={filtered.map(video => video.id)} strategy={verticalListSortingStrategy}>
            {filtered.map(video => <SortableVideo key={video.id} video={video} index={videos.findIndex(item => item.id === video.id)} onSelect={() => setSelectedId(video.id)} onToggle={() => animateUpdate(() => patch(video.id, { completed: !video.completed }))} onDelete={() => setDeleteTarget(video)} busy={busy}/>)}
          </SortableContext></DndContext></div>
          {!filtered.length && <div className="library-empty"><Film size={32}/><h2>{videos.length ? 'Ничего не найдено' : 'Нет роликов'}</h2><p>{videos.length ? 'Измените поиск или фильтр.' : 'Создайте ролик, чтобы написать сценарий.'}</p></div>}
        </section>
        </div>
        <aside className="library-sidebar" aria-label="Статистика и создание роликов">
        <div className="library-summary">
          <button className="summary-card" data-tone="blue" onClick={() => animateUpdate(() => setFilter('all'))}><span className="summary-label"><Film size={19}/>Всего роликов</span><span className="summary-value">{videos.length}</span></button>
          <button className="summary-card" data-tone="orange" onClick={() => animateUpdate(() => setFilter('active'))}><span className="summary-label"><Pencil size={19}/>В работе</span><span className="summary-value">{videos.length - completed}</span></button>
          <button className="summary-card" data-tone="purple" onClick={() => animateUpdate(() => setFilter('done'))}><span className="summary-label"><CheckCheck size={19}/>Снято</span><span className="summary-value">{completed}</span></button>
        </div>
          <button className="primary-button library-create" onClick={addVideo}><Plus size={19}/>Создать</button>
        </aside>
        </div>
        </div>
        <div className="tab-panel quotes-page" id="home-panel-quotes" role="tabpanel" aria-labelledby="home-tab-quotes" hidden={homeTab !== 'quotes'}>
          <QuoteLibrary quotes={quotes} onChange={next => animateUpdate(() => updateQuotes(() => next))}/>
        </div>
      </div> : <div className={`workspace-content ${activeTab === 'photo' ? 'photo-workspace-content' : ''}`} key={current.id}>
        <div className="editor-navigation"><button className="back-button" onClick={leaveVideo}><ArrowLeft size={18}/>Все ролики</button><span>{index + 1} / {videos.length}</span></div>
        <div className="document-heading">
          <div><div className="document-eyebrow"><span className="eyebrow">СЦЕНАРИЙ {String(index + 1).padStart(2, '0')}</span></div>
            <textarea ref={titleRef} className="document-title" aria-label="Название ролика" aria-describedby="video-title-count video-title-error" aria-invalid={Boolean(titleError)} rows={1} value={current.title} maxLength={YOUTUBE_TITLE_LIMIT} spellCheck={false} onChange={event => patch(current.id, { title: event.target.value.replace(/\n/g, '') })}/>
            <div className={`title-limit ${titleError ? 'has-error' : ''}`}><span id="video-title-error" role={titleError ? 'alert' : undefined}>{titleError}</span><span id="video-title-count">{current.title.length} / {YOUTUBE_TITLE_LIMIT}</span></div>
            <div className="document-meta"><span><Clock3 size={14}/>Изменено {new Date(current.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span><span className="tiny-dot"/><span>Изображений: {current.images.length}</span></div>
          </div>
          <div className="document-actions">
            <button className={`complete-button ${current.completed ? 'is-complete' : ''}`} onClick={() => patch(current.id, { completed: !current.completed })}><span className="status-square">{current.completed && <Check size={13}/>}</span>{current.completed ? 'Ролик снят' : 'Отметить снятым'}</button>
            <div className="menu-wrap"><IconButton title="Действия с роликом" onClick={() => setMenu(!menu)}><MoreHorizontal size={22}/></IconButton><Presence>{menu && <><div className="menu-dismiss" onClick={() => setMenu(false)}/><div className="dropdown-menu"><button onClick={downloadScript}><Download size={16}/>Скачать текст</button><button disabled={index === 0} onClick={() => moveVideo(-1)}><ArrowUp size={16}/>Переместить выше</button><button disabled={index === videos.length - 1} onClick={() => moveVideo(1)}><ArrowDown size={16}/>Переместить ниже</button><button className="danger" disabled={busy} onClick={() => { setDeleteTarget(current); setMenu(false) }}><Trash2 size={16}/>Удалить ролик</button></div></>}</Presence></div>
          </div>
        </div>
        <div className={`writing-layout ${activeTab === 'photo' ? 'photo-writing-layout' : ''}`}>
          <section className="writing-column">
            <div className="section-tabs" role="tablist" aria-label="Материалы ролика" onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'))
              const index = tabs.findIndex(tab => tab === event.target)
              if (index < 0) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
              tabs[next].focus(); tabs[next].click()
            }}>
              {([{ id: 'script', label: 'Сценарий', icon: FileText }, { id: 'gallery', label: 'Галерея', icon: Images, count: current.images.length }, { id: 'photo', label: 'Фоторедактор', icon: Palette }, { id: 'links', label: 'Ссылки', icon: Link, count: current.links?.length ?? 0 }, { id: 'description', label: 'Описание', icon: Text }, { id: 'tags', label: 'Теги', icon: Tags, count: current.tags?.length ?? 0 }] as const).map(tab => <button key={tab.id} id={`video-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`video-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} className={`section-tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}><tab.icon size={17}/>{tab.label}{'count' in tab && <span className="count-badge">{tab.count}</span>}</button>)}
            </div>
            <div className="tab-panel" role="tabpanel" id="video-panel-script" aria-labelledby="video-tab-script" hidden={activeTab !== 'script'}>
            <div className="paper"><ScriptEditor key={current.id} content={current.content} onChange={content => patch(current.id, { content })} onStats={setStats} onPasteImages={payload => void attachMedia(payload)}/></div>
            <footer className="editor-footer"><span>{stats.words} слов<span className="footer-dot">·</span>{stats.characters} символов</span><span><Clock3 size={13}/>≈ {Math.max(1, Math.ceil(stats.words / 130))} мин чтения</span></footer>
            </div>
            <div className="tab-panel gallery-panel" role="tabpanel" id="video-panel-gallery" aria-labelledby="video-tab-gallery" hidden={activeTab !== 'gallery'} tabIndex={0}>
            <section className="gallery-section">
              <div className="panel-label"><h3>Галерея<span className="count-badge">{current.images.length}</span></h3><IconButton title="Добавить изображения в галерею" disabled={busy} onClick={() => chooseFiles()}><Plus size={19}/></IconButton></div>
              <div className="gallery-grid">{current.images.map((image, imageIndex) => <button className="gallery-item" data-motion-item={`image-${image.id}`} key={image.id} onClick={() => { setImageEditor(image); setImageName(image.name) }} aria-label={`Редактировать изображение: ${image.name}`}><AssetImage image={image} alt={image.name}/><span className="gallery-number">{String(imageIndex + 1).padStart(2, '0')}</span><span className="gallery-hover"><Pencil size={18}/></span></button>)}</div>
              <button className="upload-zone" disabled={busy} onClick={() => chooseFiles()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void attachMedia(getClipboardImages(event.dataTransfer)) }}>
                <span className="upload-icon">{busy ? <LoaderCircle className="spin" size={21}/> : <ImagePlus size={21}/>}</span><strong>{busy ? 'Добавляем изображения…' : 'Добавить изображения'}</strong><span>Перетащите фото или выберите файл</span><span className="paste-label"><kbd>Ctrl</kbd> + <kbd>V</kbd> из буфера</span>
              </button>
              <div className="media-source-actions"><button className="text-button" disabled={busy} onClick={() => openLink()}><Link size={14}/>Добавить по ссылке</button></div>
              <p className="upload-formats">JPG, PNG, WebP, GIF · до 10 МБ</p>
            </section>
            </div>
            <div className="tab-panel" role="tabpanel" id="video-panel-photo" aria-labelledby="video-tab-photo" hidden={activeTab !== 'photo'}>
              {photoOpened && <Suspense fallback={<div className="photo-loading"><LoaderCircle className="spin" size={22}/>Загружаем редактор…</div>}><PhotoEditor key={current.id} beforeLeaveRef={photoBeforeLeave} active={activeTab === 'photo'} project={current.photoProject} gallery={current.images} fonts={fonts} repository={repository} onChange={photoProject => patch(current.id, { photoProject })} onFontsChange={next => updateFonts(() => next)} onCleanup={removeUnused} onExport={image => change(all => all.map(video => video.id === current.id ? { ...video, images: [...video.images, image], updatedAt: new Date().toISOString() } : video))}/></Suspense>}
            </div>
            <div className="tab-panel" role="tabpanel" id="video-panel-links" aria-labelledby="video-tab-links" hidden={activeTab !== 'links'}>
              <VideoLinks key={current.id} links={current.links ?? []} onChange={links => animateUpdate(() => patch(current.id, { links }))}/>
            </div>
            <div className="tab-panel" role="tabpanel" id="video-panel-description" aria-labelledby="video-tab-description" hidden={activeTab !== 'description'}>
              <VideoDescription key={current.id} value={current.description ?? ''} onChange={description => patch(current.id, { description })}/>
            </div>
            <div className="tab-panel" role="tabpanel" id="video-panel-tags" aria-labelledby="video-tab-tags" hidden={activeTab !== 'tags'}>
              <VideoTags key={current.id} value={current.tags ?? []} onChange={tags => patch(current.id, { tags })}/>
            </div>
          </section>
          <aside className="inspiration-column">
            <div className="rail-heading"><ImagePlus size={17}/><h2>Превью ролика</h2><span>16:9</span></div>
            <section className="cover-section" onPaste={event => {
              if (event.defaultPrevented) return
              const payload = getClipboardImages(event.clipboardData)
              if (payload.files.length || payload.urls.length) { event.preventDefault(); event.stopPropagation(); void attachMedia(payload, true) }
            }}>
              <button className={`cover-preview ${current.cover ? '' : 'empty-cover'}`} onClick={() => chooseFiles(true)} title="Добавить или заменить превью" disabled={busy}>{current.cover ? <AssetImage image={current.cover} alt="Превью ролика"/> : <><ImagePlus size={30}/><span>Добавить превью</span></>}<span className="cover-edit"><Pencil size={14}/></span></button>
              <div className="media-source-actions"><button className="text-button" disabled={busy} onClick={() => openLink(true)}><Link size={14}/>По ссылке</button>{current.cover && <IconButton title="Убрать превью" disabled={busy} onClick={() => void removeCover()}><Trash2 size={15}/></IconButton>}</div>
            </section>

          </aside>
        </div>
      </div>}
    </main>
    <input type="file" ref={uploadRef} className="hidden-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { void attachMedia({ files: Array.from(event.target.files ?? []), urls: [] }, coverUpload.current); event.target.value = '' }}/>
    <Presence>{notice && <div className="toast" role="status"><CheckCircle2 size={18}/>{notice}</div>}</Presence>
    <Presence>{exitFailed && <Modal title="Изменения ещё не сохранены" onClose={() => setExitFailed(false)}><p className="modal-copy">Не удалось сохранить последние изменения. Можно повторить сохранение или выйти. Перед выходом скачайте текст, если хотите оставить копию.</p><div className="modal-actions">{current && <button className="secondary-button" onClick={downloadScript}>Скачать текст</button>}<button className="secondary-button" onClick={() => setExitFailed(false)}>Остаться</button><button className="danger-button" onClick={() => void onExit()}>Выйти</button></div></Modal>}</Presence>
    <Presence>{help && <Modal title="Как пользоваться" onClose={() => setHelp(false)}><div className="help-list">
      <p><GripVertical/>В списке удерживайте ручку у ролика и перетаскивайте его. С клавиатуры: пробел, стрелки, пробел.</p>
      <p><Quote/>Во вкладке «Цитаты» на главном экране храните фразы для будущих роликов. Их можно искать, редактировать и копировать целиком.</p>
      <p><Pencil/>Нажмите на ролик, чтобы открыть сценарий. Текст выравнивается по ширине, лист растёт автоматически.</p>
      <p><FileText/>Текст в "кавычках" подсвечивается зелёным, между *звёздочками* или **двойными звёздочками** — оранжевым. Парные кавычки и звёздочки убираются автоматически.</p>
      <p><Images/>Галерея находится во вкладке рядом со сценарием. Превью хранится отдельно; картинку из галереи можно перенести в превью.</p>
      <p><Palette/>«Фоторедактор» хранит отдельную композицию для каждого ролика. Вставьте картинку через Ctrl+V или добавьте её из галереи. «В галерею» сохраняет готовый PNG; слои остаются в редакторе.</p>
      <p><Pencil/>На холсте: V — перемещение, B — кисть, E — ластик, W — выделение, C — обрезка. Shift выбирает несколько слоёв, Alt + щелчок задаёт источник штампа. Ctrl+Z отменяет действие.</p>
      <p><Link/>Во вкладке «Ссылки» сохраняйте сайты и заметки к ним для каждого ролика.</p>
      <p><Text/>«Описание» вмещает до 5000 символов. Название — до 100. Скопируйте готовое описание кнопкой и вставьте в YouTube Studio.</p>
      <p><Tags/>Вводите теги через запятую или Enter, до 500 символов суммарно. Кнопка копирования переносит весь список для вставки в поле тегов YouTube.</p>
      <p><Pencil/>Кнопки «Цитата» (Ctrl+Shift+1) и «Действие» (Ctrl+Shift+2) включают и снимают подсветку выделенного текста или дальнейшего ввода.</p>
      <p><Link/>Если Ctrl+V содержит ссылку на изображение, сохраняется ссылка. Скриншоты и файлы загружаются в хранилище.</p>
      <p><Cloud/>Изменения сохраняются автоматически в вашем аккаунте.</p>
    </div><button className="primary-button full-width" onClick={() => setHelp(false)}>Закрыть</button></Modal>}</Presence>
    <Presence>{deleteTarget && <Modal title="Удалить ролик?" onClose={() => !busy && setDeleteTarget(null)}><p className="modal-copy">«{deleteTarget.title}», его сценарий, превью и галерея будут удалены. Это действие нельзя отменить.</p><div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => setDeleteTarget(null)}>Оставить</button><button className="danger-button" disabled={busy} onClick={() => void deleteVideo()}>{busy ? 'Удаляем…' : 'Удалить ролик'}</button></div></Modal>}</Presence>
    <Presence>{linkTarget && <Modal title={linkTarget === 'cover' ? 'Превью по ссылке' : 'Изображение по ссылке'} onClose={() => setLinkTarget(null)}>
      <form onSubmit={event => void addLink(event)}>
        <label className="field-label" htmlFor="image-url">Прямая ссылка на изображение</label>
        <input className="image-url-field" id="image-url" type="url" placeholder="https://example.com/image.jpg" required value={imageUrl} onChange={event => { setImageUrl(event.target.value); setUrlError('') }}/>
        <p className="modal-copy">Сохраняется только ссылка. Изображение загружается с исходного сайта.</p>
        {urlError && <p className="form-error" role="alert">{urlError}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setLinkTarget(null)}>Отмена</button><button className="primary-button" disabled={busy}>Добавить</button></div>
      </form>
    </Modal>}</Presence>
    <Presence>{imageEditor && current && <Modal title="Изображение" className="image-modal" onClose={() => setImageEditor(null)}>
      <div className="image-large"><AssetImage image={imageEditor} alt={imageEditor.name}/></div>
      <label className="field-label" htmlFor="image-name">Название изображения</label><input id="image-name" maxLength={150} value={imageName} onChange={event => setImageName(event.target.value)}/>
      {!imageEditor.path && <p className="image-source"><Link size={14}/><a href={imageEditor.url} target="_blank" rel="noopener noreferrer">Открыть исходное изображение</a></p>}
      <div className="image-dialog-actions"><button className="text-button danger" disabled={busy} onClick={() => void deleteImage()}><Trash2 size={16}/>Удалить</button><button className="secondary-button" disabled={busy} onClick={() => void useAsCover()}><ImagePlus size={16}/>В превью</button><button className="primary-button" onClick={() => { patch(current.id, { images: current.images.map(image => image.id === imageEditor.id ? { ...image, name: imageName.trim() || image.name } : image) }); setImageEditor(null) }}>Сохранить</button></div>
    </Modal>}</Presence>
  </div></div>
}
