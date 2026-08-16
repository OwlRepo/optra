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

const description = 'Match purchase orders against vendor catalogs and invoices, with vision-based product matching and automatic discrepancy flagging.'

export const metadata: Metadata = {
  title: {
    default: 'Optra',
    template: '%s · Optra',
  },
  description,
  metadataBase: new URL(process.env.WEB_URL ?? 'https://optra.example.com'),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Optra — Vision-verified vendor sourcing and invoice matching',
    description,
    siteName: 'Optra',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Optra — Vision-verified vendor sourcing and invoice matching',
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
        {/* Scroll reveals start at opacity 0 and are switched on by client JS.
            With JS disabled that never happens, which would leave the whole
            marketing page blank -- so force every reveal wrapper visible.
            (The observer-never-fires case is handled inside useInView.) */}
        <noscript>
          <style>{`[data-inview]{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
