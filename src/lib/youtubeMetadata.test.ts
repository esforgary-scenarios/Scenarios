import { describe, expect, it } from 'vitest'
import {
  countTags, mergeTags, metadataTextError, parseTagInput, tagsToClipboard,
  YOUTUBE_DESCRIPTION_LIMIT, YOUTUBE_TAGS_LIMIT, YOUTUBE_TITLE_LIMIT,
} from './youtubeMetadata'

describe('YouTube text limits', () => {
  it.each([YOUTUBE_TITLE_LIMIT, YOUTUBE_DESCRIPTION_LIMIT])('accepts exactly %i characters and rejects the next character', limit => {
    expect(metadataTextError('я'.repeat(limit), limit)).toBe('')
    expect(metadataTextError('я'.repeat(limit + 1), limit)).toContain(String(limit))
  })

  it('uses the same UTF-16 length as the input maxlength for Unicode', () => {
    expect(metadataTextError('🎬'.repeat(50), YOUTUBE_TITLE_LIMIT)).toBe('')
    expect(metadataTextError('🎬'.repeat(50) + 'я', YOUTUBE_TITLE_LIMIT)).not.toBe('')
  })

  it.each(['<текст', 'текст>', '<>'])('rejects unsupported characters in %j', text => {
    expect(metadataTextError(text, YOUTUBE_DESCRIPTION_LIMIT)).toContain('< и >')
  })

  it('accepts blank text, line breaks, and other punctuation without rewriting them', () => {
    expect(metadataTextError('', YOUTUBE_TITLE_LIMIT)).toBe('')
    expect(metadataTextError('  Первая строка\nВторая & "третья" 😊  ', YOUTUBE_DESCRIPTION_LIMIT)).toBe('')
  })
})

describe('YouTube tags', () => {
  it('counts commas, quoted space-containing tags, and Unicode using UTF-16 length', () => {
    expect(countTags([])).toBe(0)
    expect(countTags(['cat'])).toBe(3)
    expect(countTags(['cat', 'funny cat'])).toBe(15)
    expect(countTags(['a b c'])).toBe(7)
    expect(countTags(['🎬', 'мой ролик'])).toBe(14)
  })

  it('parses comma and newline separated pasted tags, trimming matched double quotes', () => {
    expect(parseTagInput('  Кино, "мой ролик"\r\nсъёмка\n,, "" , " ещё тег "  ')).toEqual(['Кино', 'мой ролик', 'съёмка', 'ещё тег'])
    expect(parseTagInput('"unmatched, trailing"')).toEqual(['"unmatched', 'trailing"'])
  })

  it('deduplicates tags case-insensitively while preserving the first spelling and order', () => {
    const existing = ['Кино', 'Tutorial', 'кино']
    const before = [...existing]
    expect(mergeTags(existing, 'КИНО, tutorial, Монтаж, монтаж, новый тег')).toEqual({ tags: ['Кино', 'Tutorial', 'Монтаж', 'новый тег'], error: '' })
    expect(existing).toEqual(before)
  })

  it('accepts exactly 500 characters including separator and implicit quotes', () => {
    const tag = 'a'.repeat(YOUTUBE_TAGS_LIMIT - 6)
    expect(mergeTags([tag], 'a b')).toEqual({ tags: [tag, 'a b'], error: '' })
    expect(countTags([tag, 'a b'])).toBe(YOUTUBE_TAGS_LIMIT)
  })

  it('rejects the entire oversized paste without partially adding tags or changing the existing list', () => {
    const existing = ['Сценарий']
    const result = mergeTags(existing, `маленький, ${'я'.repeat(YOUTUBE_TAGS_LIMIT)}`)
    expect(result.tags).toBe(existing)
    expect(result.tags).toEqual(['Сценарий'])
    expect(result.error).toContain('500')
  })

  it.each(['valid, <bad>', 'valid\nbad>'])('rejects an invalid paste atomically: %j', input => {
    const existing = ['Кино']
    const result = mergeTags(existing, input)
    expect(result.tags).toBe(existing)
    expect(result.error).toContain('< и >')
  })

  it('does not charge duplicate tags against the length limit', () => {
    const tag = 'a'.repeat(YOUTUBE_TAGS_LIMIT)
    expect(mergeTags([tag], tag.toUpperCase())).toEqual({ tags: [tag], error: '' })
  })

  it('produces comma-separated clipboard text that can be pasted back', () => {
    const tags = ['Кино', 'мой ролик', '🎬']
    expect(tagsToClipboard(tags)).toBe('Кино, мой ролик, 🎬')
    expect(parseTagInput(tagsToClipboard(tags))).toEqual(tags)
    expect(tagsToClipboard([])).toBe('')
  })
})
