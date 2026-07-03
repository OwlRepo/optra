import type { Metadata } from 'next'
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

export const metadata: Metadata = {
  title: {
    default: 'Mnemra',
    template: '%s · Mnemra',
  },
  description: 'Modern support intelligence platform for faster answers, cleaner knowledge operations, and happier customers.',
  metadataBase: new URL('https://mnemra.com'),
  openGraph: {
    title: 'Mnemra',
    description: 'Support intelligence platform for modern teams.',
    siteName: 'Mnemra',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mnemra',
    description: 'Support intelligence platform for modern teams.',
  },
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
