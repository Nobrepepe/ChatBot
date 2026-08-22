import { describe, it, expect } from 'vitest'
import { parseEmotion, parseSpeakerPrefix, stripWirePrefixes } from '@shared/wireFormat'

describe('parseEmotion', () => {
  it('splits a leading emotion tag', () => {
    expect(parseEmotion('[sad] Not really.')).toEqual({ emotion: 'sad', rest: 'Not really.' })
  })

  it('lowercases and trims the tag', () => {
    expect(parseEmotion('  [ Sad ] hi')).toEqual({ emotion: 'sad', rest: 'hi' })
  })

  it('honors an allow-list when given', () => {
    expect(parseEmotion('[sad] hi', ['sad'])).toEqual({ emotion: 'sad', rest: 'hi' })
    expect(parseEmotion('[unknown] hi', ['sad'])).toEqual({ emotion: '', rest: '[unknown] hi' })
  })

  it('ignores tags longer than 64 chars and non-leading brackets', () => {
    expect(parseEmotion(`[${'x'.repeat(65)}] hi`).emotion).toBe('')
    expect(parseEmotion('well [sad] hi').emotion).toBe('')
  })
})

describe('parseSpeakerPrefix', () => {
  it('detects a {Name} prefix case-insensitively against the cast', () => {
    expect(parseSpeakerPrefix('{lirael} "Hello."', ['Lirael', 'Morgana'])).toEqual({
      name: 'Lirael',
      rest: '"Hello."'
    })
  })

  it('rejects names not in the cast', () => {
    expect(parseSpeakerPrefix('{Stranger} hi', ['Lirael'])).toBeNull()
  })

  it('returns the raw name without a cast list', () => {
    expect(parseSpeakerPrefix('{Someone} hi')).toEqual({ name: 'Someone', rest: 'hi' })
  })
})

describe('stripWirePrefixes', () => {
  it('strips speaker then emotion', () => {
    expect(stripWirePrefixes('{Lirael} [sad] "Not really."', ['Lirael'], ['sad'])).toEqual({
      speaker: 'Lirael',
      emotion: 'sad',
      content: '"Not really."'
    })
  })

  it('handles plain text', () => {
    expect(stripWirePrefixes('Just words.')).toEqual({
      speaker: null,
      emotion: '',
      content: 'Just words.'
    })
  })
})
