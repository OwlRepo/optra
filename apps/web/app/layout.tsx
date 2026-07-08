import type { Metadata, Viewport } from 'next'
import { DM_Sans, JetBrains_Mono, Outfit } from 'next/font/google'
import { ToastProvider } from '@repo/ui'
import '@repo/ui/globals.css'

const display = Outfit({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const body = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

const description = 'Search past tickets, docs, and Slack threads to get a sourced answer before you start typing a reply.'

export const metadata: Metadata = {
  title: {
    default: 'Mnemra',
    template: '%s · Mnemra',
  },
  description,
  metadataBase: new URL(process.env.WEB_URL ?? 'https://mnemra.tyvera.app'),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Mnemra — Turn support history into instant, sourced answers',
    description,
    siteName: 'Mnemra',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mnemra — Turn support history into instant, sourced answers',
    description,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="font-body antialiased selection:bg-primary/15 selection:text-foreground">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
