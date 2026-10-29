import { Lab } from '@/components/lab.tsx'
import { site } from '@/lib/site.ts'

const app = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: site.name,
  url: site.url,
  applicationCategory: 'GameApplication',
  operatingSystem: 'Any (runs in the browser)',
  description: 'A balance sandbox for Teamfight Tactics and other auto-battlers: put two comps on the board, change any number, fight them thousands of times and see what moves.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Person', name: site.author, url: site.authorUrl },
  isPartOf: { '@type': 'WebSite', name: 'MetaForge', url: site.metaforge },
}

export default function Page() {
  return (
    <>
      <Lab />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(app).replace(/</g, '\\u003c') }} />
    </>
  )
}
