/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'

afterEach(() => {
  cleanup()
})

describe('AppShell', () => {
  it('renders sidebar header and navigation with collapsed false on initial render', () => {
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

  it('renders children in main content area', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      >
        <div>Body content</div>
      </AppShell>,
    )

    expect(screen.getByText('Body content')).toBeTruthy()
  })

  it('renders top bar title, description, badge, and actions when passed', () => {
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

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByText('Workspace')).toBeTruthy()
    expect(screen.getByText('Overview')).toBeTruthy()
    expect(screen.getByText('owner')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Action' })).toBeTruthy()
  })

  it('renders no top bar when title, description, badge, and actions are omitted', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('renders logout button when onLogout is passed and calls it once when clicked', () => {
    const onLogout = vi.fn()

    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        onLogout={onLogout}
      >
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('renders no logout button when onLogout is omitted', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('toggles collapsed state and updates button state', () => {
    const navigation = vi.fn(({ collapsed }: { collapsed: boolean }) => <span>{collapsed ? 'c' : 'e'}</span>)

    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={navigation}
      >
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

  it('keeps the footer controls in a row when expanded', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        onLogout={() => {}}
      >
        <div>Body</div>
      </AppShell>,
    )

    const row = screen.getByRole('button', { name: 'Collapse sidebar' }).parentElement as HTMLElement
    expect(row.className).not.toContain('flex-col')
  })

  it('stacks the footer controls in a column when collapsed so both stay clickable', () => {
    render(
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
        onLogout={() => {}}
      >
        <div>Body</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    const row = screen.getByRole('button', { name: 'Expand sidebar' }).parentElement as HTMLElement
    expect(row.className).toContain('flex-col')
    expect(screen.getByRole('button', { name: 'Log out' }).hasAttribute('disabled')).toBe(false)
  })

  it('centers the sidebar header when collapsed', () => {
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

  it('renders userFooter content when passed and nothing extra when omitted', () => {
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
      <AppShell
        sidebarHeader={() => <span>Header</span>}
        navigation={() => <span>Nav</span>}
      >
        <div>Body</div>
      </AppShell>,
    )

    expect(screen.queryByText('footer-expanded')).toBeNull()
  })
})
