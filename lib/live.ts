import { unstable_cache } from 'next/cache'
import { METAFORGE, readMeta, type MetaReply } from '@/lib/comps.ts'
import { currentSet, patchName } from '@/lib/refresh.ts'
import { fetchCurrent, type Kit, type TftSetJson } from '@/lib/tft.mjs'
import kit from '@/sets/tft18-kit.json'
import metaCopy from '@/sets/meta-snapshot.json'
import snapshot from '@/sets/tft-snapshot.json'

// The live TFT set and MetaForge's meta comps, as the server gets them: app/sets/tft.json serves them to the lab, and
// the patch pages and the opening boards (app/sets/sample.json) fight with them. lib/refresh.ts holds the choices.

const CDRAGON = process.env.CDRAGON_URL || 'https://raw.communitydragon.org'
const AGENT = { 'user-agent': 'Patchlab (+https://patchlab.metaforge.lol)' }
const copy = snapshot as TftSetJson | null

/** The version of the game data on CommunityDragon now ("16.22.8348910+…"): a few bytes, never from a cache */
async function liveBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${CDRAGON}/latest/content-metadata.json`, { signal: AbortSignal.timeout(6000), cache: 'no-store', headers: AGENT })
    const v: unknown = r.ok ? (await r.json())?.version : null
    return typeof v === 'string' && /^\d+\.\d+/.test(v) ? v : null
  } catch {
    return null
  }
}

/** A version's set: downloaded and converted once, then kept for every request and every server (the key holds the
 *  version, and this build's own copy and kit, so a new build doesn't read an older converter's work) */
const liveSet = unstable_cache(
  (build: string) => fetchCurrent(undefined, kit as Kit, 25000).then((set) => ({ ...set, build: set.build ?? build })),
  ['tft-set', String(copy?.fetched ?? 0), String((kit as Kit).patch), String((kit as Kit).checked)],
  { revalidate: false },
)

/** The set: the build's copy while the game is on its version, the game's own data from then on (the copy if that
 *  can't be had). Outside a production server (next dev) the copy is the set. */
export function tftSet(): Promise<TftSetJson | null> {
  if (process.env.NODE_ENV !== 'production') return Promise.resolve(copy)
  return currentSet<TftSetJson>({ copy, build: liveBuild, live: liveSet })
}

/** The patch the game is on, by name, as the game data and MetaForge have it (patchName in lib/refresh.ts);
 *  undefined when there is no set to ask. The patch pages list a patch written ahead of its day once this names it. */
export async function livePatch(): Promise<string | undefined> {
  const [set, meta] = await Promise.all([tftSet().catch(() => null), metaReply().catch(() => null)])
  return set ? patchName(set, meta) : undefined
}

/** MetaForge's meta comps: fresh from its site, or the copy kept here when it can't be reached */
export async function metaReply(): Promise<MetaReply | null> {
  try {
    const r = await fetch(METAFORGE, { signal: AbortSignal.timeout(5000), cache: 'no-store', headers: AGENT })
    if (r.ok) { const m = readMeta(await r.json()); if (m?.comps.length) return m }
  } catch { /* MetaForge can't be reached: the copy below */ }
  return readMeta(metaCopy)
}
