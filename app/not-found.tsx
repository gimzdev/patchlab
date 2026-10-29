import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } }

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl text-ink">There’s nothing here</h1>
      <p className="text-sm text-soft">Patchlab is one page: the lab.</p>
      <Link href="/" className="inline-flex h-9 w-fit items-center rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-ink hover:bg-accent/90">Open the lab</Link>
    </main>
  )
}
