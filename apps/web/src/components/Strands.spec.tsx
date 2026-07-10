/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Strands from './Strands'

describe('Strands', () => {
  afterEach(() => {
    cleanup()
  })

  it('does not crash when WebGL is unavailable', () => {
    // Regression: ogl's Renderer does `this.gl.renderer = this` with no
    // null-check after failing to create a webgl2/webgl context, throwing
    // "Cannot set properties of null (setting 'renderer')". Found by /qa on
    // 2026-07-10 -- ThinkingIndicator (which renders Strands) crashed the
    // entire chat page to a full-page error boundary in a headless browser
    // with no GPU/WebGL support, a real failure mode outside test envs too
    // (corporate GPU policies, VMs, browser WebGL blacklists).
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    expect(() => render(React.createElement(Strands))).not.toThrow()

    getContextSpy.mockRestore()
  })
})
