import { unstable_cache } from 'next/cache'
import { metaReply, tftSet } from '@/lib/live.ts'
import { balancedSample, metaSample } from '@/lib/sample.ts'
import { readSet } from '@/lib/sets.ts'

// The boards a first visit opens on: two of MetaForge's meta comps that win about as often as each other, so a patch
// has room to move the result either way (lib/sample.ts). Finding them takes thousands of fights, so they are made
// when the site is built and again once a day, apart from the set (app/sets/tft.json), which must answer at once.
// A day-old pair is still a fair fight; the lab only uses it when it is for the set it has, and drops any unit the
// set no longer holds. Without boards (no set to fight with) the answer is null, the lab opens on the set's own
// sample, and the boards are looked for again ten minutes later, not a day.
export const dynamic = 'force-static'
export const revalidate = 86400
export const maxDuration = 60

const soon = unstable_cache(async () => 0, ['sample-not-yet'], { revalidate: 600 })

async function boards() {
  const set = await tftSet()
  if (!set) return null
  const comps = await metaReply()
  try {
    const s = readSet({ ...set, ...(comps && `tft${comps.set}` === set.id ? { meta: comps } : {}) }).set
    const found = metaSample(s) ?? balancedSample(s)
    return found ? { set: set.id, boards: found } : null
  } catch {
    return null
  }
}

export async function GET() {
  const answer = await boards()
  if (!answer) await soon()
  return Response.json(answer)
}
