import { useRef } from 'react'
import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered, Redo2, Underline, Undo2 } from 'lucide-react'
import { normalizeHighlights, QuoteHighlight } from '../lib/quoteHighlight'
import { getClipboardImages, type ClipboardImages } from '../lib/clipboardImages'
import Select from './Select'

type EditorStats = { words: number; characters: number }
export type ScriptEditorProps = {
  content: JSONContent
  onChange: (content: JSONContent) => void
  onStats?: (stats: EditorStats) => void
  onPasteImages?: (images: ClipboardImages) => void
}

const fonts = ['Inter', 'Arial', 'Georgia', 'Courier New']
const sizes = ['14', '16', '18', '20', '24', '28', '32']
const Typography = Extension.create({
  name: 'scriptTypography',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontFamily: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const family = element.style.fontFamily.replace(/["']/g, '')
            return fonts.includes(family) ? family : null
          },
          renderHTML: (attributes) => fonts.includes(attributes.fontFamily)
            ? { style: `font-family: ${attributes.fontFamily}` } : {},
        },
        fontSize: {
          default: null,
          parseHTML: (element: HTMLElement) => sizes.includes(element.style.fontSize.replace('px', ''))
            ? element.style.fontSize : null,
          renderHTML: (attributes) => sizes.map((size) => `${size}px`).includes(attributes.fontSize)
            ? { style: `font-size: ${attributes.fontSize}` } : {},
        },
      },
    }]
  },
})

function getStats(text: string): EditorStats {
  return { words: text.trim() ? text.trim().split(/\s+/u).length : 0, characters: text.length }
}

function getToolbarState(editor: Editor) {
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    quotedText: editor.isActive('quotedText'),
    emphasizedText: editor.isActive('emphasizedText'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    alignment: editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').textAlign ?? 'justify',
    family: editor.getAttributes('textStyle').fontFamily ?? 'Inter',
    size: String(editor.getAttributes('textStyle').fontSize ?? '18px').replace('px', ''),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  }
}

export default function ScriptEditor(props: ScriptEditorProps) {
  const callbacks = useRef(props)
  callbacks.current = props
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, heading: { levels: [2, 3] }, codeBlock: false, horizontalRule: false }),
      TextStyle,
      Typography,
      Placeholder.configure({ placeholder: 'Текст сценария…' }),
      TextAlign.configure({ types: ['paragraph', 'heading'], defaultAlignment: 'justify' }),
      QuoteHighlight,
    ],
    content: props.content,
    immediatelyRender: false,
    // Stars belong to highlight syntax. Bold and italic remain available through
    // toolbar buttons and shortcuts, without Markdown rules consuming markers.
    enableInputRules: ['blockquote', 'bulletList', 'orderedList', 'heading', 'strike', 'code'],
    enablePasteRules: ['strike', 'code'],
    editorProps: {
      attributes: {
        class: 'script-prose',
        role: 'textbox',
        'aria-label': 'Текст сценария',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      handlePaste: (_view, event) => {
        const images = getClipboardImages(event.clipboardData)
        if ((!images.files.length && !images.urls.length) || !callbacks.current.onPasteImages) return false
        event.preventDefault()
        event.stopPropagation()
        callbacks.current.onPasteImages(images)
        return true
      },
    },
    onCreate: ({ editor: current }) => {
      const transaction = normalizeHighlights(current.state)
      if (transaction) current.view.dispatch(transaction)
      callbacks.current.onStats?.(getStats(current.getText()))
    },
    onUpdate: ({ editor: current }) => {
      callbacks.current.onChange(current.getJSON())
      callbacks.current.onStats?.(getStats(current.getText()))
    },
  }, [])

  const observedState = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? getToolbarState(current) : null,
  })

  if (!editor) return <div className="editor-body" aria-busy="true" />
  // Tiptap's deferred instance is available before its first state transaction.
  // Mount EditorContent now instead of waiting for that transaction to occur.
  const state = observedState ?? getToolbarState(editor)

  const button = (label: string, icon: React.ReactNode, action: () => void, active?: boolean, disabled = false) => (
    <button type="button" className={`toolbar-button${active ? ' is-active' : ''}`} title={label}
      aria-label={label} aria-pressed={active} disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={action}>
      {icon}
    </button>
  )

  const highlightButton = (label: string, mark: 'quotedText' | 'emphasizedText', shortcut: '1' | '2', highlight: 'quote' | 'action') => (
    <button type="button" className={`toolbar-button toolbar-highlight-button${state[mark] ? ' is-active' : ''}`}
      data-highlight={highlight} title={`${label} (Ctrl+Shift+${shortcut})`} aria-label={`${label} (Ctrl+Shift+${shortcut})`}
      aria-keyshortcuts={`Control+Shift+${shortcut}`} aria-pressed={state[mark]}
      onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleMark(mark).run()}>
      {label}
    </button>
  )

  return <div className="script-editor">
    <div className="editor-toolbar" role="toolbar" aria-label="Форматирование сценария">
      <div className="toolbar-group">
        <Select className="toolbar-font" label="Шрифт" value={state.family} options={fonts.map(font => ({ value: font, label: font }))} preserveEditorSelection onChange={value => editor.chain().focus().setMark('textStyle', { fontFamily: value }).run()}/>
        <Select className="toolbar-size" label="Размер текста" value={state.size} options={sizes.map(size => ({ value: size, label: size }))} preserveEditorSelection onChange={value => editor.chain().focus().setMark('textStyle', { fontSize: `${value}px` }).run()}/>
      </div>
      <div className="toolbar-group">
        {button('Жирный (Ctrl+B)', <Bold size={17} />, () => editor.chain().focus().toggleBold().run(), state.bold)}
        {button('Курсив (Ctrl+I)', <Italic size={17} />, () => editor.chain().focus().toggleItalic().run(), state.italic)}
        {button('Подчёркнутый (Ctrl+U)', <Underline size={17} />, () => editor.chain().focus().toggleUnderline().run(), state.underline)}
        {highlightButton('Цитата', 'quotedText', '1', 'quote')}
        {highlightButton('Действие', 'emphasizedText', '2', 'action')}
      </div>
      <div className="toolbar-group">
        {button('По левому краю', <AlignLeft size={17} />, () => editor.chain().focus().setTextAlign('left').run(), state.alignment === 'left')}
        {button('По центру', <AlignCenter size={17} />, () => editor.chain().focus().setTextAlign('center').run(), state.alignment === 'center')}
        {button('По правому краю', <AlignRight size={17} />, () => editor.chain().focus().setTextAlign('right').run(), state.alignment === 'right')}
        {button('По ширине', <AlignJustify size={17} />, () => editor.chain().focus().setTextAlign('justify').run(), state.alignment === 'justify')}
      </div>
      <div className="toolbar-group">
        {button('Маркированный список', <List size={17} />, () => editor.chain().focus().toggleBulletList().run(), state.bulletList)}
        {button('Нумерованный список', <ListOrdered size={17} />, () => editor.chain().focus().toggleOrderedList().run(), state.orderedList)}
      </div>
      <div className="toolbar-group toolbar-history">
        {button('Отменить (Ctrl+Z)', <Undo2 size={17} />, () => editor.chain().focus().undo().run(), undefined, !state.canUndo)}
        {button('Повторить (Ctrl+Shift+Z)', <Redo2 size={17} />, () => editor.chain().focus().redo().run(), undefined, !state.canRedo)}
      </div>
    </div>
    <EditorContent editor={editor} className="editor-body" />
  </div>
}
