import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { num, pct, signed } from '@/lib/format.ts'
import { metaReply, tftSet } from '@/lib/live.ts'
import { RUN, runPatch, type PatchRun } from '@/lib/patch-run.ts'
import { patchById, patchDate, PATCHES, type Patch } from '@/lib/patches.ts'
import { readSet } from '@/lib/sets.ts'
import { site } from '@/lib/site.ts'

// A patch, fought out on the meta comps (lib/patch-run.ts): about 15 seconds of fights, so the newest patch's page is
// made while the site builds and the others the first time they're asked for, then each is kept a day and made again,
// so the comps follow MetaForge's meta. While the patch's set isn't the live one, the page lists the changes alone.

export const dynamic = 'force-static'
export const dynamicParams = true
export const revalidate = 86400
export const maxDuration = 60

type Props = { params: Promise<{ id: string }> }

export function generateStaticParams() {
  return PATCHES.slice(0, 1).map((p) => ({ id: p.id }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = patchById((await params).id)
  if (!p) return {}
  const title = `TFT patch ${p.label}, simulated`
  const description = `Riot’s balance changes in Teamfight Tactics patch ${p.label}, fought out on MetaForge’s meta comps: which comps win more often after the patch, which less, and by how much.`
  return { title, description, alternates: { canonical: `/patch/${p.id}` }, openGraph: { title, description, url: `/patch/${p.id}` } }
}

/** The fights, and the live set's number (null when the game data didn't load) */
async function fightIt(p: Patch): Promise<{ run: PatchRun | null; live: number | null }> {
  try {
    const json = await tftSet()
    if (!json) return { run: null, live: null }
    const set = readSet(json).set
    return { run: runPatch(set, await metaReply(), p), live: Number(set.id.replace(/^tft/, '')) || null }
  } catch {
    return { run: null, live: null }
  }
}

export default async function PatchPage({ params }: Props) {
  const p = patchById((await params).id)
  if (!p) notFound()
  const { run, live } = await fightIt(p)
  const played = p.changes.filter((c) => c.moves), left = p.changes.filter((c) => !c.moves)
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: site.name, item: site.url },
      { '@type': 'ListItem', position: 2, name: 'Patches, simulated', item: `${site.url}/patch` },
      { '@type': 'ListItem', position: 3, name: `Patch ${p.label}`, item: `${site.url}/patch/${p.id}` },
    ],
  }
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <nav aria-label="Breadcrumb" className="text-sm text-soft">
        <Link href="/" className="hover:text-ink">Patchlab</Link> <span className="text-muted">/</span> <Link href="/patch" className="hover:text-ink">Patches</Link>
      </nav>
      <h1 className="mt-8 font-display text-4xl text-ink md:text-5xl">Patch {p.label}, simulated</h1>
      <p className="mt-5 text-lg text-pretty text-soft">
        Riot’s balance changes in TFT patch {p.label}, {p.mid ? 'a mid-patch update ' : ''}live on {patchDate(p.date)}, fought out on the comps MetaForge sees played most. Every pair fights {num(RUN.fights)} times, half on each side of the board, once with the numbers before the patch and once with the numbers after, on the same seeds.
      </p>

      {run ? <Results run={run} /> : (
        <p className="mt-12 rounded-xl border border-line p-6 text-soft">
          {live && live !== p.set
            ? `Set ${p.set} has left the game, so its comps can’t be fought any more. Its changes are below.`
            : 'The fights couldn’t be run just now: the game data or MetaForge’s comps didn’t load. The page tries again within a day.'}
        </p>
      )}

      <section className="mt-14">
        <h2 className="text-xl font-semibold text-ink">The changes</h2>
        <ul className="mt-4 space-y-2 text-soft">
          {played.map((c) => <Change key={`${c.target} ${c.what}`} c={c} />)}
        </ul>
        {left.length > 0 && (
          <>
            <h3 className="mt-8 font-semibold text-ink">Not in the fights</h3>
            <ul className="mt-3 space-y-2 text-soft">
              {left.map((c) => (
                <Change key={`${c.target} ${c.what}`} c={c}>
                  <span className="block text-sm text-muted">{c.why}</span>
                </Change>
              ))}
            </ul>
          </>
        )}
        <p className="mt-6 text-sm text-soft">
          Augments, Wisps and the rest of the patch aren’t in Patchlab. All of it is in <a href={p.notes} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">Riot’s patch notes</a> and in <a href={`${site.metaforge}/news#${p.id}`} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">MetaForge’s</a>.
        </p>
      </section>

      <p className="mt-12 text-sm text-pretty text-muted">
        A simulation, not a prediction. The comps play MetaForge’s boards with their usual items; augments, the items people build in a given game and positioning choices are left out, and everything the patch didn’t change is at today’s numbers. <Link href="/" className="underline underline-offset-2 hover:text-ink">Open the lab</Link> to fight any of it yourself.
      </p>

      <footer className="mt-14 flex flex-wrap gap-x-4 border-t border-line pt-5 text-xs text-muted [&>a]:py-1">
        <a href={`${site.authorUrl}/?utm_source=patchlab`} target="_blank" rel="noopener" className="hover:text-ink">Made by {site.author}</a>
        <a href={`${site.authorUrl}/?utm_source=patchlab#contact`} target="_blank" rel="noopener" className="hover:text-ink">Hire me</a>
        <a href={`${site.authorUrl}/support?utm_source=patchlab`} target="_blank" rel="noopener" className="hover:text-ink">Support</a>
        <a href={site.metaforge} target="_blank" rel="noopener" className="hover:text-ink">Part of MetaForge</a>
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs).replace(/</g, `${String.fromCharCode(92)}u003c`) }} />
    </main>
  )
}

