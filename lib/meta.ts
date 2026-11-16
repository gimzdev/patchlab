import type { Metadata, ResolvingMetadata } from 'next'
import { site } from '@/lib/site.ts'

/**
 * A page's own title, description and address, for search results and for the card its link shows where it's pasted.
 * Next.js merges metadata key by key and the card's fields are one key: a page that gives only a title keeps the home
 * page's card, and one that gives its own card loses the picture (app/opengraph-image.jpg belongs to the pages above).
 * So the card is made whole here, with the picture of the pages above.
 */
export async function pageMeta(parent: ResolvingMetadata, title: string, description: string, path: string): Promise<Metadata> {
  const above = await parent
  return {
    title, description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: site.name, locale: 'en_US', title, description, url: path, images: above.openGraph?.images },
    twitter: { card: 'summary_large_image', title, description, images: above.twitter?.images },
  }
}
