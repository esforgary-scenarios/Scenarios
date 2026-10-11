import { describe, expect, it } from 'vitest'
import type { Quote, QuoteColor } from '../types'
import { createQuote, parseStoredQuotes, QUOTE_COLORS, QUOTE_TEXT_LIMIT, sortQuotesByColor } from './quotes'

const quote = {
  id: 'saved-quote', text: '  Авторская мысль 🎬\n\nВторая строка  ',
  createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z',
}

describe('quote library data', () => {
  it('defaults the missing legacy collection to an empty library', () => {
    expect(parseStoredQuotes(undefined)).toEqual([])
    expect(parseStoredQuotes([])).toEqual([])
  })

  it('round-trips quote text, order and timestamps without mutating authored content', () => {
    const input = [quote, { ...quote, id: 'other-quote', text: '<Мысль>\nСо своими  пробелами' }]
    const before = JSON.stringify(input)
    const parsed = parseStoredQuotes(input)
    expect(parsed).toEqual(input)
    expect(parseStoredQuotes(JSON.parse(JSON.stringify(parsed)))).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('keeps legacy quotes unmarked and round-trips every supported color', () => {
    const input = [quote, ...QUOTE_COLORS.map(color => ({ ...quote, id: `quote-${color.value}`, color: color.value }))]
    const parsed = parseStoredQuotes(JSON.parse(JSON.stringify(input)))
    expect(parsed).toEqual(input)
    expect(parsed[0]).not.toHaveProperty('color')
  })

  it.each(['', 'cyan', '#ff0000', null, 42, {}, ['red']])('rejects an unsupported stored color atomically: %j', color => {
    const input = [quote, { ...quote, id: 'invalid-color', color }]
    const before = JSON.stringify(input)
    expect(() => parseStoredQuotes(input)).toThrow('Не удалось прочитать цитаты')
    expect(JSON.stringify(input)).toBe(before)
  })

  it('sorts by palette order without mutating or reordering quotes within a color', () => {
    const input: Quote[] = [
      { ...quote, id: 'blue-first', color: 'blue' },
      { ...quote, id: 'legacy' },
      { ...quote, id: 'pink', color: 'pink' },
      { ...quote, id: 'red-first', color: 'red' },
      { ...quote, id: 'blue-second', color: 'blue' },
      { ...quote, id: 'default', color: 'default' },
      { ...quote, id: 'purple', color: 'purple' },
      { ...quote, id: 'green', color: 'green' },
      { ...quote, id: 'yellow', color: 'yellow' },
      { ...quote, id: 'orange', color: 'orange' },
      { ...quote, id: 'red-second', color: 'red' },
    ]
    const before = JSON.stringify(input)
    const sorted = sortQuotesByColor(input)
    expect(sorted.map(item => item.id)).toEqual([
      'legacy', 'default', 'red-first', 'red-second', 'orange', 'yellow',
      'green', 'blue-first', 'blue-second', 'purple', 'pink',
    ])
    expect(JSON.stringify(input)).toBe(before)
    expect(sorted).not.toBe(input)
    expect(sortQuotesByColor([])).toEqual([])
  })

  it('preserves existing text beyond the editor limit', () => {
    const archived = { ...quote, text: 'я'.repeat(QUOTE_TEXT_LIMIT + 1) }
    expect(parseStoredQuotes([archived])).toEqual([archived])
  })

  it('rejects duplicate or empty quote IDs rather than accepting an ambiguous library', () => {
    expect(() => parseStoredQuotes([quote, { ...quote, text: 'Другая мысль' }])).toThrow()
    expect(() => parseStoredQuotes([{ ...quote, id: '' }])).toThrow()
  })

  it.each([null, {}, 'quotes', 42, [null], [false], [{ ...quote, id: 1 }], [{ ...quote, text: null }], [{ ...quote, createdAt: false }], [{ ...quote, updatedAt: {} }]])(
    'rejects malformed stored data atomically: %j', value => {
      const input = Array.isArray(value) ? [quote, ...value] : value
      const before = JSON.stringify(input)
      expect(() => parseStoredQuotes(input)).toThrow()
      expect(JSON.stringify(input)).toBe(before)
    },
  )

  it('creates a quote with outer whitespace trimmed and internal formatting retained', () => {
    const created = createQuote(' \n Первая мысль 🎬\n\nВторая  строка \n ')
    expect(created.text).toBe('Первая мысль 🎬\n\nВторая  строка')
    expect(created.id).toBeTruthy()
    expect(created.createdAt).toBe(created.updatedAt)
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false)
    expect(createQuote('Ещё мысль').id).not.toBe(created.id)
    expect(created.color).toBe('default')
  })

  it('creates a quote with the chosen color and rejects invalid runtime colors', () => {
    expect(createQuote('Цветная мысль', 'orange').color).toBe('orange')
    expect(() => createQuote('Цветная мысль', 'cyan' as QuoteColor)).toThrow('Выберите цвет цитаты')
  })

  it.each(['', '  ', '\n\t'])('rejects blank new quotes: %j', text => {
    expect(() => createQuote(text)).toThrow()
  })

  it('accepts the maximum text length and rejects larger new quotes', () => {
    expect(QUOTE_TEXT_LIMIT).toBe(10000)
    expect(createQuote('я'.repeat(QUOTE_TEXT_LIMIT)).text).toHaveLength(QUOTE_TEXT_LIMIT)
    expect(() => createQuote('я'.repeat(QUOTE_TEXT_LIMIT + 1))).toThrow()
  })
})
