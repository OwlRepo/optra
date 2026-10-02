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

function classesOf(element: Element | null) {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
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

  it('edge: every variant keeps its dismiss control', () => {
    const variants: ToastVariant[] = ['default', 'success', 'error', 'loading']
    for (const variant of variants) {
      renderToast(variant)
      expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeTruthy()
      cleanup()
    }
  })

  it('regression: renders the description in body ink, not low opacity', () => {
    renderToast('success')
    const description = classesOf(screen.getByText('All done'))
    expect(description).toEqual(expect.arrayContaining(['text-ink-body', 'text-[14px]']))
    expect(description).not.toContain('opacity-80')
  })

  it('regression: every toast is a white 14px card with the toast shadow and a toned 3px inset rule', () => {
    const rules: Record<ToastVariant, string> = {
      default: 'inset-shadow-[3px_0_0_var(--border-dashed)]',
      success: 'inset-shadow-[3px_0_0_var(--primary-strong)]',
      error: 'inset-shadow-[3px_0_0_var(--destructive-tone)]',
      loading: 'inset-shadow-[3px_0_0_var(--primary-strong)]/50',
    }
    for (const variant of Object.keys(rules) as ToastVariant[]) {
      renderToast(variant)
      const toast = classesOf(screen.getByRole('status'))
      expect(toast).toEqual(
        expect.arrayContaining(['rounded-[14px]', 'border', 'border-border-panel', 'bg-card', 'shadow-toast', 'px-4', 'py-[14px]', rules[variant]]),
      )
      expect(toast.some((name) => name.includes('backdrop-blur') || name.includes('emerald'))).toBe(false)
      cleanup()
    }
  })
})
