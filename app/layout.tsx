import '@fontsource-variable/onest'
import '@fontsource-variable/fraunces/standard.css'
import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { preload } from 'react-dom'
import { site } from '@/lib/site.ts'
import './globals.css'

// Tab titles as on the other Gimz sites: the name, a bar, then the page
const title = `${site.name} | Balance sandbox for TFT and auto-battlers`
const description = 'Put two Teamfight Tactics comps on the board, change any champion, item or trait, and fight them thousands of times in your browser to see what your patch moves. Always on the current patch.'

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: title, template: `${site.name} | %s` },
  description,
  applicationName: site.name,
  authors: [{ name: site.author, url: site.authorUrl }],
  creator: site.author,
  keywords: ['TFT', 'Teamfight Tactics', 'TFT simulator', 'TFT comps', 'patch notes', 'balance', 'auto-battler', 'combat simulator', 'theorycrafting', 'game design'],
  alternates: { canonical: '/' },
  openGraph: { type: 'website', url: '/', siteName: site.name, title, description, locale: 'en_US' },
  twitter: { card: 'summary_large_image', title, description },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Dark, in MetaForge's colours, whatever the system's theme
  colorScheme: 'dark',
  themeColor: '#0f0d0b',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // The current TFT set, which a first visit opens on: fetched while the page loads
  preload('/sets/tft.json', { as: 'fetch', crossOrigin: 'anonymous' })
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://raw.communitydragon.org" crossOrigin="" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
