/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FilesTrust } from './files-trust'

afterEach(cleanup)

describe('FilesTrust', () => {
  it('error: no longer lists file types the upload endpoints reject', () => {
    const { container } = render(<FilesTrust />)

    expect(screen.queryByText('JPG / PNG')).toBeNull()
    expect(screen.queryByText('Email attachment')).toBeNull()
    expect(screen.queryByText('Price list')).toBeNull()
    expect(container.textContent).not.toMatch(/JPG|PNG/)
  })

  // Guards against someone adding SOC 2 / ISO / HIPAA badges the product does
  // not actually hold -- the handoff called this out explicitly.
  it('edge: claims no certifications', () => {
    const { container } = render(<FilesTrust />)

    expect(container.textContent).not.toMatch(/SOC ?2|ISO ?27001|HIPAA|PCI ?DSS/i)
  })

  it('regression: deletion copy no longer promises self-serve workspace delete', () => {
    const { container } = render(<FilesTrust />)

    expect(container.textContent).not.toMatch(/removed with it/i)
  })

  it('happy: lists exactly the accepted file types', () => {
    render(<FilesTrust />)

    for (const type of ['PDF', 'Scanned PDF', 'CSV', 'XLSX']) {
      expect(screen.getByText(type)).not.toBeNull()
    }
  })

  // These rows are claims about how the deployment actually behaves --
  // workspace isolation, citations, human sign-off, real deletion.
  it('happy: renders the four trust guarantees with deletion within 30 days', () => {
    render(<FilesTrust />)

    expect(screen.getByText('Isolation')).not.toBeNull()
    expect(screen.getByText(/never pooled with another buyer’s/i)).not.toBeNull()

    expect(screen.getByText('Citations')).not.toBeNull()
    expect(screen.getByText(/openable, not paraphrased/i)).not.toBeNull()

    expect(screen.getByText('Human sign-off')).not.toBeNull()
    expect(screen.getByText(/Approval stays with the buyer, always/i)).not.toBeNull()

    expect(screen.getByText('Deletion')).not.toBeNull()
    expect(
      screen.getByText(
        /Email us and we delete the workspace, its files, matches and history within 30 days\./,
      ),
    ).not.toBeNull()
  })

  it('happy: states that no line is paid on the model’s word alone', () => {
    render(<FilesTrust />)

    expect(screen.getByText(/No line is ever paid on the model's word alone/i)).not.toBeNull()
  })
})
