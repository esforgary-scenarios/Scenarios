import { describe, expect, it, vi } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import { closeHistory, history, redo, undo } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { findEmphasisRanges, findQuoteRanges, normalizeHighlights, QuoteHighlight } from './quoteHighlight'

const extensions = [StarterKit.configure({ undoRedo: false }), TextStyle, QuoteHighlight]
const schema = getSchema(extensions)
const paragraph = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : [])
const docWith = (...blocks: ProseMirrorNode[]) => schema.node('doc', null, blocks)
const stateWith = (text: string) => EditorState.create({ schema, doc: docWith(paragraph(text)) })
const normalize = (doc: ProseMirrorNode) => {
  const state = EditorState.create({ schema, doc })
  const transaction = normalizeHighlights(state)
  return transaction ? state.apply(transaction) : state
}
const spans = (doc: ProseMirrorNode) => {
  const result: Array<{ text: string; marks: string[] }> = []
  doc.descendants((node) => {
    if (node.isText) result.push({ text: node.text!, marks: node.marks.map((mark) => mark.type.name) })
  })
  return result
}
const plugin = () => {
  // Obtain the actual registered extension plugin without mounting a DOM editor.
  const editor = new Editor({ element: null, extensions, content: docWith(paragraph('')).toJSON() })
  const plugins = editor.extensionManager.plugins
  editor.destroy()
  return plugins
}
const editorWith = (text = '') => {
  const editor = new Editor({ element: null, extensions, content: docWith(paragraph(text)).toJSON() })
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }))
  return editor
}
const typeText = (editor: Editor, text: string) => {
  for (const character of text) editor.view.dispatch(editor.state.tr.insertText(character))
}

