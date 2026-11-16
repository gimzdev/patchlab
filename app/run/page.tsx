import type { Metadata } from 'next'
import { Lab } from '@/components/lab.tsx'
import { labHints } from '@/lib/lab-hints.ts'
import { PICTURE, PICTURE_MAX, readRun } from '@/lib/run-picture.tsx'

// A shared run or setup (/run?s=<code>, from the Share button): the lab opens it, and the link shows its own picture and
// what the run found. The lab then moves the address back to /.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const s = (await searchParams).s, code = (Array.isArray(s) ? s[0] : s) ?? ''
  const run = code ? readRun(code) : null
  if (!run) return { title: 'A shared setup', robots: { index: false, follow: true } }
  const images = code.length <= PICTURE_MAX ? [{ url: `/opengraph-image-run?s=${code}`, ...PICTURE, alt: run.title }] : undefined
  return {
    title: run.title, description: run.text, robots: { index: false, follow: true }, alternates: { canonical: '/' },
    openGraph: { title: run.title, description: run.text, url: `/run?s=${code}`, ...(images && { images }) },
    twitter: { card: 'summary_large_image', title: run.title, description: run.text, ...(images && { images: images.map((i) => i.url) }) },
  }
}

export default function RunPage() {
  labHints()
  return <Lab />
}