function Change({ c, children }: { c: Patch['changes'][number]; children?: ReactNode }) {
  return (
    <li>
      <span className="font-medium text-ink">{c.target}</span> <span className="text-muted">·</span> {c.what}: <span className="tabular-nums">{c.from} <span aria-label="becomes" className="text-muted">→</span> {c.to}</span>
      {children}
    </li>
  )
}

function Results({ run }: { run: PatchRun }) {
  const most = Math.max(2, ...run.comps.map((c) => Math.abs(c.delta) + c.margin))
  const moved = run.comps.some((c) => Math.abs(c.delta) > c.margin && Math.abs(c.delta) >= 0.05)
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold text-ink">What moved</h2>
      <p className="mt-2 text-pretty text-soft">
        Each comp’s win rate against the other {run.comps.length - 1}, before the patch and after it. A comp can move without playing anything the patch changed, when the comps it fights did. A change smaller than its margin can’t be told apart from chance{moved ? '.' : ', and here no comp moved by more than its margin.'}
      </p>
      <ol className="mt-6 divide-y divide-line border-y border-line">
        {run.comps.map((c) => {
          const clear = Math.abs(c.delta) > c.margin && Math.abs(c.delta) >= 0.05
          const width = `${(Math.min(Math.abs(c.delta), most) / most) * 50}%`
          return (
            <li key={c.name} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="min-w-0 font-medium text-ink">{c.name}</p>
                <p className="text-sm text-soft tabular-nums">
                  {pct(c.before)} <span aria-label="becomes" className="text-muted">→</span> <span className="rounded bg-mark px-1 text-mark-ink">{pct(c.after)}</span>{' '}
                  <span className="font-semibold text-ink">{signed(c.delta)} pts</span> ±{num(c.margin, 1)}
                  <span className="ml-1.5 text-muted">{clear ? 'a clear change' : 'within the noise'}</span>
                </p>
              </div>
              {c.touched.length > 0 && <p className="mt-1 text-sm text-muted">Plays {c.touched.join(', ')}</p>}
              <div className="relative mt-2.5 h-1.5 rounded-full bg-sunk" aria-hidden>
                <span className="absolute inset-y-[-3px] left-1/2 w-px bg-line-strong" />
                <span className={`absolute inset-y-0 rounded-full ${c.delta >= 0 ? 'left-1/2 bg-accent' : 'right-1/2 bg-soft'} ${clear ? '' : 'opacity-40'}`} style={{ width }} />
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-sm text-muted">
        {num(run.fights)} fights, each fought twice, on {patchDate(run.at)}. {run.played} of the patch’s changes are in them{run.metaPatch ? `, on the comps MetaForge measured in patch ${run.metaPatch}` : ''}. Comps that win or lose almost every fight against the others here are left out: a patch can’t move them.
      </p>
    </section>
  )
}
