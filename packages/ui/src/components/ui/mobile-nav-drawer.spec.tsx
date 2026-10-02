/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNavDrawer } from './mobile-nav-drawer'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('MobileNavDrawer', () => {
  it('edge: renders nothing when closed', () => {
    render(
      <MobileNavDrawer
        open={false}
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('edge: renders no user footer content when omitted', () => {
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('edge: renders no logout button when onLogout is omitted', () => {
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('edge: does not call onClose when the panel itself is clicked', () => {
    const onClose = vi.fn()
    render(
      <MobileNavDrawer
        open
        onClose={onClose}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('edge: locks body scroll while open and restores it on close', () => {
    const { rerender } = render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <MobileNavDrawer
        open={false}
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    expect(document.body.style.overflow).toBe('')
  })

  it('regression: the scrim is ink at 40% with a 4px blur, matching the modal backdrop', () => {
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    const scrim = screen.getByTestId('mobile-nav-scrim')
    expect(scrim.classList.contains('bg-foreground/40')).toBe(true)
    expect(scrim.classList.contains('backdrop-blur-[4px]')).toBe(true)
  })

  it('regression: the panel is the 300px sidebar surface', () => {
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.classList.contains('w-[300px]')).toBe(true)
    expect(dialog.classList.contains('bg-secondary')).toBe(true)
  })

  it('regression: the close button is a 40px bordered target in the brand row', () => {
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    const close = screen.getByRole('button', { name: 'Close navigation' })
    expect(close.classList.contains('size-10')).toBe(true)
    const row = close.parentElement as HTMLElement
    expect(row).not.toBe(screen.getByRole('dialog'))
    expect(row.contains(screen.getByText('Header'))).toBe(true)
  })

  it('regression: navigation links get 44px targets in the drawer', () => {
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    const wrapper = screen.getByText('Nav').parentElement as HTMLElement
    expect(wrapper.className).toContain('[&_a]:min-h-11')
  })

  it('regression: calls navigation and sidebarHeader with collapsed: false (drawer always shows full labels)', () => {
    const navigation = vi.fn(() => <span>Nav</span>)
    const sidebarHeader = vi.fn(() => <span>Header</span>)

    render(<MobileNavDrawer open onClose={() => {}} sidebarHeader={sidebarHeader} navigation={navigation} />)

    expect(navigation).toHaveBeenCalledWith({ collapsed: false })
    expect(sidebarHeader).toHaveBeenCalledWith({ collapsed: false })
  })

  it('happy: renders sidebar header, navigation, and user footer content when open', () => {
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        userFooter={() => <span>Footer</span>}
      />,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Header')).toBeTruthy()
    expect(screen.getByText('Nav')).toBeTruthy()
    expect(screen.getByText('Footer')).toBeTruthy()
  })

  it('happy: calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <MobileNavDrawer
        open
        onClose={onClose}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('happy: calls onClose when the scrim is clicked', () => {
    const onClose = vi.fn()
    render(
      <MobileNavDrawer
        open
        onClose={onClose}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    fireEvent.click(screen.getByTestId('mobile-nav-scrim'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('happy: calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <MobileNavDrawer
        open
        onClose={onClose}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('happy: renders a logout button when onLogout is passed and calls it once when clicked', () => {
    const onLogout = vi.fn()
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        onLogout={onLogout}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})
