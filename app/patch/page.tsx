import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { livePatch } from '@/lib/live.ts'
import { pageMeta } from '@/lib/meta.ts'
import { patchDate, shipped } from '@/lib/patches.ts'
import { site } from '@/lib/site.ts'

export function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMeta(
    parent,
    'TFT patches, simulated',
    'Each Teamfight Tactics patch’s balance changes, fought out on MetaForge’s meta comps: which comps win more often after the patch, which less, and by how much.',
    '/patch',
  )
}

// The list is of the patches that are live (lib/patches.ts): made again every hour, so a patch written ahead of its
// day joins it once the game is on it, without a deploy. Static all the same: asking what patch the game is on
// (two small reads that are never cached) must not make every visit wait for them
export const dynamic = 'force-static'
export const revalidate = 3600

export default async function Patches() {
  const patches = shipped(Date.now(), await livePatch())
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <Link href="/" prefetch={false} className="text-sm text-soft hover:text-ink">← Patchlab</Link>
      <h1 className="mt-8 font-display text-4xl text-ink md:text-5xl">TFT patches, simulated</h1>
      <p className="mt-5 text-lg text-pretty text-soft">
        Each patch’s balance changes, fought out on the comps MetaForge sees played most: every pair, with the numbers before the patch and after it, on the same seeds. What moved, and by how much.
      </p>
      <ul className="mt-12 divide-y divide-line border-y border-line">
        {patches.map((p) => {
          const played = p.changes.filter((c) => c.moves).length
          return (
            <li key={p.id}>
              <Link href={`/patch/${p.id}`} className="group flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4">
                <span className="font-medium text-ink underline-offset-4 group-hover:underline">Patch {p.label}{p.mid ? <span className="ml-2 text-sm font-normal text-muted">mid-patch update</span> : null}</span>
                <span className="text-sm text-soft tabular-nums">{patchDate(p.date)} · {played} of {p.changes.length} changes in the fights</span>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="mt-10 text-sm text-pretty text-muted">
        Simulations, not predictions: augments, the items people build in a given game and positioning choices are left out. <Link href="/" prefetch={false} className="underline underline-offset-2 hover:text-ink">Open the lab</Link> to fight any change yourself.
      </p>
      <footer className="mt-14 flex flex-wrap gap-x-4 border-t border-line pt-5 text-xs text-muted [&>a]:py-1">
        <a href={`${site.authorUrl}/?utm_source=patchlab`} target="_blank" rel="noopener" className="hover:text-ink">Made by {site.author}</a>
        <a href={`${site.authorUrl}/?utm_source=patchlab#contact`} target="_blank" rel="noopener" className="hover:text-ink">Hire me</a>
        <a href={`${site.authorUrl}/support?utm_source=patchlab`} target="_blank" rel="noopener" className="hover:text-ink">Support</a>
        <a href={site.metaforge} target="_blank" rel="noopener" className="hover:text-ink">Part of MetaForge</a>
      </footer>
    </main>
  )
}
