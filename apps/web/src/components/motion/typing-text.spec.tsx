/** @vitest-environment jsdom */

import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TypingText } from './typing-text'

describe('TypingText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('always exposes the full text to assistive tech via a visually-hidden node', () => {
    const { container } = render(<TypingText text="Hello there" />)

    const hidden = container.querySelector('.sr-only')
    expect(hidden?.textContent).toBe('Hello there')
  })

  it('reveals the full text immediately when the user prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))

    const { container } = render(<TypingText text="Hello there" />)

    const visible = container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(visible).not.toBeNull()
    await waitFor(() => expect(visible.textContent).toContain('Hello there'))
  })
})
