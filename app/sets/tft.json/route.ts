import { metaReply, tftSet } from '@/lib/live.ts'
import { patchName } from '@/lib/refresh.ts'

// The current TFT set, made on request. Each answer looks at CommunityDragon's version of the game data and at
// MetaForge's comps before it is sent, and the CDN and browsers keep it ten minutes: nobody gets a set older than
// that, however quiet the day (a static route refreshed every 6 hours served its old copy to the first visitor after
// any gap, 14.8 hours old on 2026-11-15, and kept a failed answer as long). The game data itself is only downloaded
// when its version changes
// (lib/live.ts), so a request costs two small reads. With no set at all the answer is null and nothing keeps it.
// The boards a first visit opens on take thousands of fights: they are made apart (app/sets/sample.json).
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const set = await tftSet()
  if (!set) return Response.json(null, { headers: { 'Cache-Control': 'no-store' } })
  const comps = await metaReply()
  const version = patchName(set, comps)
  const body = { ...set, ...(version ? { version } : {}), ...(comps && `tft${comps.set}` === set.id ? { meta: comps } : {}), checked: Date.now() }
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } })
}
