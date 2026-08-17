/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FilesTrust } from './files-trust'

afterEach(cleanup)

describe('FilesTrust', () => {
  it('lists every accepted file type', () => {
    render(<FilesTrust />)

    for (const type of [
      'PDF',
      'Scanned PDF',
      'XLSX',
      'CSV',
      'JPG / PNG',
      'Email attachment',
      'Price list',
    ]) {
      expect(screen.getByText(type)).not.toBeNull()
    }
  })

  // These four rows are claims about how the deployment actually behaves --
  // workspace isolation, citations, human sign-off, real deletion. They must
  // stay true to the product, so they are pinned here.
  it('renders the four trust guarantees', () => {
    render(<FilesTrust />)

    expect(screen.getByText('Isolation')).not.toBeNull()
    expect(screen.getByText(/never pooled with another buyer’s/i)).not.toBeNull()

    expect(screen.getByText('Citations')).not.toBeNull()
    expect(screen.getByText(/openable, not paraphrased/i)).not.toBeNull()

    expect(screen.getByText('Human sign-off')).not.toBeNull()
    expect(screen.getByText(/Approval stays with the buyer, always/i)).not.toBeNull()

    expect(screen.getByText('Deletion')).not.toBeNull()
    expect(screen.getByText(/removed with it/i)).not.toBeNull()
  })

  it('states that no line is paid on the model’s word alone', () => {
    render(<FilesTrust />)

    expect(screen.getByText(/No line is ever paid on the model's word alone/i)).not.toBeNull()
  })

  // Guards against someone adding SOC 2 / ISO / HIPAA badges the product does
  // not actually hold -- the handoff called this out explicitly.
  it('claims no certifications', () => {
    const { container } = render(<FilesTrust />)

    expect(container.textContent).not.toMatch(/SOC ?2|ISO ?27001|HIPAA|PCI ?DSS/i)
  })
})
