/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Accordion, type AccordionItem } from './accordion'

const items: AccordionItem[] = [
  { question: 'Is Mnemra only for teams?', answer: 'No, solo agents can use it too.' },
  { question: 'What kind of knowledge can it use?', answer: 'Docs, tickets, and chat threads.' },
]

describe('Accordion', () => {
  afterEach(cleanup)

  it('opens the first item by default and keeps the rest collapsed', () => {
    render(<Accordion items={items} />)

    const firstButton = screen.getByRole('button', { name: items[0].question })
    const secondButton = screen.getByRole('button', { name: items[1].question })

    expect(firstButton.getAttribute('aria-expanded')).toBe('true')
    expect(secondButton.getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles a panel open and closed on click, closing the previous one', () => {
    render(<Accordion items={items} />)

    const firstButton = screen.getByRole('button', { name: items[0].question })
    const secondButton = screen.getByRole('button', { name: items[1].question })

    fireEvent.click(secondButton)

    expect(secondButton.getAttribute('aria-expanded')).toBe('true')
    expect(firstButton.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(secondButton)

    expect(secondButton.getAttribute('aria-expanded')).toBe('false')
  })
})
