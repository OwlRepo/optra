import type { Metadata } from 'next'
import { LegalLink, LegalPage, LegalSection, LegalTable } from '@/components/legal/legal-page'
import {
  CONTACT_EMAIL,
  DELETION_SLA_DAYS,
  FILE_STORAGE_REGION,
  HOSTING_COUNTRY,
  LANGSMITH_TRACING_IN_PROD,
  OFFSITE_BACKUP_RETENTION_DAYS,
  SELLER_COUNTRY,
  SELLER_NAME,
  VPS_BACKUP_COUNT,
} from '@/lib/legal-facts'

const WEB_URL = process.env.WEB_URL ?? 'https://optra.example.com'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What personal data Optra collects, who processes it, which cookies it sets and how to exercise your rights.',
  alternates: { canonical: `${WEB_URL}/privacy` },
}

export default function PrivacyPage() {
  const offsite =
    OFFSITE_BACKUP_RETENTION_DAYS !== null
      ? `Off-site backups are kept for ${OFFSITE_BACKUP_RETENTION_DAYS} days.`
      : 'Off-site backup retention: on request.'

  const processors: string[][] = [
    [
      'OpenAI',
      'Text and page images of uploaded documents (including photos of paper documents, with location data removed first), product photos, and questions you type into chat with the passages retrieved to answer them.',
      'AI reading and matching, and chat answers. Provided by OpenAI, L.L.C. in the United States. Not used for training by default; abuse-monitoring logs may be kept up to 30 days.',
    ],
    ['Resend', 'Your email address and the sign-in codes we email you.', 'Email delivery.'],
    [
      'Backblaze B2',
      'Uploaded files and backups.',
      `File storage and off-site backups. Region: ${FILE_STORAGE_REGION}.`,
    ],
    [
      'Hetzner',
      'Everything stored on our server.',
      HOSTING_COUNTRY
        ? `Hosting (server location: ${HOSTING_COUNTRY}).`
        : 'Hosting (server location on request).',
    ],
    [
      'Lemon Squeezy',
      'Your email address, plus the billing, tax and payment details you enter on its hosted checkout. We send it your email address and a workspace identifier; it sends us your plan, subscription status, renewal dates and the payer name and email.',
      'Payments, tax and invoices, as our Merchant of Record.',
    ],
  ]
  if (LANGSMITH_TRACING_IN_PROD !== false) {
    processors.push([
      'LangSmith',
      'May receive prompts and outputs for debugging traces.',
      'AI debugging.',
    ])
  }

  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="Who is responsible">
        <p>
          {SELLER_NAME}, an individual based in the {SELLER_COUNTRY}, is the controller of your personal
          data. Contact: <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Data we collect">
        <LegalTable
          caption="Personal data we store"
          headers={['Data', 'Why']}
          rows={[
            ['Email address', 'Your account and sign-in.'],
            ['Password (stored as a bcrypt hash)', 'Sign-in. We cannot read your password.'],
            ['One-time sign-in code (expires after 10 minutes)', 'Verify it is you.'],
            ['Refresh token (stored as a SHA-256 hash)', 'Keep you signed in.'],
            ['IP address', 'Rate limiting and abuse protection, and site analytics (Umami, self-hosted).'],
            ['Documents you upload and the matches built from them', 'Run the service for you.'],
            ['Chat messages and the answers given', 'Answer your questions about your documents.'],
            ['Tickets extracted from your documents', 'Show and track extracted tasks.'],
            ['Web pages you ask us to crawl', 'Make them searchable in your workspace.'],
            [
              'Decision history (outcome, note, who decided and their role)',
              'Record who resolved each flag.',
            ],
            ['Workspace activity events', 'Show what happened in your workspace.'],
            ['Workspace member emails and roles', 'Control who can access the workspace.'],
            [
              'Billing events from Lemon Squeezy (plan, status, renewal dates, and the payer name and email in the event)',
              'Keep your subscription status accurate and investigate billing problems.',
            ],
          ]}
        />
      </LegalSection>

      <LegalSection title="Who processes it">
        <LegalTable
          caption="Processors"
          headers={['Processor', 'What it receives', 'Purpose']}
          rows={processors}
        />
        <p>
          Uploaded files and backups are stored in the {FILE_STORAGE_REGION}. The
          application server runs in {HOSTING_COUNTRY ?? 'a location available on request'}.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <LegalTable
          caption="Cookies"
          headers={['Cookie', 'Purpose', 'Lifetime']}
          rows={[
            ['mnemra_at', 'Access token. Strictly necessary, HttpOnly.', '15 minutes'],
            ['mnemra_rt', 'Refresh token. Strictly necessary, HttpOnly.', '7 days'],
          ]}
        />
        <p>
          <code>mnemra_session_active</code> is a session-storage flag, not a cookie. It only marks
          that you are signed in and clears when the browser tab closes.
        </p>
        <p>
          We set no advertising or tracking cookies. Site analytics use Umami, self-hosted by us and
          cookieless.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          We keep your data while your workspace exists. Email us and we delete your workspace data,
          including uploaded files, within {DELETION_SLA_DAYS} days. Backups expire on the schedule
          below.
        </p>
        <p>
          Backups: the {VPS_BACKUP_COUNT} newest database backups are kept on the server. {offsite}{' '}
          Deleted data leaves backups when they expire.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          Under the Philippine Data Privacy Act of 2012 (RA 10173) you can ask to access, correct
          or delete your personal data, and you can object to how it is processed. Email{' '}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>. You can also
          complain to the National Privacy Commission.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
