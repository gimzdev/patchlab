import type { MetadataRoute } from 'next'
import { PATCHES } from '@/lib/patches.ts'
import { site } from '@/lib/site.ts'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site.url, changeFrequency: 'weekly', priority: 1 },
    { url: `${site.url}/studios`, changeFrequency: 'monthly', priority: 0.5 },
    // A patch's page changes with its notes; the date is the patch's own
    ...(PATCHES.length ? [{ url: `${site.url}/patch`, lastModified: PATCHES[0].date, changeFrequency: 'weekly' as const, priority: 0.7 }] : []),
    ...PATCHES.map((p) => ({ url: `${site.url}/patch/${p.id}`, lastModified: p.date, changeFrequency: 'weekly' as const, priority: 0.6 })),
  ]
}
