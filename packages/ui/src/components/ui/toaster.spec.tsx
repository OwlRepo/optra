/** @vitest-environment jsdom */

import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider, useToast, type ToastVariant } from './toaster'

afterEach(() => {
  cleanup()
})

function Emit({ variant }: { variant?: ToastVariant }) {
  const { toast } = useToast()
  React.useEffect(() => {
    toast({ title: 'Saved', description: 'All done', variant })
  }, [toast, variant])
  return null
}

function renderToast(variant?: ToastVariant) {
  render(
    <ToastProvider>
      <Emit variant={variant} />
    </ToastProvider>,
  )
}

describe('Toaster contrast', () => {
  it.each<ToastVariant>(['default', 'success', 'error', 'loading'])(
    'renders %s title with a neutral high-contrast foreground',
    (variant) => {
      renderToast(variant)
      expect(screen.getByText('Saved').className).toContain('text-foreground')
    },
  )

  it('does not tint the loading title with the same hue as its background', () => {
    renderToast('loading')
    // Regression: loading used text-primary on bg-primary/10 (unreadable).
    expect(screen.getByText('Saved').className).not.toContain('text-primary')
  })

  it('renders the description with a readable token, not low opacity', () => {
    renderToast('success')
    const description = screen.getByText('All done')
    expect(description.className).toContain('text-muted-foreground')
    expect(description.className).not.toContain('opacity-80')
  })
})
