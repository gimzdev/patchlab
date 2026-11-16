import { fightSeed } from '@/engine/batch.ts'
import { fight } from '@/engine/fight.ts'
import { applyOverrides, validPath } from '@/engine/patch.ts'
import { activeTraits, prepare } from '@/engine/prepare.ts'
import type { GameSet, Overrides } from '@/engine/types.ts'
import { gameIds, metaToComps, onSide, type MetaReply } from '@/lib/comps.ts'
import type { Patch } from '@/lib/patches.ts'
import { metaPatch } from '@/lib/refresh.ts'

// A patch, fought out: MetaForge's most played comps against each other, every pair on both sides of the board, each
// fight once with the numbers before the patch and once with the numbers after, on the same seed. Everything the patch
// doesn't touch stays at today's numbers. Run on the server when a patch page is made (app/patch/[id]).
// The field: of the most played comps (pool), those that neither win nor lose nearly every fight against the others in
// a quick round (a patch can't move those), the first few (comps). After the fights the same rule is put to the numbers
// the page shows: the comp furthest past the edge before the patch leaves, the others are counted again without it,
// until every comp left won between `edge` and 1 - `edge` of its fights before the patch.

export const RUN = { pool: 12, comps: 8, fights: 200, quick: 16, edge: 0.08 }

export interface CompShift {
  name: string
  /** The patch's champions, items and traits this comp plays */
  touched: string[]
  fights: number
  /** Win rates against the other comps, 0 to 1 */
  before: number
  after: number
  /** after minus before, in points, and the 95% margin around it */
  delta: number
  margin: number
}

export interface PatchRun {
  comps: CompShift[]
  /** Fights among the comps shown, before and after counted once */
  fights: number
  /** The changes the run plays, and the numbers this set doesn't have (a change Patchlab couldn't place) */
  played: number
  missing: string[]
  /** The meta's own patch, as MetaForge labels it */
  metaPatch?: string
  /** When the fights were fought (UTC date) */
  at: string
}

/** A patch's path with this set's ids: u.@<game id> and i.@<game id> become the set's own; null when it has no such number */
export function resolvePath(set: GameSet, path: string, ids = gameIds(set)): string | null {
  const m = /^([ui])\.@([^.]+)(\..+)$/.exec(path)
  const out = m ? ((id) => (id ? `${m[1]}.${id}${m[3]}` : null))(m[1] === 'u' ? ids.unit(m[2]) : ids.item(m[2])) : path
  return out && validPath(set, out) ? out : null
}

/** The numbers before and after the patch, as layers over the set */
export function patchLayers(set: GameSet, patch: Patch) {
  const ids = gameIds(set), before: Overrides = {}, after: Overrides = {}, missing: string[] = []
  // What the patch touches: units, items, and each trait's breakpoints (all: every one)
  const units = new Set<string>(), items = new Set<string>(), traits = new Map<string, Set<number> | 'all'>()
  let played = 0
  for (const c of patch.changes) {
    let placed = false
    for (const [path, [b, a]] of Object.entries(c.moves ?? {})) {
      const p = resolvePath(set, path, ids)
      if (!p) { missing.push(path); continue }
      before[p] = b
      after[p] = a
      placed = true
      const [kind, id, part, sub] = p.split('.')
      if (kind === 'u') units.add(id)
      else if (kind === 'i') items.add(id)
      else if (kind === 't') {
        const at = /^[bt](\d+)$/.exec(part?.[0] === '$' ? (sub ?? '') : part)
        const had = traits.get(id)
        if (!at) traits.set(id, 'all')
        else if (had !== 'all') traits.set(id, (had ?? new Set<number>()).add(Number(at[1])))
      }
    }
    if (placed) played++
  }
  return { before, after, played, missing, units, items, traits }
}

