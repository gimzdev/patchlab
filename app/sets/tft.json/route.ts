import { METAFORGE, readMeta } from '@/lib/comps.ts'
import { balancedSample, metaSample } from '@/lib/sample.ts'
import { readSet } from '@/lib/sets.ts'
import { fetchCurrent, type Kit, type TftSetJson } from '@/lib/tft.mjs'
import kit from '@/sets/tft18-kit.json'
import metaCopy from '@/sets/meta-snapshot.json'
import snapshot from '@/sets/tft-snapshot.json'

// The current TFT set. The site is built with the copy scripts/tft.mjs just wrote; from then on this answer is made
// again in the background every 6 hours from CommunityDragon's live data, so each new patch shows up without a deploy.
// If CommunityDragon can't be reached, the last good set keeps being served. MetaForge's meta comps come along (the
// copy kept here when its site can't be reached), and the boards a first visit opens on are chosen from them: two
// meta comps that win about as often as each other.
export const dynamic = 'force-static'
export const revalidate = 21600
export const maxDuration = 60

const FRESH = 6 * 60 * 60 * 1000
// The answer for the last set seen (a dev server asks for it on every page load)
let made: { from: TftSetJson; body: TftSetJson } | null = null

async function meta() {
  try {
    const r = await fetch(METAFORGE, { signal: AbortSignal.timeout(10000), cache: 'no-store', headers: { 'user-agent': 'Patchlab (+https://patchlab.metaforge.lol)' } })
    if (r.ok) { const m = readMeta(await r.json()); if (m?.comps.length) return m }
  } catch { /* MetaForge can't be reached: the copy below */ }
  return readMeta(metaCopy)
}

export async function GET() {
  const copy = snapshot as TftSetJson | null
  let set = copy
  if (process.env.NODE_ENV === 'production' && !(copy?.fetched && Date.now() - copy.fetched < FRESH)) set = await fetchCurrent(undefined, kit as Kit).catch(() => copy)
  if (!set) return Response.json(null)
  if (made?.from !== set) {
    const comps = await meta()
    const withMeta = { ...set, ...(comps && `tft${comps.set}` === set.id ? { meta: comps } : {}) }
    let sample: unknown = set.sample
    try { const s = readSet(withMeta).set; sample = metaSample(s) ?? balancedSample(s) ?? sample } catch { /* keep the converter's boards */ }
    made = { from: set, body: { ...withMeta, sample } }
  }
  return Response.json(made.body)
}
