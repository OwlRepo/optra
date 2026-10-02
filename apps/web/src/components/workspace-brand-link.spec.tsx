/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceBrandLink } from './workspace-brand-link'

describe('WorkspaceBrandLink', () => {
  afterEach(() => {
    cleanup()
  })

  it('edge: falls back to the "W" tile and the "Workspace" label before the name loads', () => {
    render(<WorkspaceBrandLink collapsed={false} />)

    expect(screen.getByText('W')).toBeTruthy()
    expect(screen.getByText('Workspace')).toBeTruthy()
  })

  it('edge: the collapsed rail shows only the initial tile and still links to /workspaces', () => {
    render(<WorkspaceBrandLink name="kestrel Supply Co." collapsed />)

    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/workspaces')
    expect(link.textContent).toBe('K')
    expect(screen.queryByText('Switch workspace')).toBeNull()
  })

  it('regression: says "Switch workspace" under the name because the link opens the workspace list', () => {
    render(<WorkspaceBrandLink name="Kestrel Supply Co." collapsed={false} />)

    expect(screen.getByText('Switch workspace')).toBeTruthy()
    expect(screen.getByRole('link').textContent).toBe('KKestrel Supply Co.Switch workspace')
  })

  it('happy: links to /workspaces with an uppercase initial tile and the full name', () => {
    render(<WorkspaceBrandLink name="kestrel Supply Co." collapsed={false} />)

    expect(screen.getByRole('link').getAttribute('href')).toBe('/workspaces')
    expect(screen.getByText('K')).toBeTruthy()
    expect(screen.getByText('kestrel Supply Co.')).toBeTruthy()
  })
})