export function runPatch(set: GameSet, meta: MetaReply | null | undefined, patch: Patch): PatchRun | null {
  if (set.id !== `tft${patch.set}`) return null
  const { before, after, played, missing, units, items, traits } = patchLayers(set, patch)
  if (!played) return null
  const pre = applyOverrides(set, before), post = applyOverrides(set, after)
  const pool = metaToComps(set, meta)
    .filter((c) => c.pieces.length >= 7)
    .sort((a, b) => (b.meta?.games ?? 0) - (a.meta?.games ?? 0))
    .slice(0, RUN.pool)
  const quick = pool.map(() => ({ wins: 0, fights: 0 }))
  for (let a = 0; a < pool.length; a++)
    for (let b = a + 1; b < pool.length; b++) {
      const p = prepare(pre, { blue: onSide(pool[a], 0), red: onSide(pool[b], 1) })
      for (let i = 0; i < RUN.quick; i++) {
        const w = fight(p, fightSeed(7 + a * 31 + b, i)).winner
        quick[a].fights++
        quick[b].fights++
        if (w === 0) quick[a].wins++
        else if (w === 1) quick[b].wins++
      }
    }
  const comps = pool.filter((_, k) => quick[k].fights && Math.abs(quick[k].wins / quick[k].fights - 0.5) <= 0.5 - RUN.edge).slice(0, RUN.comps)
  if (comps.length < 2) return null
  // Kept pair by pair (a pair's first comp is 0, its second 1), so a comp's numbers are of its fights against the
  // comps the page shows, whichever are cut
  const size = comps.length, half = Math.round(RUN.fights / 2)
  const pairs = new Map<number, { fights: number; before: number[]; after: number[]; gained: number[]; lost: number[] }>()
  for (let a = 0; a < size; a++)
    for (let b = a + 1; b < size; b++) {
      const t = { fights: 0, before: [0, 0], after: [0, 0], gained: [0, 0], lost: [0, 0] }
      pairs.set(a * size + b, t)
      for (const flip of [0, 1]) {
        const blue = flip ? b : a, red = flip ? a : b
        const boards = { blue: onSide(comps[blue], 0), red: onSide(comps[red], 1) }
        const p0 = prepare(pre, boards), p1 = prepare(post, boards), seed = 20261112 + a * 101 + b * 7 + flip
        for (let i = 0; i < half; i++) {
          const s = fightSeed(seed, i), was = fight(p0, s).winner, now = fight(p1, s).winner
          t.fights++
          for (const [who, side] of [[flip, 0], [1 - flip, 1]]) {
            if (was === side) t.before[who]++
            if (now === side) t.after[who]++
            if (now === side && was !== side) t.gained[who]++
            else if (was === side && now !== side) t.lost[who]++
          }
        }
      }
    }
  const against = (k: number, among: number[]) => {
    const t = { fights: 0, before: 0, after: 0, gained: 0, lost: 0 }
    for (const o of among) {
      if (o === k) continue
      const p = pairs.get(Math.min(k, o) * size + Math.max(k, o))!, me = k < o ? 0 : 1
      t.fights += p.fights
      t.before += p.before[me]
      t.after += p.after[me]
      t.gained += p.gained[me]
      t.lost += p.lost[me]
    }
    return t
  }
  let shown = comps.map((_, k) => k)
  while (shown.length > 1) {
    const worst = shown
      .map((k) => { const t = against(k, shown); return { k, off: Math.abs(t.before / Math.max(1, t.fights) - 0.5) } })
      .sort((x, y) => y.off - x.off)[0]
    if (worst.off <= 0.5 - RUN.edge) break
    shown = shown.filter((k) => k !== worst.k)
  }
  if (shown.length < 2) return null
  const fights = shown.reduce((n, k) => n + against(k, shown).fights, 0) / 2
  const unitName = new Map(set.units.map((u) => [u.id, u.name])), itemName = new Map(set.items.map((i) => [i.id, i.name]))
  return {
    comps: shown
      .map((k) => {
        const c = comps[k], t = against(k, shown), n = Math.max(1, t.fights), d = (t.gained - t.lost) / n
        const touched = [
          ...new Set([
            ...c.pieces.filter((p) => units.has(p.unit)).map((p) => unitName.get(p.unit) ?? p.unit),
            ...c.pieces.flatMap((p) => p.items).filter((i) => items.has(i)).map((i) => itemName.get(i) ?? i),
            ...activeTraits(set, c.pieces).filter((t) => { const at = traits.get(t.id); return t.level >= 0 && (at === 'all' || !!at?.has(t.level)) }).map((t) => t.name),
          ]),
        ]
        return { name: c.name, touched, fights: t.fights, before: t.before / n, after: t.after / n, delta: d * 100, margin: 1.96 * Math.sqrt(Math.max(0, (t.gained + t.lost) / n - d * d) / n) * 100 }
      })
      .sort((x, y) => y.delta - x.delta),
    fights,
    played,
    missing,
    ...(metaPatch(set, meta?.patch) ? { metaPatch: metaPatch(set, meta?.patch) } : {}),
    at: new Date().toISOString().slice(0, 10),
  }
}
