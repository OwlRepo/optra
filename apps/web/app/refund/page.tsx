import type { Metadata } from 'next'
import { LegalLink, LegalPage, LegalSection } from '@/components/legal/legal-page'
import {
  CONTACT_EMAIL,
  REFUND_WINDOW_DAYS,
  SELLER_COUNTRY,
  SELLER_NAME,
} from '@/lib/legal-facts'

const WEB_URL = process.env.WEB_URL ?? 'https://optra.example.com'

export const metadata: Metadata = {
  title: 'Refund Policy — Optra',
  description: 'How cancellation and refunds work for Optra subscriptions.',
  alternates: { canonical: `${WEB_URL}/refund` },
}

export default function RefundPage() {
  return (
    <LegalPage title="Refund Policy">
      <LegalSection title="Who this applies to">
        <p>
          Optra is sold by {SELLER_NAME}, an individual based in {SELLER_COUNTRY}. Payments are
          processed by Lemon Squeezy, our Merchant of Record.
        </p>
      </LegalSection>

      <LegalSection title="Cancel anytime">
        <p>
          You can cancel your subscription at any time. You keep access until the end of the period
          you already paid for.
        </p>
      </LegalSection>

      <LegalSection title="Full refund window">
        <p>
          Ask within {REFUND_WINDOW_DAYS} days of your first payment and we refund it in full.
        </p>
      </LegalSection>

      <LegalSection title="After that">
        <ul className="list-disc space-y-2 pl-5">
          <li>No partial-period refunds once the {REFUND_WINDOW_DAYS}-day window has passed.</li>
          <li>Overage charges are non-refundable once the extra lines have been used.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How to ask">
        <p>
          Email <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>, or reply to
          your Lemon Squeezy order email. Include the email address you signed up with.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
