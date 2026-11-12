import { METAFORGE, readMeta, type MetaReply } from '@/lib/comps.ts'
import { fetchCurrent, type Kit, type TftSetJson } from '@/lib/tft.mjs'
import kit from '@/sets/tft18-kit.json'
import metaCopy from '@/sets/meta-snapshot.json'
import snapshot from '@/sets/tft-snapshot.json'

// The live TFT set and MetaForge's meta comps, as the server gets them: app/sets/tft.json serves them to the lab, and
// the patch pages fight with them.

const FRESH = 6 * 60 * 60 * 1000

/** The set: the copy scripts/tft.mjs made at build while it is fresh, then CommunityDragon's (the copy if that fails) */
export async function tftSet(): Promise<TftSetJson | null> {
  const copy = snapshot as TftSetJson | null
  if (process.env.NODE_ENV === 'production' && !(copy?.fetched && Date.now() - copy.fetched < FRESH)) return fetchCurrent(undefined, kit as Kit).catch(() => copy)
  return copy
}

/** MetaForge's meta comps: fresh from its site, or the copy kept here when it can't be reached */
export async function metaReply(): Promise<MetaReply | null> {
  try {
    const r = await fetch(METAFORGE, { signal: AbortSignal.timeout(10000), cache: 'no-store', headers: { 'user-agent': 'Patchlab (+https://patchlab.metaforge.lol)' } })
    if (r.ok) { const m = readMeta(await r.json()); if (m?.comps.length) return m }
  } catch { /* MetaForge can't be reached: the copy below */ }
  return readMeta(metaCopy)
}