describe('manual highlight formatting', () => {
  it.each(['quotedText', 'emphasizedText'])('toggles %s on selected text and preserves other formatting', (mark) => {
    const editor = editorWith('До текст после')
    editor.commands.setTextSelection({ from: 4, to: 9 })
    editor.commands.toggleBold()
    expect(editor.commands.toggleMark(mark)).toBe(true)
    expect(editor.isActive(mark)).toBe(true)
    expect(spans(editor.state.doc)).toEqual([
      { text: 'До ', marks: [] },
      { text: 'текст', marks: ['bold', mark] },
      { text: ' после', marks: [] },
    ])
    editor.commands.toggleMark(mark)
    expect(editor.isActive(mark)).toBe(false)
    expect(spans(editor.state.doc)[1]).toEqual({ text: 'текст', marks: ['bold'] })
    editor.destroy()
  })

  it.each(['quotedText', 'emphasizedText'])('keeps %s enabled while typing until it is toggled off', (mark) => {
    const editor = editorWith()
    editor.commands.toggleBold()
    editor.commands.toggleMark(mark)
    for (const character of 'Текст') {
      typeText(editor, character)
      expect(editor.isActive(mark)).toBe(true)
    }
    editor.commands.toggleMark(mark)
    expect(editor.isActive(mark)).toBe(false)
    typeText(editor, ' дальше')
    expect(spans(editor.state.doc)).toEqual([
      { text: 'Текст', marks: ['bold', mark] },
      { text: ' дальше', marks: ['bold'] },
    ])
    editor.destroy()
  })

  it('reports selection formatting and stops carrying a typing mark when the caret moves', () => {
    const editor = editorWith('one two')
    editor.commands.setTextSelection({ from: 1, to: 4 })
    editor.commands.toggleMark('quotedText')
    expect(editor.isActive('quotedText')).toBe(true)
    editor.commands.setTextSelection({ from: 1, to: 8 })
    expect(editor.isActive('quotedText')).toBe(false)
    editor.commands.toggleMark('quotedText')
    expect(editor.isActive('quotedText')).toBe(true)
    editor.commands.toggleMark('quotedText')
    expect(spans(editor.state.doc)).toEqual([{ text: 'one two', marks: [] }])
    editor.commands.setTextSelection(8)
    editor.commands.toggleMark('emphasizedText')
    typeText(editor, ' action')
    editor.commands.setTextSelection(1)
    expect(editor.isActive('emphasizedText')).toBe(false)
    typeText(editor, 'plain ')
    expect(spans(editor.state.doc)[0]).toEqual({ text: 'plain one two', marks: [] })
    editor.destroy()
  })

  it('removes a saved highlight without reinterpreting its inner punctuation on unrelated edits', () => {
    const editor = editorWith()
    typeText(editor, '«Он сказал “да”»')
    editor.commands.selectAll()
    editor.commands.toggleMark('quotedText')
    expect(spans(editor.state.doc)).toEqual([{ text: 'Он сказал “да”', marks: [] }])
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    typeText(editor, ' после')
    expect(spans(editor.state.doc)).toEqual([{ text: 'Он сказал “да” после', marks: [] }])
    editor.destroy()
  })

  it('toggles the two marks independently and preserves a manual mark through automatic conversion', () => {
    const editor = editorWith()
    editor.commands.toggleMark('quotedText')
    typeText(editor, '*action*')
    expect(editor.state.doc.textContent).toBe('action')
    expect(editor.isActive('quotedText')).toBe(true)
    expect(editor.isActive('emphasizedText')).toBe(false)
    typeText(editor, ' quote')
    editor.commands.toggleMark('emphasizedText')
    typeText(editor, ' both')
    editor.commands.toggleMark('quotedText')
    typeText(editor, ' action')
    editor.commands.toggleMark('emphasizedText')
    typeText(editor, ' plain')
    expect(spans(editor.state.doc)).toEqual([
      { text: 'action', marks: ['quotedText', 'emphasizedText'] },
      { text: ' quote', marks: ['quotedText'] },
      { text: ' both', marks: ['quotedText', 'emphasizedText'] },
      { text: ' action', marks: ['emphasizedText'] },
      { text: ' plain', marks: [] },
    ])
    editor.destroy()
  })

  it.each(['"word"', '«word»', '“word”', '*word*', '**word**'])('ends automatic formatting after %s', (text) => {
    const editor = editorWith()
    typeText(editor, text)
    expect(editor.state.doc.textContent).toBe('word')
    expect(editor.isActive('quotedText')).toBe(false)
    expect(editor.isActive('emphasizedText')).toBe(false)
    typeText(editor, ' plain')
    expect(spans(editor.state.doc).at(-1)).toEqual({ text: ' plain', marks: [] })
    editor.destroy()
  })

  it('handles only the assigned editable shortcuts using physical keys for Russian and English layouts', () => {
    const editor = editorWith()
    const shortcuts = editor.state.plugins.find((candidate) => candidate.spec.appendTransaction && candidate.props.handleKeyDown)!
    const event = (overrides: Partial<KeyboardEvent> = {}) => ({
      code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false,
      isComposing: false, repeat: false, preventDefault: vi.fn(), ...overrides,
    }) as unknown as KeyboardEvent
    const press = (input: KeyboardEvent) => shortcuts.props.handleKeyDown!.call(shortcuts, editor.view, input)
    const quote = event()
    expect(press(quote)).toBe(true)
    expect(quote.preventDefault).toHaveBeenCalledOnce()
    expect(editor.isActive('quotedText')).toBe(true)
    expect(press(event({ repeat: true }))).toBe(true)
    expect(editor.isActive('quotedText')).toBe(true)
    const action = event({ code: 'Digit2', key: '"' })
    expect(press(action)).toBe(true)
    expect(editor.isActive('emphasizedText')).toBe(true)
    expect(press(event({ code: 'Digit2', key: '@' }))).toBe(true)
    expect(editor.isActive('emphasizedText')).toBe(false)
    for (const ignored of [
      event({ code: 'KeyB', key: 'B' }), event({ shiftKey: false }), event({ ctrlKey: false }),
      event({ altKey: true }), event({ metaKey: true }), event({ isComposing: true }),
    ]) {
      expect(press(ignored)).toBe(false)
      expect(ignored.preventDefault).not.toHaveBeenCalled()
    }
    const readonlyEvent = event()
    expect(shortcuts.props.handleKeyDown!.call(shortcuts, { editable: false } as typeof editor.view, readonlyEvent)).toBe(false)
    expect(readonlyEvent.preventDefault).not.toHaveBeenCalled()
    editor.destroy()
  })
})

