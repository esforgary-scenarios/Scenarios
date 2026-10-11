import type { Quote, QuoteColor } from '../types'

export const QUOTE_TEXT_LIMIT = 10000

export const QUOTE_COLORS: ReadonlyArray<{ value: QuoteColor; label: string; hex: string }> = [
  { value: 'default', label: 'Без метки', hex: '#d3dfae' },
  { value: 'red', label: 'Красный', hex: '#ff7b72' },
  { value: 'orange', label: 'Оранжевый', hex: '#ffa657' },
  { value: 'yellow', label: 'Жёлтый', hex: '#e3b341' },
  { value: 'green', label: 'Зелёный', hex: '#7ee787' },
  { value: 'blue', label: 'Синий', hex: '#79c0ff' },
  { value: 'purple', label: 'Фиолетовый', hex: '#d2a8ff' },
  { value: 'pink', label: 'Розовый', hex: '#ff9bce' },
]

function isQuoteColor(value: unknown): value is QuoteColor {
  return QUOTE_COLORS.some(color => color.value === value)
}

export function createQuote(value: string, color: QuoteColor = 'default'): Quote {
  const text = value.trim()
  if (!text) throw new Error('Введите текст цитаты.')
  if (text.length > QUOTE_TEXT_LIMIT) throw new Error(`Цитата может содержать до ${QUOTE_TEXT_LIMIT} символов.`)
  if (!isQuoteColor(color)) throw new Error('Выберите цвет цитаты из списка.')
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), text, color, createdAt: now, updatedAt: now }
}

/** Group by palette order while keeping the original order within each color. */
export function sortQuotesByColor(quotes: Quote[]): Quote[] {
  const colorOrder = new Map(QUOTE_COLORS.map((color, index) => [color.value, index]))
  return [...quotes].sort((a, b) => colorOrder.get(a.color ?? 'default')! - colorOrder.get(b.color ?? 'default')!)
}

/** Preserve stored text exactly; invalid records must never cause a partial overwrite. */
export function parseStoredQuotes(value: unknown): Quote[] {
  if (value === undefined) return []
  const error = 'Не удалось прочитать цитаты: неверный формат данных.'
  if (!Array.isArray(value)) throw new Error(error)
  const ids = new Set<string>()
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(error)
    const quote = item as Record<string, unknown>
    if (typeof quote.id !== 'string' || !quote.id || ids.has(quote.id)
      || typeof quote.text !== 'string' || typeof quote.createdAt !== 'string' || typeof quote.updatedAt !== 'string'
      || (quote.color !== undefined && !isQuoteColor(quote.color))) throw new Error(error)
    ids.add(quote.id)
    return { id: quote.id, text: quote.text, ...(quote.color === undefined ? {} : { color: quote.color as QuoteColor }), createdAt: quote.createdAt, updatedAt: quote.updatedAt }
  })
}
