import { describe, expect, it } from 'vitest'
import { parseGoogleFontUrl } from './fonts'

describe('Google Fonts links', () => {
  it('converts a specimen URL into one canonical stylesheet without tracking parameters', () => {
    const font = parseGoogleFontUrl(' https://fonts.google.com/specimen/Roboto+Slab?query=roboto ')
    expect(font.family).toBe('Roboto Slab')
    expect(font.cssUrl).toBe('https://fonts.googleapis.com/css2?family=Roboto+Slab&display=swap')
    expect(font.id).toBe(parseGoogleFontUrl('https://fonts.google.com/specimen/Roboto%20Slab/').id)
  })

  it('keeps explicit font weight and italic axes and removes text subsets', () => {
    const font = parseGoogleFontUrl('https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&text=Hello&display=block')
    const url = new URL(font.cssUrl)
    expect(font.family).toBe('Roboto')
    expect(url.searchParams.get('family')).toBe('Roboto:ital,wght@0,100..900;1,100..900')
    expect(url.searchParams.has('text')).toBe(false)
    expect(url.searchParams.get('display')).toBe('swap')
  })

  it('rejects multiple families instead of silently saving the wrong font', () => {
    expect(() => parseGoogleFontUrl('https://fonts.googleapis.com/css2?family=Roboto&family=Oswald')).toThrow('по одному')
  })

  it.each([
    'javascript:alert(1)',
    'data:text/css,body{color:red}',
    'http://fonts.google.com/specimen/Roboto',
    'https://fonts.google.com.evil.test/specimen/Roboto',
    'https://fonts.googleapis.com.evil.test/css2?family=Roboto',
    'https://fonts.google.com@evil.test/specimen/Roboto',
    'https://user:password@fonts.google.com/specimen/Roboto',
    'https://fonts.google.com:444/specimen/Roboto',
    'https://fonts.google.com/specimen/Roboto#fragment',
    'https://fonts.google.com/specimen/Roboto/other',
    'https://fonts.google.com/specimen/Roboto%2Fother',
    'https://fonts.google.com/specimen/%ZZ',
    'https://fonts.google.com/specimen/Roboto\\evil',
    'https://fonts.google.com/specimen/Ro\nboto',
    'https://fonts.google.com/specimen/%22%3Bbackground%3Aurl(test)',
    'https://fonts.googleapis.com/css2?family=Roboto%22%3B%7Dbody%7Bdisplay:none',
    'https://fonts.googleapis.com/css2?family=Roboto:invalid',
    'https://fonts.googleapis.com/css2?family=Roboto:wght@700:bad',
    'https://fonts.googleapis.com/css2?family=',
    'https://fonts.googleapis.com/other?family=Roboto',
  ])('rejects unsafe or unsupported URL %s', value => {
    expect(() => parseGoogleFontUrl(value)).toThrow()
  })
})
