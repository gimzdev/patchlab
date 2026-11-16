// How the site keeps the TFT set current, and what patch it calls it: the choices, apart from the network, so that
// scripts/engine-test.mjs can check them. lib/live.ts gives them the real sources.

/** What the choices read of a set */
export interface SetStamp {
  id: string
  /** The patch by its TFT name, when the kit's pair of versions names it */
  version?: string
  /** The whole version of the game data the set was made from */
  build?: string
}

export interface SetSources<S extends SetStamp> {
  /** The copy made when the site was built (null: the build had none) */
  copy: S | null
  /** The version of the game data on CommunityDragon right now (null: it can't be reached) */
  build: () => Promise<string | null>
  /** That version's set, downloaded and converted (lib/live.ts keeps each one once made) */
  live: (build: string) => Promise<S>
}

/**
 * The set to answer with, asked on every request the CDN doesn't answer itself (ten minutes at most). The game's
 * version is a few bytes and is read every time, never from a cache: an answer is never older than its last look.
 * The 25 MB of game data are only downloaded when that version is not the build's copy's.
 */
export async function currentSet<S extends SetStamp>(s: SetSources<S>): Promise<S | null> {
  const build = await s.build().catch(() => null)
  // CommunityDragon can't be reached: the build's copy. With no copy either the answer is null, which nothing keeps:
  // the next request asks again.
  if (!build) return s.copy
  if (s.copy?.build === build) return s.copy
  // The game has moved on since the build: a patch, or a mid-patch update
  return s.live(build).catch(() => s.copy)
}

const NAME = /^\d+\.\d+[a-z]?$/

/**
 * The patch a set is on, by name. TFT names its patches by set (18.6) and the game data only carries the game's own
 * version (16.22). The kit's pair of the two names every version of its set and year, so that name follows the data.
 * MetaForge reads the patch from ranked games (/api/comps): it adds the letter of a mid-patch update, and it names
 * the patch when the kit can't (a new set, a new year). Both only know patches that are being played, so a patch that
 * hasn't shipped is never named; with neither, the set shows the game's version and no patch. A name is a patch of
 * the set itself (19.1 for Set 19): anything else MetaForge might send, the game's own version included, is not used.
 */
export function patchName(set: SetStamp, meta: { set: number; patch?: string } | null | undefined): string | undefined {
  const theirs = meta && `tft${meta.set}` === set.id && typeof meta.patch === 'string' && NAME.test(meta.patch) && meta.patch.startsWith(`${meta.set}.`) ? meta.patch : undefined
  if (!set.version) return theirs
  return theirs && theirs.replace(/[a-z]$/, '') === set.version.replace(/[a-z]$/, '') && theirs.length >= set.version.length ? theirs : set.version
}

const base = (p: string) => { const m = /^(\d+)\.(\d+)/.exec(p); return m ? Number(m[1]) * 1000 + Number(m[2]) : 0 }

/**
 * MetaForge's own patch for its comps, to show beside them: a patch of this set, and not one past the patch the set's
 * data is of. A label ahead of the game would name a patch that hasn't shipped (/api/comps answered 18.7 for some
 * hours on 2026-11-15, with the game on 18.6): the comps are then shown without a patch.
 */
export function metaPatch(set: SetStamp, patch: string | undefined): string | undefined {
  if (!patch || !NAME.test(patch) || !patch.startsWith(`${set.id.replace(/^tft/, '')}.`)) return undefined
  return set.version && base(patch) > base(set.version) ? undefined : patch
}
