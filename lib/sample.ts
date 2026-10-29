import { runFights } from '@/engine/batch.ts'
import type { Boards, GameSet } from '@/engine/types.ts'
import { metaToComps, onSide, traitComps, type Comp } from './comps.ts'

// The boards a first visit opens on: two full comps that win about as often as each other, so a patch has room to
// move the result either way. Worked out on the server, where the set is made (app/sets/tft.json).

/**
 * The closest-fought pair among some comps (comps sharing more than two units are left out): a few fights for every
 * pair, then more for the few that looked even, so the pick doesn't rest on luck
 */
function closest(set: GameSet, comps: Comp[], quick: number, more: number, keep = 6): Boards | undefined {
  const gap = (wins: number, draws: number, n: number) => Math.abs(wins / Math.max(1, n) - 0.5) + draws / Math.max(1, n)
  const pairs: { boards: Boards; seed: number; wins: number; draws: number; gap: number }[] = []
  for (let a = 0; a < comps.length; a++)
    for (let b = a + 1; b < comps.length; b++) {
      const shared = comps[a].pieces.filter((p) => comps[b].pieces.some((q) => q.unit === p.unit)).length
      if (shared > 2) continue
      const boards = { blue: onSide(comps[a], 0), red: onSide(comps[b], 1) }, seed = 20261026 + a * 31 + b
      const t = runFights(set, boards, seed, 0, quick)
      pairs.push({ boards, seed, wins: t.wins[0], draws: t.draws, gap: gap(t.wins[0], t.draws, t.fights) })
    }
  let best: { boards: Boards; gap: number } | undefined
  for (const p of pairs.sort((x, y) => x.gap - y.gap).slice(0, keep)) {
    // The same fights carry on (fights quick to quick + more), so the first ones still count
    const t = runFights(set, p.boards, p.seed, quick, more)
    const g = gap(p.wins + t.wins[0], p.draws + t.draws, quick + t.fights)
    if (!best || g < best.gap) best = { boards: p.boards, gap: g }
  }
  return best?.boards
}

/** Two of MetaForge's comps that fight evenly */
export function metaSample(set: GameSet): Boards | undefined {
  const comps = metaToComps(set, set.meta).filter((c) => c.pieces.length >= 7).sort((a, b) => (a.meta?.avg ?? 9) - (b.meta?.avg ?? 9))
  return comps.length >= 2 ? closest(set, comps, 32, 600) : undefined
}

/** Two comps built around the set's traits that fight evenly (sets MetaForge doesn't cover) */
export function balancedSample(set: GameSet): Boards | undefined {
  return closest(set, traitComps(set).filter((c) => c.pieces.length >= 7).slice(0, 12), 40, 300)
}
