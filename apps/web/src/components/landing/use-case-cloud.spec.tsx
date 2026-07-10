/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UseCaseCloud } from './use-case-cloud'

afterEach(cleanup)

const useCases = [
  { label: 'Procurement teams', detail: 'Match every PO against the vendor catalog before it is approved.' },
  { label: 'AP / accounts payable teams', detail: 'Catch a price or quantity mismatch before the invoice gets paid.' },
  { label: 'Multi-vendor sourcing teams' },
  { label: 'Operations & supply chain teams' },
  { label: 'Small business buyers' },
  { label: 'Founder-led purchasing workflows' },
]

describe('UseCaseCloud', () => {
  it('renders all persona labels by name', () => {
    render(<UseCaseCloud useCases={useCases} />)
    for (const useCase of useCases) {
      expect(screen.getByText(useCase.label)).not.toBeNull()
    }
  })

  it('renders the first two personas as featured cards with supporting detail', () => {
    render(<UseCaseCloud useCases={useCases} />)
    expect(screen.getByText(useCases[0].detail!)).not.toBeNull()
    expect(screen.getByText(useCases[1].detail!)).not.toBeNull()
  })

  it('renders no scrolling marquee — content is static', () => {
    const { container } = render(<UseCaseCloud useCases={useCases} />)
    expect(container.querySelector('.animate-marquee')).toBeNull()
  })
})
