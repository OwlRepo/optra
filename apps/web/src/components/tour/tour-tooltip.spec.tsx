/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LoaderRenderProps, TooltipRenderProps } from 'react-joyride'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TourContext, type TourContextValue } from './tour-context'
import { TourLoader, TourTooltip } from './tour-tooltip'
import type { TourStepData } from './tour-steps'

afterEach(cleanup)

function makeProps(data: Partial<TourStepData>, overrides: { index?: number; size?: number } = {}): TooltipRenderProps {
  const handlers = { onClick: vi.fn() }
  return {
    index: overrides.index ?? 3,
    size: overrides.size ?? 10,
    isLastStep: false,
    continuous: true,
    step: {
      id: 'x',
      title: 'Title',
      content: 'Body',
      data: { chapter: 'sample', interactive: false, canGoBack: true, ...data },
    },
    backProps: { 'aria-label': 'Back', 'data-action': 'prev', role: 'button', title: 'Back', ...handlers, children: 'Back' },
    primaryProps: { 'aria-label': 'Next', 'data-action': 'primary', role: 'button', title: 'Next', ...handlers, children: 'Next' },
    skipProps: { 'aria-label': 'Skip tour', 'data-action': 'skip', role: 'button', title: 'Skip tour', ...handlers, children: 'Skip tour' },
    closeProps: { 'aria-label': 'Close', 'data-action': 'close', role: 'button', title: 'Close', ...handlers },
    tooltipProps: { 'aria-modal': true, role: 'dialog' },
  } as unknown as TooltipRenderProps
}

function renderTooltip(props: TooltipRenderProps, value: Partial<TourContextValue> = {}) {
  const context: TourContextValue = {
    startTour: vi.fn(),
    isRunning: true,
    performStageAction: vi.fn(),
    ...value,
  }
  const view = render(
    <TourContext.Provider value={context}>
      <TourTooltip {...props} />
    </TourContext.Provider>,
  )
  return { context, ...view }
}

const interactive = { interactive: true, actionLabel: 'Run comparison', hint: 'Tap the highlighted control or use the button', canGoBack: false }

describe('TourTooltip', () => {
  it('error: an interactive step without a context does not throw when its action button is pressed', () => {
    const props = makeProps(interactive)
    render(<TourTooltip {...props} />)

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))).not.toThrow()
  })

  it('edge: an interactive step shows the action button and hint, and no Next or Back', () => {
    renderTooltip(makeProps(interactive))

    expect(screen.getByRole('button', { name: 'Run comparison' })).toBeDefined()
    expect(screen.getByText('Tap the highlighted control or use the button')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Skip tour' })).toBeDefined()
  })

  it('edge: the action button is solid primary-strong', () => {
    renderTooltip(makeProps(interactive))
    expect(screen.getByRole('button', { name: 'Run comparison' }).className).toContain('bg-primary-strong')
  })

  it('edge: Back is hidden when the step cannot go back, shown otherwise', () => {
    const hidden = renderTooltip(makeProps({ canGoBack: false }))
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDefined()
    hidden.unmount()

    renderTooltip(makeProps({ canGoBack: true }))
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined()
  })

  it('edge: no Back on the very first step', () => {
    renderTooltip(makeProps({ canGoBack: true }, { index: 0 }))
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('regression: the interactive hint sits in the body on its own line, not squeezed into the footer', () => {
    // In the footer it wrapped into a narrow uppercase column and was clipped.
    renderTooltip(makeProps(interactive))
    const hint = screen.getByText('Tap the highlighted control or use the button')
    expect(hint.closest('[data-part="body"]')).not.toBeNull()
    expect(hint.closest('[data-part="footer"]')).toBeNull()
  })

  it('regression: the step counter uses text-ink-ghost and no arbitrary 6px radius is used', () => {
    const { container } = renderTooltip(makeProps({}))
    const counter = screen.getByText('Step 4 of 10')
    expect(counter.className).toContain('text-ink-ghost')
    expect(container.innerHTML).not.toContain('rounded-[6px]')
  })
})

describe('TourLoader', () => {
  const loaderProps = (data: Partial<TourStepData>) =>
    ({ step: { data: { chapter: 'core', interactive: false, canGoBack: true, ...data } } }) as unknown as LoaderRenderProps

  it('edge: falls back to a generic label when the step names no destination', () => {
    render(<TourLoader {...loaderProps({})} />)
    expect(screen.getByRole('status').textContent).toMatch(/Loading/)
  })

  it('happy: names the destination, with a hairline border and the fade-slide-in entrance', () => {
    render(<TourLoader {...loaderProps({ loaderLabel: 'Opening Discrepancies…' })} />)

    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Opening Discrepancies…')
    expect(status.className).toContain('border')
    expect(status.className).toContain('border-border-panel')
    expect(status.className).toContain('fade-slide-in')
  })
})

// Happy paths last, so every file declares error > edge > regression > happy.
describe('TourTooltip happy path', () => {
  it('happy: pressing the action button performs the stage action for this step id', () => {
    const props = makeProps(interactive)
    const { context } = renderTooltip({ ...props, step: { ...props.step, id: 'sample-run' } } as TooltipRenderProps)

    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))

    expect(context.performStageAction).toHaveBeenCalledWith('sample-run')
  })
})
