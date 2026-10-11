import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import { isHistoryTransaction } from '@tiptap/pm/history'
import type { MarkType } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'

export type QuoteRange = { from: number; to: number }
type HighlightRange = QuoteRange & { width: number; mark: MarkType }

function isEscaped(text: string, position: number): boolean {
  let slashes = 0
  for (let index = position - 1; index >= 0 && text[index] === '\\'; index -= 1) slashes += 1
  return slashes % 2 === 1
}

/** Offsets include the delimiters and use UTF-16, like document positions. */
export function findQuoteRanges(text: string): QuoteRange[] {
  const opening: Record<string, string> = { '«': '»', '“': '”' }
  const stack: Array<{ character: string; position: number }> = []
  const ranges: QuoteRange[] = []

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (!['"', '«', '»', '“', '”'].includes(character) || isEscaped(text, index)) continue

    const last = stack[stack.length - 1]
    if (last && (character === '"' && last.character === '"' || opening[last.character] === character)) {
      stack.pop()
      // Wait for the outer pair, retaining any inner quotation punctuation.
      if (!stack.length && index > last.position + 1) ranges.push({ from: last.position, to: index + 1 })
    } else if (character === '"' || opening[character]) {
      stack.push({ character, position: index })
    }
  }
  return ranges
}

/** A double-star opening must wait for a double-star closing. */
export function findEmphasisRanges(text: string): QuoteRange[] {
  const ranges: QuoteRange[] = []
  let opening: { position: number; width: number } | null = null
  for (let index = 0; index < text.length;) {
    if (text[index] !== '*') {
      index += 1
      continue
    }
    let end = index + 1
    while (text[end] === '*') end += 1
    if (!isEscaped(text, index)) {
      let remaining = end - index
      if (opening && remaining >= opening.width) {
        ranges.push({ from: opening.position, to: index + opening.width })
        index += opening.width
        remaining -= opening.width
        opening = null
      }
      // Longer runs without an opening are ambiguous or empty delimiters.
      if (!opening && (remaining === 1 || remaining === 2)) opening = { position: index, width: remaining }
    }
    index = end
  }
  return ranges
}

function highlightMark(name: string, className: string) {
  return Mark.create({
    name,
    inclusive: false,
    parseHTML: () => [{ tag: `span.${className}` }],
    renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: className }), 0],
  })
}

const QuotedText = highlightMark('quotedText', 'quoted-text')
const EmphasizedText = highlightMark('emphasizedText', 'emphasized-text')
const highlightNames = new Set(['quotedText', 'emphasizedText'])

/** Replace complete literal pairs with persistent marks, preserving their contents. */
export function normalizeHighlights(state: EditorState, changedRanges?: QuoteRange[]): Transaction | null {
  const { quotedText, emphasizedText } = state.schema.marks
  if (!quotedText || !emphasizedText) return null

  const matches: HighlightRange[] = []
  state.doc.descendants((block, blockPosition) => {
    if (!block.isTextblock) return true
    if (!block.type.allowsMarkType(quotedText) || !block.type.allowsMarkType(emphasizedText)) return false

    for (const [findRanges, mark] of [
      [findQuoteRanges, quotedText],
      [findEmphasisRanges, emphasizedText],
    ] as const) {
      let text = ''
      let positions: number[] = []
      const collect = () => {
        for (const range of findRanges(text)) {
          const from = positions[range.from]
          const to = positions[range.to - 1] + 1
          // Formatting removal must not reinterpret preserved punctuation, nor
          // should a later edit elsewhere in the document reinterpret it.
          if (changedRanges && !changedRanges.some((changed) => changed.from < to && changed.to > from)) continue
          const width = mark === emphasizedText && text.slice(range.from, range.from + 2) === '**' ? 2 : 1
          matches.push({ from, to, width, mark })
        }
        text = ''
        positions = []
      }

      block.descendants((node, offset) => {
        // Do not reinterpret this mark's saved punctuation. The other highlight
        // can still participate in an enclosing pair, just like bold text.
        if (node.marks.some((existing) => existing.type === mark || existing.type.spec.code)) {
          collect()
          return false
        }
        if (node.isText) {
          const value = node.text ?? ''
          for (let index = 0; index < value.length; index += 1) positions.push(blockPosition + 1 + offset + index)
          text += value
        } else if (node.isInline && node.isLeaf) {
          positions.push(blockPosition + 1 + offset)
          text += '\uFFFC'
        }
        return true
      })
      collect()
    }
    return false
  })
  if (!matches.length) return null

  const transaction = state.tr
  const delimiters: QuoteRange[] = []
  for (const { from, to, width, mark } of matches) {
    transaction.addMark(from + width, to - width, mark.create())
    delimiters.push({ from, to: from + width }, { from: to - width, to })
  }
  // Mark first; descending deletions then preserve all original document positions.
  for (const { from, to } of delimiters.sort((a, b) => b.from - a.from)) transaction.delete(from, to)

  if (state.storedMarks) {
    const atClosing = state.selection.empty && matches.some(({ to }) => to === state.selection.from)
    transaction.setStoredMarks(atClosing
      ? state.storedMarks.filter((mark) => !highlightNames.has(mark.type.name))
      : state.storedMarks)
  }
  return transaction
}

export const QuoteHighlight = Extension.create({
  name: 'quoteHighlight',
  addExtensions: () => [QuotedText, EmphasizedText],
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('quoteHighlight'),
      props: {
        handleKeyDown: (view, event) => {
          if (!view.editable || event.isComposing || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return false
          // Physical digit keys work with both English and Russian layouts.
          const mark = event.code === 'Digit1' ? 'quotedText' : event.code === 'Digit2' ? 'emphasizedText' : null
          if (!mark) return false
          if (!event.repeat && !this.editor.commands.toggleMark(mark)) return false
          event.preventDefault()
          return true
        },
      },
      appendTransaction(transactions, oldState, state) {
        if (!transactions.some((transaction) => transaction.docChanged)
          || transactions.some((transaction) => {
            const original = transaction.getMeta('appendedTransaction') as Transaction | undefined
            return isHistoryTransaction(transaction) || original && isHistoryTransaction(original)
          })) return null
        const mapping = new Mapping(transactions.flatMap((change) => change.mapping.maps))
        const changedRanges: QuoteRange[] = []
        mapping.maps.forEach((map, index) => map.forEach((_oldFrom, _oldTo, from, to) => {
          const remaining = mapping.slice(index + 1)
          changedRanges.push({ from: remaining.map(from, -1), to: remaining.map(to, 1) })
        }))
        let transaction = changedRanges.length ? normalizeHighlights(state, changedRanges) : null
        // Non-inclusive marks stop automatic highlights at their closing marker.
        // Explicit toolbar/shortcut marks must instead survive successive edits,
        // because ProseMirror clears stored marks when it inserts text.
        if (oldState.selection.empty && state.selection.empty && state.storedMarks === null) {
          const mappedCaret = transactions.reduce((position, change) => change.mapping.map(position), oldState.selection.from)
          if (mappedCaret === state.selection.from) {
            for (const mark of oldState.storedMarks ?? []) {
              if (!highlightNames.has(mark.type.name) || !state.selection.$from.parent.type.allowsMarkType(mark.type)) continue
              const currentMarks = transaction
                ? transaction.storedMarks ?? transaction.selection.$from.marks()
                : state.selection.$from.marks()
              if (!mark.type.isInSet(currentMarks) && currentMarks.some((current) => current.type.excludes(mark.type))) continue
              transaction ??= state.tr
              transaction.addStoredMark(mark)
            }
          }
        }
        return transaction
      },
    })]
  },
})
