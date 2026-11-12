import type { Metadata } from 'next'
import Link from 'next/link'
import { site } from '@/lib/site.ts'

export const metadata: Metadata = {
  title: 'For studios making auto-battlers',
  description: 'Bring your auto-battler to Patchlab as a JSON file and run thousands of fights on every balance change before players do, or have it built for your game.',
  alternates: { canonical: '/studios' },
}

const hire = `${site.authorUrl}/?utm_source=patchlab&utm_content=studios#contact`
const steps: [string, string][] = [
  ['Describe your game as a JSON file', 'Units with their stats and abilities, items, traits and the board. The built-in sandbox set shows the shape: open the lab, switch to it and choose Export this set.'],
  ['Import it in the lab', 'Import a set, then two boards, any numbers changed, thousands of seeded fights in the browser on every core. Nothing leaves the machine.'],
  ['Read what moved', 'Win rates live and patched on the same seeds, unit by unit, with the margin of the result. Watch any fight back, step by step.'],
]

export default function Studios() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <Link href="/" className="text-sm text-soft hover:text-ink">← Patchlab</Link>
      <h1 className="mt-8 font-display text-4xl text-ink md:text-5xl">For studios making auto-battlers</h1>
      <p className="mt-5 text-lg text-soft">Fights in an auto-battler play out on their own, so a balance change can be tested before it ships. Patchlab runs thousands of them with your numbers and with the old ones, and shows what moved.</p>
      <ol className="mt-12 space-y-8">
        {steps.map(([title, text], i) => (
          <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-4">
            <span className="grid size-10 place-items-center rounded-full border border-line-strong text-sm font-semibold text-ink">{i + 1}</span>
            <div><h2 className="text-lg font-semibold text-ink">{title}</h2><p className="mt-1 text-soft">{text}</p></div>
          </li>
        ))}
      </ol>
      <section className="mt-14 rounded-xl border border-line p-6 md:p-8">
        <h2 className="text-xl font-semibold text-ink">Or have it built</h2>
        <p className="mt-2 text-soft">Your game’s rules in Patchlab’s engine, a private lab for your team, or a simulator of your own: Patchlab’s developer takes client work.</p>
        <a href={hire} className="mt-5 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent/90">Start a project</a>
      </section>
      <p className="mt-10 text-sm text-soft">Patchlab is open source: <a href={site.repo} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">read the engine on GitHub</a>.</p>
    </main>
  )
}
