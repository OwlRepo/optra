import { afterEach, describe, expect, it, vi } from 'vitest'
import { countTokens } from './tokens'

const { freeMock, encodeMock, getEncodingMock } = vi.hoisted(() => {
  const freeMock = vi.fn()
  const encodeMock = vi.fn()
  const getEncodingMock = vi.fn(() => ({
    encode: encodeMock,
    free: freeMock,
  }))

  return { freeMock, encodeMock, getEncodingMock }
})

vi.mock('tiktoken', () => ({
  get_encoding: getEncodingMock,
}))

describe('countTokens', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('counts encoded tokens and frees encoder', () => {
    encodeMock.mockReturnValue([1, 2, 3, 4])

    expect(countTokens('hello world')).toBe(4)
    expect(getEncodingMock).toHaveBeenCalledWith('cl100k_base')
    expect(encodeMock).toHaveBeenCalledWith('hello world')
    expect(freeMock).toHaveBeenCalledTimes(1)
  })
})
