import { describe, expect, it } from 'vitest'
import { fromRoman, nextInSeries, toRoman } from '@shared/titleSeries'

describe('roman numerals', () => {
  it('writes the subtractive forms', () => {
    expect([1, 4, 9, 14, 40, 90, 400, 1987].map(toRoman)).toEqual([
      'I',
      'IV',
      'IX',
      'XIV',
      'XL',
      'XC',
      'CD',
      'MCMLXXXVII'
    ])
  })

  it('reads them back', () => {
    for (const n of [1, 3, 4, 8, 14, 39, 44, 90, 400, 1987, 3999]) {
      expect(fromRoman(toRoman(n))).toBe(n)
    }
  })

  it('rejects text that is not a well-formed numeral', () => {
    expect(fromRoman('IIII')).toBeNull()
    expect(fromRoman('IC')).toBeNull()
    expect(fromRoman('Part')).toBeNull()
    expect(fromRoman('')).toBeNull()
  })

  it('leaves numbers outside the numeral range as digits', () => {
    expect(toRoman(0)).toBe('0')
    expect(toRoman(4000)).toBe('4000')
  })
})

describe('nextInSeries', () => {
  it('starts a series at part two', () => {
    expect(nextInSeries('The rooftop')).toBe('The rooftop - Part II')
  })

  it('continues an existing series', () => {
    expect(nextInSeries('The rooftop - Part II')).toBe('The rooftop - Part III')
    expect(nextInSeries('The rooftop - Part XIII')).toBe('The rooftop - Part XIV')
  })

  it('understands an arabic part typed by hand but answers in roman', () => {
    expect(nextInSeries('The rooftop - Part 2')).toBe('The rooftop - Part III')
  })

  it('accepts en and em dashes and loose spacing', () => {
    expect(nextInSeries('The rooftop — Part II')).toBe('The rooftop - Part III')
    expect(nextInSeries('The rooftop  -  Part  II ')).toBe('The rooftop - Part III')
  })

  it('names an untitled scene rather than producing a bare part', () => {
    expect(nextInSeries('')).toBe('Untitled scene - Part II')
  })

  it('does not mistake a dash inside the title for a part marker', () => {
    expect(nextInSeries('Rain - the long way home')).toBe('Rain - the long way home - Part II')
  })
})
