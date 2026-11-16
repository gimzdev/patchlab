import '@fontsource-variable/onest'
import '@fontsource-variable/fraunces/standard.css'
import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { site } from '@/lib/site.ts'
import './globals.css'

// Tab titles as on the other Gimz sites: the name, a bar, then the page
const title = `${site.name} | Balance sandbox for TFT and auto-battlers`
const description = 'Run thousands of fights with small tweaks: put two Teamfight Tactics comps on the board, tweak any champion, item or trait, and fight them in your browser, on the live patch or any other one.'

// The picture a link to the site shows is app/opengraph-image.jpg. A build made without that file (next.config.ts)
// points the pages' cards at a picture the site draws itself, the one a shared run's link shows, with no run in it:
// a link never comes without a picture.
const drawn = process.env.PL_PICTURE ? null : { images: [{ url: '/opengraph-image-run', width: 1200, height: 630, alt: `${site.name}: run thousands of fights with small tweaks` }] }

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: title, template: `${site.name} | %s` },
  description,
  applicationName: site.name,
  authors: [{ name: site.author, url: site.authorUrl }],
  creator: site.author,
  keywords: ['TFT', 'Teamfight Tactics', 'TFT simulator', 'TFT comps', 'patch notes', 'balance', 'auto-battler', 'combat simulator', 'theorycrafting', 'game design'],
  alternates: { canonical: '/' },
  openGraph: { type: 'website', url: '/', siteName: site.name, title, description, locale: 'en_US', ...drawn },
  twitter: { card: 'summary_large_image', title, description, ...drawn },
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
  // The lab's pages ask for what the lab needs first (lib/lab-hints.ts)
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
