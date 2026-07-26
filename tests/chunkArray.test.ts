import { describe, it, expect } from 'vitest'
import { chunkArray, chunkProductsList } from '~/utils/chunkArray'

describe('chunkArray', () => {
  it('splits into fixed-size chunks', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('defaults to chunks of 50', () => {
    const arr = Array.from({ length: 120 }, (_, i) => i)
    const chunks = chunkArray(arr)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(50)
    expect(chunks[2]).toHaveLength(20)
  })

  it('returns an empty array for empty input', () => {
    expect(chunkArray([])).toEqual([])
  })

  it('keeps the whole array in one chunk when chunkSize exceeds length', () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]])
  })
})

describe('chunkProductsList', () => {
  it('uses a larger first page and fixed subsequent pages', () => {
    const items = Array.from({ length: 30 }, (_, i) => i)
    const pages = chunkProductsList(items, { first: 9, second: 15 }, 2)
    // first page grows by `fix` (2) because length > first + fix
    expect(pages[0]).toHaveLength(11)
    expect(pages[1]).toHaveLength(15)
    expect(pages[2]).toHaveLength(4)
  })

  it('does not grow the first page for small collections', () => {
    const items = Array.from({ length: 5 }, (_, i) => i)
    const pages = chunkProductsList(items, { first: 9, second: 15 }, 2)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toHaveLength(5)
  })

  it('returns no pages for an empty collection', () => {
    expect(chunkProductsList([])).toEqual([])
  })
})
