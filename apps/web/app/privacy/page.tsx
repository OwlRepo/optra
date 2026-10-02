import type { Metadata } from 'next'
import { LegalLink, LegalPage, LegalSection, LegalTable } from '@/components/legal/legal-page'
import {
  CONTACT_EMAIL,
  DELETION_SLA_DAYS,
  HOSTING_COUNTRY,
  LANGSMITH_TRACING_IN_PROD,
  OFFSITE_BACKUP_RETENTION_DAYS,
  SELLER_COUNTRY,
  SELLER_NAME,
  VPS_BACKUP_COUNT,
} from '@/lib/legal-facts'

const WEB_URL = process.env.WEB_URL ?? 'https://optra.example.com'

export const metadata: Metadata = {
  title: 'Privacy Policy — Optra',
  description:
    'What personal data Optra collects, who processes it, which cookies it sets and how to exercise your rights.',
  alternates: { canonical: `${WEB_URL}/privacy` },
}

export default function PrivacyPage() {
  const hosting = HOSTING_COUNTRY
    ? `Hosting server location: ${HOSTING_COUNTRY}.`
    : 'Hosting server location: on request.'
  const offsite =
    OFFSITE_BACKUP_RETENTION_DAYS !== null
      ? `Off-site backups are kept for ${OFFSITE_BACKUP_RETENTION_DAYS} days.`
      : 'Off-site backup retention: on request.'

  const processors: string[][] = [
    [
      'OpenAI',
      'Document text, page images of PDFs and product photos, to read line items and compare photos.',
      'Not used for training by default. Abuse-monitoring logs may be kept up to 30 days.',
    ],
    ['Resend', 'Your email address and the sign-in codes we email you.', 'Email delivery.'],
    [
      'Backblaze B2',
      'Uploaded files and backups.',
      'File storage and off-site backups.',
    ],
    [
      'Hetzner',
      'Everything stored on our server.',
      HOSTING_COUNTRY
        ? `Hosting (server location: ${HOSTING_COUNTRY}).`
        : 'Hosting (server location on request).',
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
          {SELLER_NAME}, an individual based in {SELLER_COUNTRY}, is the controller of your personal
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
            ['IP address', 'Rate limiting, to protect the service from abuse.'],
            ['Documents you upload and the matches built from them', 'Run the service for you.'],
          ]}
        />
      </LegalSection>

      <LegalSection title="Who processes it">
        <LegalTable
          caption="Processors"
          headers={['Processor', 'What it receives', 'Purpose']}
          rows={processors}
        />
        <p>{hosting}</p>
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
          We set no advertising or tracking cookies. Site analytics use Umami, self-hosted by us and
          cookieless.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          We keep your data while your workspace exists. Email us and we delete the workspace, its
          files, matches and history within {DELETION_SLA_DAYS} days.
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
