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

  it('regression: isolation and sign-off rows drop the absolute wording', () => {
    const { container } = render(<FilesTrust />)

    expect(container.textContent).not.toMatch(/never pooled/i)
    expect(container.textContent).not.toMatch(/stays with the buyer, always/i)
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
    expect(container.textContent).not.toContain('files, matches and history within 30 days')
  })

  it('happy: lists exactly the accepted file types', () => {
    render(<FilesTrust />)

    for (const type of ['PDF', 'Scanned PDF', 'Photo', 'CSV', 'XLSX']) {
      expect(screen.getByText(type)).not.toBeNull()
    }
  })

  // These rows are claims about how the deployment actually behaves --
  // workspace isolation, citations, human sign-off, real deletion.
  it('happy: renders the four trust guarantees with deletion within 30 days', () => {
    render(<FilesTrust />)

    expect(screen.getByText('Isolation')).not.toBeNull()
    expect(
      screen.getByText("Every workspace is isolated from other workspaces' data."),
    ).not.toBeNull()

    expect(screen.getByText('Citations')).not.toBeNull()
    expect(screen.getByText(/openable, not paraphrased/i)).not.toBeNull()

    expect(screen.getByText('Human sign-off')).not.toBeNull()
    expect(screen.getByText('A person records every decision.')).not.toBeNull()

    expect(screen.getByText('Deletion')).not.toBeNull()
    expect(
      screen.getByText(
        'Email us and we delete your workspace data, including uploaded files, within 30 days. Backups expire on the schedule in the privacy policy.',
      ),
    ).not.toBeNull()
  })

  it('happy: states that no line is paid on the model’s word alone', () => {
    render(<FilesTrust />)

    expect(screen.getByText(/No line is ever paid on the model's word alone/i)).not.toBeNull()
  })
})
