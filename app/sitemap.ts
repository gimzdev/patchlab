import type { MetadataRoute } from 'next'
import { livePatch } from '@/lib/live.ts'
import { shipped } from '@/lib/patches.ts'
import { site } from '@/lib/site.ts'

// Made again every hour: a patch joins it once it is live (lib/patches.ts). Static, as the patch list is.
export const dynamic = 'force-static'
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const patches = shipped(Date.now(), await livePatch())
  return [
    { url: site.url, changeFrequency: 'weekly', priority: 1 },
    { url: `${site.url}/studios`, changeFrequency: 'monthly', priority: 0.5 },
    // A patch's page changes with its notes; the date is the patch's own
    ...(patches.length ? [{ url: `${site.url}/patch`, lastModified: patches[0].date, changeFrequency: 'weekly' as const, priority: 0.7 }] : []),
    ...patches.map((p) => ({ url: `${site.url}/patch/${p.id}`, lastModified: p.date, changeFrequency: 'weekly' as const, priority: 0.6 })),
  ]
}
