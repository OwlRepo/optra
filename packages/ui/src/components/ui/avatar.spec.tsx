/** @vitest-environment jsdom */

import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'

afterEach(() => {
  cleanup()
})

describe('Avatar', () => {
  it('edge: a caller size replaces the 40px default instead of stacking with it', () => {
    render(<Avatar data-testid="avatar" className="h-6 w-6" />)
    const className = screen.getByTestId('avatar').className
    expect(className).toContain('h-6')
    expect(className).toContain('w-6')
    expect(className).not.toContain('h-10')
    expect(className).not.toContain('w-10')
    expect(className).toContain('rounded-full')
  })

  it('edge: forwards refs to the root, the image and the fallback', () => {
    const rootRef = React.createRef<HTMLDivElement>()
    const imageRef = React.createRef<HTMLImageElement>()
    const fallbackRef = React.createRef<HTMLDivElement>()
    render(
      <Avatar ref={rootRef}>
        <AvatarImage ref={imageRef} src="/avatars/ana.png" alt="Ana Reyes" />
        <AvatarFallback ref={fallbackRef}>AR</AvatarFallback>
      </Avatar>,
    )
    expect(rootRef.current).toBeInstanceOf(HTMLDivElement)
    expect(imageRef.current).toBeInstanceOf(HTMLImageElement)
    expect(fallbackRef.current?.textContent).toBe('AR')
  })

  it('happy: renders the image with its alt text and the fallback initials', () => {
    render(
      <Avatar>
        <AvatarImage src="/avatars/ana.png" alt="Ana Reyes" />
        <AvatarFallback>AR</AvatarFallback>
      </Avatar>,
    )
    const image = screen.getByRole('img', { name: 'Ana Reyes' })
    expect(image.getAttribute('src')).toBe('/avatars/ana.png')
    expect(image.className).toContain('aspect-square')
    expect(screen.getByText('AR').className).toContain('bg-muted')
  })
})
