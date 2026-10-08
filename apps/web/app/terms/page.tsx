import type { Metadata } from 'next'
import { LegalLink, LegalPage, LegalSection } from '@/components/legal/legal-page'
import {
  CONTACT_EMAIL,
  REFUND_WINDOW_DAYS,
  SELLER_COUNTRY,
  SELLER_NAME,
  TRIAL_DAYS,
} from '@/lib/legal-facts'

const WEB_URL = process.env.WEB_URL ?? 'https://optra.example.com'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms for using Optra: who sells it, how billing works, acceptable use and limits of liability.',
  alternates: { canonical: `${WEB_URL}/terms` },
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <LegalSection title="Who we are">
        <p>
          Optra is provided by {SELLER_NAME}, an individual based in the {SELLER_COUNTRY}. Contact:{' '}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>. By creating an
          account or using Optra you agree to these terms.
        </p>
      </LegalSection>

      <LegalSection title="The service">
        <p>
          Optra matches purchase order lines against vendor catalog entries and invoices, and flags
          discrepancies with a citation behind each flag.
        </p>
      </LegalSection>

      <LegalSection title="Payments">
        <p>
          Lemon Squeezy is our Merchant of Record. It handles payment, tax and invoices for your
          subscription.
        </p>
      </LegalSection>

      <LegalSection title="Subscription and trial">
        <p>
          Optra is a subscription. Your first workspace starts with a {TRIAL_DAYS}-day trial. The
          trial needs no payment card and gives you the Solo plan&apos;s allowance of matched line
          items and photo checks. Workspaces you create later do not get a trial and need a plan.
          Subscribing during the trial starts your paid plan immediately.
        </p>
        <p>
          Each plan includes a monthly allowance of matched line items and photo checks, as shown
          on the pricing page, and a monthly limit on AI usage. Allowances reset each calendar
          month (UTC); the trial allowance covers the whole trial. When a workspace reaches a cap,
          that kind of work stops until the allowance resets. There is no overage charge. If you
          reach a cap, contact us to change the plan or the number of buyers at{' '}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>. Refunds are covered in the{' '}
          <LegalLink href="/refund">refund policy</LegalLink>; the full refund window is{' '}
          {REFUND_WINDOW_DAYS} days.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <ul className="list-disc space-y-2 pl-5">
          <li>Upload only documents you are lawfully allowed to use and share with us.</li>
          <li>Do not try to access another workspace or another customer&apos;s data.</li>
          <li>Do not abuse, overload or disrupt the service.</li>
          <li>Do not reverse-engineer the service or resell access to it.</li>
        </ul>
      </LegalSection>

      <LegalSection title="AI output">
        <p>
          Optra uses AI to read documents and flag likely discrepancies. A flag is a suggestion. A
          person decides whether to approve, dispute or ignore it. There is no warranty that every
          discrepancy will be found, or that every flag is correct. Check anything that matters
          before you pay.
        </p>
      </LegalSection>

      <LegalSection title="Your data">
        <p>
          You own the documents and data you upload. You give us a licence to process them only to
          run the service for you. How we handle personal data is described in the{' '}
          <LegalLink href="/privacy">privacy policy</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Termination">
        <p>
          You can cancel at any time and keep access until the end of the paid period. We may
          suspend or end your access if you break these terms. You can ask us to delete your
          workspace at any time by emailing{' '}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          Optra is provided as is. To the extent the law allows, our total liability to you for any
          claim is limited to the fees you paid in the 12 months before the claim arose.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>
          These terms are governed by the laws of the Republic of the Philippines.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. The date at the top shows the latest version. Continued use
          after a change means you accept it.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
