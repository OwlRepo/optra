/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

describe('AppShell', () => {
  it('error: swallows a rejected onLogout so the click never surfaces an unhandled rejection', async () => {
    const onLogout = vi.fn(() => Promise.reject(new Error('network down')))

    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>} onLogout={onLogout}>
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    await Promise.resolve()

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('edge: renders no top bar when breadcrumb, title, description, badge and actions are omitted', () => {
    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>}>
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('edge: renders no logout button when onLogout is omitted', () => {
    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>}>
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('edge: below lg the actions render once, as a full-width block at the top of main, not in the header', () => {
    stubViewport(false)

    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        title="Purchase orders"
        actions={<button type="button">Upload purchase order</button>}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.getAllByRole('button', { name: 'Upload purchase order' })).toHaveLength(1)
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Upload purchase order' })).toBeTruthy()
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Upload purchase order' })).toBeNull()
  })

  it('edge: hideMobileActions drops the below-lg actions block so the page can place its own', () => {
    stubViewport(false)

    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        title="Purchase orders"
        hideMobileActions
        actions={<button type="button">Upload purchase order</button>}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.queryByRole('button', { name: 'Upload purchase order' })).toBeNull()
    expect(within(screen.getByRole('main')).getByText('Body')).toBeTruthy()
  })

  it('edge: hideMobileActions leaves the header actions in place at lg and up', () => {
    stubViewport(true)

    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        title="Purchase orders"
        hideMobileActions
        actions={<button type="button">Upload purchase order</button>}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Upload purchase order' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Upload purchase order' })).toHaveLength(1)
  })

  it('edge: mobileFullBleed hides the header below lg and renders neither the hamburger nor the tab bar', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        title="Assistant"
        mobileFullBleed
        mobileTabBar={() => <nav aria-label="Primary">Tabs</nav>}
      >
        <div>Body</div>
      </AppShell>,
    )

    const banner = screen.getByRole('banner')
    expect(banner.classList.contains('hidden')).toBe(true)
    expect(banner.classList.contains('lg:block')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
  })

  it('regression: renders the breadcrumb as a micro label above an h1 page title', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        breadcrumb="Kestrel Supply Co. / Matching"
        title="Discrepancies"
      >
        <div>Body</div>
      </AppShell>,
    )

    const banner = screen.getByRole('banner')
    expect(within(banner).getByText('Kestrel Supply Co. / Matching').closest('p')).not.toBeNull()
    expect(within(banner).getByRole('heading', { level: 1, name: 'Discrepancies' })).toBeTruthy()
  })

  it('regression: the expanded sidebar is 248px on the secondary surface with a hairline border', () => {
    const { container } = render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>}>
        <div>Body</div>
      </AppShell>,
    )

    const aside = container.querySelector('aside') as HTMLElement
    expect(aside.classList.contains('w-[248px]')).toBe(true)
    expect(aside.classList.contains('bg-secondary')).toBe(true)
    expect(aside.classList.contains('border-border')).toBe(true)
  })

  it('regression: the collapsed rail is 64px with 40px Log out and Expand targets stacked under a rule', () => {
    const { container } = render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>} onLogout={() => {}}>
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    const aside = container.querySelector('aside') as HTMLElement
    const expand = screen.getByRole('button', { name: 'Expand sidebar' })
    const logout = screen.getByRole('button', { name: 'Log out' })
    expect(aside.classList.contains('w-16')).toBe(true)
    expect(expand.classList.contains('size-10')).toBe(true)
    expect(logout.classList.contains('size-10')).toBe(true)
    const row = expand.parentElement as HTMLElement
    expect(row.classList.contains('flex-col')).toBe(true)
    expect(row.classList.contains('border-t')).toBe(true)
  })

  it('regression: keeps the footer controls in a row under a top rule when expanded', () => {
    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>} onLogout={() => {}}>
        <div>Body</div>
      </AppShell>,
    )

    const row = screen.getByRole('button', { name: 'Collapse sidebar' }).parentElement as HTMLElement
    expect(row.className).not.toContain('flex-col')
    expect(row.classList.contains('border-t')).toBe(true)
    expect(row.contains(screen.getByRole('button', { name: 'Log out' }))).toBe(true)
  })

  it('regression: stacks the footer controls in a column when collapsed so both stay clickable', () => {
    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>} onLogout={() => {}}>
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    const row = screen.getByRole('button', { name: 'Expand sidebar' }).parentElement as HTMLElement
    expect(row.className).toContain('flex-col')
    expect(screen.getByRole('button', { name: 'Log out' }).hasAttribute('disabled')).toBe(false)
  })

  it('regression: centers the sidebar header when collapsed', () => {
    render(
      <AppShell
        sidebarHeader={({ collapsed }) => <span>{collapsed ? 'collapsed-header' : 'expanded-header'}</span>}
        navigation={() => <span>Nav</span>}
      >
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    const wrapper = screen.getByText('collapsed-header').parentElement as HTMLElement
    expect(wrapper.className).toContain('justify-center')
  })

  it('regression: the header description is hidden below lg', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        title="Workspace"
        description="Overview"
      >
        <div>Body</div>
      </AppShell>,
    )

    const description = screen.getByText('Overview')
    expect(description.classList.contains('hidden')).toBe(true)
    expect(description.classList.contains('lg:block')).toBe(true)
  })

  it('regression: main carries the frame padding and clears the tab bar below lg', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        mobileTabBar={({ moreActive, onMoreClick }) => (
          <button type="button" aria-pressed={moreActive} onClick={onMoreClick}>
            More
          </button>
        )}
      >
        <div>Body</div>
      </AppShell>,
    )

    const main = screen.getByRole('main')
    expect(main.classList.contains('lg:px-10')).toBe(true)
    expect(main.classList.contains('lg:pt-8')).toBe(true)
    expect(main.classList.contains('lg:pb-12')).toBe(true)
    expect(main.classList.contains('pb-[100px]')).toBe(true)
  })

  it('happy: renders sidebar header and navigation with collapsed false on initial render', () => {
    render(
      <AppShell
        sidebarHeader={({ collapsed }) => <span>{collapsed ? 'collapsed-header' : 'expanded-header'}</span>}
        navigation={({ collapsed }) => <span>{collapsed ? 'collapsed-nav' : 'expanded-nav'}</span>}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.getByText('expanded-header')).toBeTruthy()
    expect(screen.getByText('expanded-nav')).toBeTruthy()
  })

  it('happy: renders children in main content area', () => {
    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>}>
        <div>Body content</div>
      </AppShell>,
    )

    expect(within(screen.getByRole('main')).getByText('Body content')).toBeTruthy()
  })

  it('happy: renders top bar title, description, badge, and actions in the header at lg and up', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        title="Workspace"
        description="Overview"
        badge={<span>owner</span>}
        actions={<button type="button">Action</button>}
      >
        <div>Body</div>
      </AppShell>,
    )

    const banner = screen.getByRole('banner')
    expect(banner).toBeTruthy()
    expect(screen.getByText('Workspace')).toBeTruthy()
    expect(screen.getByText('Overview')).toBeTruthy()
    expect(screen.getByText('owner')).toBeTruthy()
    expect(within(banner).getByRole('button', { name: 'Action' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Action' })).toHaveLength(1)
  })

  it('happy: renders logout button when onLogout is passed and calls it once when clicked', () => {
    const onLogout = vi.fn()

    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>} onLogout={onLogout}>
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('happy: toggles collapsed state and updates button state', () => {
    const navigation = vi.fn(({ collapsed }: { collapsed: boolean }) => <span>{collapsed ? 'c' : 'e'}</span>)

    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={navigation}>
        <div>Body</div>
      </AppShell>,
    )

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)

    expect(navigation).toHaveBeenLastCalledWith({ collapsed: true })
    expect(screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('c')).toBeTruthy()
  })

  it('happy: does not render the mobile navigation drawer initially', () => {
    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>}>
        <div>Body</div>
      </AppShell>,
    )

    const hamburger = screen.getByRole('button', { name: 'Open navigation' })
    expect(hamburger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('happy: opens the mobile navigation drawer when the hamburger is clicked, reusing the same slots and onLogout', () => {
    const onLogout = vi.fn()
    render(
      <AppShell
        sidebarHeader={() => <span>Drawer header</span>}
        navigation={() => <span>Drawer nav</span>}
        onLogout={onLogout}
      >
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    expect(screen.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Drawer header')).toBeTruthy()
    expect(within(dialog).getByText('Drawer nav')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('happy: closes the mobile navigation drawer when its scrim is clicked', () => {
    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>}>
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.click(screen.getByTestId('mobile-nav-scrim'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('happy: does not render the hamburger strip when mobileTabBar is provided', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        mobileTabBar={({ moreActive, onMoreClick }) => (
          <button type="button" aria-pressed={moreActive} onClick={onMoreClick}>
            More
          </button>
        )}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })

  it('happy: renders the fallback hamburger when mobileTabBar is omitted', () => {
    render(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>}>
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy()
  })

  it('happy: wires mobileTabBar moreActive/onMoreClick to the same drawer state as the hamburger would', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Drawer header</span>}
        navigation={() => <span>Drawer nav</span>}
        mobileTabBar={({ moreActive, onMoreClick }) => (
          <button type="button" aria-pressed={moreActive} onClick={onMoreClick}>
            More
          </button>
        )}
      >
        <div>Body</div>
      </AppShell>,
    )

    const moreButton = screen.getByRole('button', { name: 'More' })
    expect(moreButton.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(moreButton)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('happy: renders userFooter content when passed and nothing extra when omitted', () => {
    const { rerender } = render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        userFooter={({ collapsed }) => <span>{collapsed ? 'footer-collapsed' : 'footer-expanded'}</span>}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.getByText('footer-expanded')).toBeTruthy()

    rerender(
      <AppShell sidebarHeader={() => <span>Header</span>} navigation={() => <span>Nav</span>}>
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.queryByText('footer-expanded')).toBeNull()
  })
})
