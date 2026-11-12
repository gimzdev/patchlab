import { metaReply, tftSet } from '@/lib/live.ts'
import { balancedSample, metaSample } from '@/lib/sample.ts'
import { readSet } from '@/lib/sets.ts'
import type { TftSetJson } from '@/lib/tft.mjs'

// The current TFT set. The site is built with the copy scripts/tft.mjs just wrote; from then on this answer is made
// again in the background every 6 hours from CommunityDragon's live data, so each new patch shows up without a deploy.
// If CommunityDragon can't be reached, the last good set keeps being served. MetaForge's meta comps come along (the
// copy kept here when its site can't be reached), and the boards a first visit opens on are chosen from them: two
// meta comps that win about as often as each other. lib/live.ts fetches both.
export const dynamic = 'force-static'
export const revalidate = 21600
export const maxDuration = 60

// The answer for the last set seen (a dev server asks for it on every page load)
let made: { from: TftSetJson; body: TftSetJson } | null = null

export async function GET() {
  const set = await tftSet()
  if (!set) return Response.json(null)
  if (made?.from !== set) {
    const comps = await metaReply()
    const withMeta = { ...set, ...(comps && `tft${comps.set}` === set.id ? { meta: comps } : {}) }
    let sample: unknown = set.sample
    try { const s = readSet(withMeta).set; sample = metaSample(s) ?? balancedSample(s) ?? sample } catch { /* keep the converter's boards */ }
    made = { from: set, body: { ...withMeta, sample } }
  }
  return Response.json(made.body)
}
