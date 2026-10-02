/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileTabBar } from './mobile-tab-bar'

const usePathnameMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}))

const items = [
  { href: '/workspaces/w1', label: 'Overview', icon: React.createElement('span', null, 'O'), exact: true },
  { href: '/workspaces/w1/chat', label: 'Chat', icon: React.createElement('span', null, 'C') },
  { href: '/workspaces/w1/knowledge-bases', label: 'Knowledge', icon: React.createElement('span', null, 'K') },
]

describe('MobileTabBar', () => {
  beforeEach(() => {
    usePathnameMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('edge: an inactive tab carries no dot', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    render(React.createElement(MobileTabBar, { items, moreActive: false, onMoreClick: () => {} }))

    expect(screen.getByRole('link', { name: /Chat/ }).querySelector('[data-nav-indicator]')).toBeNull()
  })

  it('regression: the active tab shows a 4px teal dot and never scales', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    const { container } = render(React.createElement(MobileTabBar, { items, moreActive: false, onMoreClick: () => {} }))

    const overview = screen.getByRole('link', { name: /Overview/ })
    expect(overview.querySelector('[data-nav-indicator="dot"]')).not.toBeNull()
    expect(overview.classList.contains('text-primary-strong')).toBe(true)
    expect(container.querySelector('.scale-110')).toBeNull()
    expect(container.querySelector('.active\\:scale-95')).toBeNull()
  })

  it('regression: the bar takes the landing header surface with 44px targets', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    render(React.createElement(MobileTabBar, { items, moreActive: false, onMoreClick: () => {} }))

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav.classList.contains('bg-background/90')).toBe(true)
    expect(nav.classList.contains('backdrop-blur-[16px]')).toBe(true)
    expect(screen.getByRole('button', { name: 'More' }).classList.contains('min-h-11')).toBe(true)
  })

  it('happy: renders all items plus a More tab', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    render(React.createElement(MobileTabBar, { items, moreActive: false, onMoreClick: () => {} }))

    expect(screen.getByRole('link', { name: /Overview/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Chat/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Knowledge/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })

  it('happy: marks the exact-matched item as active via aria-current', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    render(React.createElement(MobileTabBar, { items, moreActive: false, onMoreClick: () => {} }))

    expect(screen.getByRole('link', { name: /Overview/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /Chat/ }).getAttribute('aria-current')).toBeNull()
  })

  it('happy: marks a nested route as active via prefix match', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1/chat/session-123')
    render(React.createElement(MobileTabBar, { items, moreActive: false, onMoreClick: () => {} }))

    expect(screen.getByRole('link', { name: /Chat/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /Overview/ }).getAttribute('aria-current')).toBeNull()
  })

  it('happy: calls onMoreClick when the More tab is pressed and reflects moreActive via aria-pressed', () => {
    usePathnameMock.mockReturnValue('/workspaces/w1')
    const onMoreClick = vi.fn()
    const { rerender } = render(React.createElement(MobileTabBar, { items, moreActive: false, onMoreClick }))

    const moreButton = screen.getByRole('button', { name: 'More' })
    expect(moreButton.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(moreButton)
    expect(onMoreClick).toHaveBeenCalledTimes(1)

    rerender(React.createElement(MobileTabBar, { items, moreActive: true, onMoreClick }))
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-pressed')).toBe('true')
  })
})