describe('automatic persistent highlights', () => {
  it('finds straight, Russian and curly quote pairs', () => {
    const text = 'Это "раз", «два» и “три”.'
    expect(findQuoteRanges(text).map(({ from, to }) => text.slice(from, to)))
      .toEqual(['"раз"', '«два»', '“три”'])
    const state = normalize(docWith(paragraph(text)))
    expect(state.doc.textContent).toBe('Это раз, два и три.')
    expect(spans(state.doc).filter(({ marks }) => marks.includes('quotedText')).map(({ text }) => text))
      .toEqual(['раз', 'два', 'три'])
  })

  it('retains unmatched, empty and escaped pairs', () => {
    for (const text of ['Начало "без конца', '"" «» “”', '**без конца', '**word*', '****', '**',
      String.raw`Текст \"без цитаты\"`, String.raw`\*не выделять\*`, String.raw`\**не выделять\**`]) {
      expect(normalizeHighlights(stateWith(text)), text).toBeNull()
    }
    const text = String.raw`"Цитата с \"кавычками\" внутри"`
    expect(normalize(docWith(paragraph(text))).doc.textContent).toBe(text.slice(1, -1))
  })

  it('removes only outer quotes and never reinterprets the preserved punctuation', () => {
    expect(findQuoteRanges('«Он сказал “да”')).toEqual([])
    const normalized = normalize(docWith(paragraph('«Он сказал “да”» "а""б"')))
    expect(normalized.doc.textContent).toBe('Он сказал “да” аб')
    expect(normalizeHighlights(normalized)).toBeNull()
    const later = normalized.apply(normalized.tr.insertText('!', normalized.doc.content.size - 1))
    expect(normalizeHighlights(later)).toBeNull()
  })

  it('accepts single and double stars, including adjacent spans', () => {
    const text = '*важный текст* и **второй**; **а****б**; *в**г*'
    expect(findEmphasisRanges(text).map(({ from, to }) => text.slice(from, to)))
      .toEqual(['*важный текст*', '**второй**', '**а**', '**б**', '*в*', '*г*'])
    const result = normalize(docWith(paragraph(text)))
    expect(result.doc.textContent).toBe('важный текст и второй; аб; вг')
    expect(spans(result.doc).filter(({ marks }) => marks.includes('emphasizedText')).map(({ text }) => text))
      .toEqual(['важный текст', 'второй', 'аб', 'вг'])
    expect(spans(result.doc).some(({ marks }) => marks.includes('italic'))).toBe(false)
  })

  it('respects escaped stars and even backslash counts', () => {
    const text = String.raw`**текст с \** символами**`
    expect(findEmphasisRanges(text)).toEqual([{ from: 0, to: text.length }])
    expect(normalize(docWith(paragraph(text))).doc.textContent).toBe(text.slice(2, -2))
    const evenSlashes = String.raw`\\**да**`
    expect(findEmphasisRanges(evenSlashes)).toEqual([{ from: 2, to: 8 }])
    expect(normalize(docWith(paragraph(evenSlashes))).doc.textContent).toBe(String.raw`\\да`)
  })

  it('preserves authored formatting across text nodes and marker boundaries', () => {
    const typography = schema.mark('textStyle')
    const bold = schema.mark('bold')
    const doc = docWith(schema.node('paragraph', null, [
      schema.text('До "текст '),
      schema.text('жирным', [bold, typography]),
      schema.text('" и *'),
      schema.text('*важный', [bold]),
      schema.text(' текст** после'),
    ]))
    const result = normalize(doc)
    expect(result.doc.textContent).toBe('До текст жирным и важный текст после')
    expect(spans(result.doc).find(({ text }) => text === 'жирным')?.marks)
      .toEqual(expect.arrayContaining(['bold', 'textStyle', 'quotedText']))
    expect(spans(result.doc).find(({ text }) => text === 'важный')?.marks)
      .toEqual(expect.arrayContaining(['bold', 'emphasizedText']))
    expect(spans(result.doc).find(({ text }) => text === ' после')?.marks).toEqual([])
  })

  it('keeps paragraph boundaries, emoji and inline breaks in document coordinates', () => {
    const doc = docWith(
      paragraph('"нет **начала'),
      paragraph('пары" конца**'),
      schema.node('paragraph', null, [schema.text('«😀'), schema.node('hardBreak'), schema.text('да»')]),
      schema.node('paragraph', null, [schema.text('*еще'), schema.node('hardBreak'), schema.text('текст*')]),
    )
    const result = normalize(doc)
    expect(result.doc.child(0).textContent).toBe('"нет **начала')
    expect(result.doc.child(1).textContent).toBe('пары" конца**')
    expect(result.doc.child(2).textBetween(0, result.doc.child(2).content.size, '', '\n')).toBe('😀\nда')
    expect(result.doc.child(2).child(1).type.name).toBe('hardBreak')
    expect(result.doc.child(3).child(1).marks.map((mark) => mark.type.name)).toContain('emphasizedText')
  })

  it('stores highlights in JSON and restores the same marks and HTML classes', () => {
    const result = normalize(docWith(paragraph('"Цитата" и *важное*')))
    const saved = JSON.parse(JSON.stringify(result.doc.toJSON()))
    const loaded = schema.nodeFromJSON(saved)
    expect(loaded.eq(result.doc)).toBe(true)
    expect(normalizeHighlights(EditorState.create({ schema, doc: loaded }))).toBeNull()
    for (const [name, className] of [['quotedText', 'quoted-text'], ['emphasizedText', 'emphasized-text']]) {
      const type = schema.marks[name]
      expect(type.spec.inclusive).toBe(false)
      expect(type.spec.toDOM?.(type.create(), false)).toEqual(['span', { class: className }, 0])
      expect(type.spec.parseDOM).toEqual(expect.arrayContaining([expect.objectContaining({ tag: `span.${className}` })]))
    }
  })

  it('preserves literal syntax inside saved highlights and code', () => {
    const doc = docWith(schema.node('paragraph', null, [
      schema.text('"literal"', [schema.mark('quotedText')]),
      schema.text(' *stars*', [schema.mark('emphasizedText')]),
      schema.text(' **code**', [schema.mark('code')]),
      schema.text(' *new*'),
    ]))
    const result = normalize(doc)
    expect(result.doc.textContent).toBe('"literal" *stars* **code** new')
    expect(spans(result.doc)[0].marks).toContain('quotedText')
    expect(spans(result.doc)[1].marks).toContain('emphasizedText')
    expect(spans(result.doc)[2].marks).toContain('code')
    expect(normalizeHighlights(result)).toBeNull()
  })

  it('automatically converts on the final delimiter and continues outside the highlight', () => {
    let state = EditorState.create({ schema, doc: docWith(paragraph('**word')), plugins: plugin() })
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)))
    state = state.applyTransaction(state.tr.insertText('*')).state
    expect(state.doc.textContent).toBe('**word*')
    state = state.applyTransaction(state.tr.insertText('*')).state
    expect(state.doc.textContent).toBe('word')
    expect(state.selection.from).toBe(5)
    expect(state.selection.$from.marks()).toEqual([])
    state = state.applyTransaction(state.tr.insertText(' next')).state
    expect(spans(state.doc)).toEqual([
      { text: 'word', marks: ['emphasizedText'] },
      { text: ' next', marks: [] },
    ])
  })

  it('retains active typography while clearing highlight continuation at the closing marker', () => {
    const state = stateWith('*bold*')
    const active = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)).setStoredMarks([schema.mark('bold')]))
    const result = active.apply(normalizeHighlights(active)!)
    const continued = result.apply(result.tr.insertText(' next'))
    expect(spans(continued.doc)).toEqual([
      { text: 'bold', marks: ['emphasizedText'] },
      { text: ' next', marks: ['bold'] },
    ])
  })

  it('allows typed outer quotes and stars to wrap the other existing highlight', () => {
    for (const text of ['"before *orange* after"', '*before "quoted" after*']) {
      let state = EditorState.create({ schema, doc: docWith(paragraph('')), plugins: plugin() })
      for (const character of text) state = state.applyTransaction(state.tr.insertText(character)).state
      expect(state.doc.textContent).toBe(text.includes('orange') ? 'before orange after' : 'before quoted after')
      const inner = spans(state.doc).find(({ text: value }) => value === 'orange' || value === 'quoted')
      expect(inner?.marks).toEqual(expect.arrayContaining(['quotedText', 'emphasizedText']))
      expect(normalizeHighlights(state)).toBeNull()
    }
  })

  it('keeps undo restoration literal and redo restores persistent formatting', () => {
    let state = EditorState.create({ schema, doc: docWith(paragraph('**word**')), plugins: [history(), ...plugin()] })
    state = state.applyTransaction(closeHistory(normalizeHighlights(state)!)).state
    expect(state.doc.textContent).toBe('word')
    expect(undo(state, (transaction) => { state = state.applyTransaction(transaction).state })).toBe(true)
    expect(state.doc.textContent).toBe('**word**')
    expect(spans(state.doc)[0].marks).toEqual([])
    expect(redo(state, (transaction) => { state = state.applyTransaction(transaction).state })).toBe(true)
    expect(spans(state.doc)).toEqual([{ text: 'word', marks: ['emphasizedText'] }])
  })

  it('groups automatic normalization with the user edit in undo history', () => {
    let state = EditorState.create({ schema, doc: docWith(paragraph('')), plugins: [history(), ...plugin()] })
    state = state.applyTransaction(state.tr.insertText('"quoted" and *orange*')).state
    expect(state.doc.textContent).toBe('quoted and orange')
    undo(state, (transaction) => { state = state.applyTransaction(transaction).state })
    expect(state.doc.textContent).toBe('')
    redo(state, (transaction) => { state = state.applyTransaction(transaction).state })
    expect(state.doc.textContent).toBe('quoted and orange')
    expect(spans(state.doc).map(({ marks }) => marks)).toEqual([['quotedText'], [], ['emphasizedText']])
  })
})
