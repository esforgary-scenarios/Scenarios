export const YOUTUBE_TITLE_LIMIT = 100
export const YOUTUBE_DESCRIPTION_LIMIT = 5000
export const YOUTUBE_TAGS_LIMIT = 500

/** YouTube counts separators and two implicit quotes around tags containing spaces. */
export function countTags(tags: string[]): number {
  return tags.reduce((total, tag) => total + tag.length + (tag.includes(' ') ? 2 : 0), Math.max(0, tags.length - 1))
}

export function parseTagInput(input: string): string[] {
  return input.split(/[,\r\n]+/).map(value => {
    const tag = value.trim()
    return tag.startsWith('"') && tag.endsWith('"') && tag.length >= 2 ? tag.slice(1, -1).trim() : tag
  }).filter(Boolean)
}

export function metadataTextError(text: string, limit: number): string {
  if (/[<>]/.test(text)) return 'YouTube не допускает символы < и >.'
  if (text.length > limit) return `Превышен лимит YouTube: максимум ${limit} символов.`
  return ''
}

/** A paste either adds all valid tags or leaves the existing list untouched. */
export function mergeTags(existing: string[], input: string): { tags: string[]; error: string } {
  const tags: string[] = []
  const seen = new Set<string>()
  for (const tag of [...existing, ...parseTagInput(input)]) {
    if (/[<>]/.test(tag)) return { tags: existing, error: 'YouTube не допускает символы < и > в тегах.' }
    const key = tag.toLowerCase()
    if (!seen.has(key)) {
      tags.push(tag)
      seen.add(key)
    }
  }
  if (countTags(tags) > YOUTUBE_TAGS_LIMIT) {
    return { tags: existing, error: 'Теги не добавлены: лимит YouTube — 500 символов с учётом запятых и кавычек у тегов с пробелами.' }
  }
  return { tags, error: '' }
}

export function tagsToClipboard(tags: string[]): string {
  return tags.join(', ')
}
