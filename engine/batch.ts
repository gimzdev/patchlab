import { fight, OUT } from './fight.ts'
import { prepare, type Prepared } from './prepare.ts'
import type { Boards, GameSet } from './types.ts'

/** Many fights added up. units: per fighter, the sums of fight()'s per-unit numbers. */
export interface Tally {
  fights: number
  /** Blue wins, red wins */
  wins: [number, number]
  draws: number
  /** Seconds of combat, added up */
  time: number
  units: number[]
}

/** The live and patched numbers fought on the same seeds, fight by fight */
export interface Paired {
  live: Tally
  patch: Tally | null
  /** Fights blue won only with the patch, and only without it */
  gained: number
  lost: number
}

export const emptyTally = (n: number): Tally => ({ fights: 0, wins: [0, 0], draws: 0, time: 0, units: new Array(n * OUT).fill(0) })

/** Fight i of a run with this seed: the same i gets the same seed in the live and the patched run */
export const fightSeed = (seed: number, i: number) => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(i + 1, 0xc2b2ae35)) >>> 0

const add = (tally: Tally, r: ReturnType<typeof fight>) => {
  tally.fights++
  if (r.winner === -1) tally.draws++
  else tally.wins[r.winner]++
  tally.time += r.time
  for (let k = 0; k < r.units.length; k++) tally.units[k] += r.units[k]
}

const fightable = (p: Prepared) => p.fighters.some((f) => f.side === 0) && p.fighters.some((f) => f.side === 1)

export function runFights(set: GameSet, boards: Boards, seed: number, from: number, count: number): Tally {
  const p = prepare(set, boards), tally = emptyTally(p.fighters.length)
  if (!fightable(p)) return tally
  for (let i = from; i < from + count; i++) add(tally, fight(p, fightSeed(seed, i)))
  return tally
}

/** Fights from..from+count of a run, each fought with the live numbers and (when there's a patch) the patched ones */
export function runPaired(live: Prepared, patch: Prepared | null, seed: number, from: number, count: number): Paired {
  const out: Paired = { live: emptyTally(live.fighters.length), patch: patch ? emptyTally(patch.fighters.length) : null, gained: 0, lost: 0 }
  if (!fightable(live)) return out
  for (let i = from; i < from + count; i++) {
    const s = fightSeed(seed, i), a = fight(live, s)
    add(out.live, a)
    if (patch && out.patch) {
      const b = fight(patch, s)
      add(out.patch, b)
      if (b.winner === 0 && a.winner !== 0) out.gained++
      else if (a.winner === 0 && b.winner !== 0) out.lost++
    }
  }
  return out
}

export function mergeTally(a: Tally, b: Tally): Tally {
  return {
    fights: a.fights + b.fights,
    wins: [a.wins[0] + b.wins[0], a.wins[1] + b.wins[1]],
    draws: a.draws + b.draws,
    time: a.time + b.time,
    units: a.units.map((v, k) => v + (b.units[k] ?? 0)),
  }
}

export function mergePaired(a: Paired, b: Paired): Paired {
  return { live: mergeTally(a.live, b.live), patch: a.patch && b.patch ? mergeTally(a.patch, b.patch) : (a.patch ?? b.patch), gained: a.gained + b.gained, lost: a.lost + b.lost }
}

/**
 * How far blue's win rate moved, in points, and the 95% margin around it. The fights are paired (same seed with and
 * without the patch), so only fights whose result flipped carry noise.
 */
export function shift(p: Paired): { delta: number; margin: number } | null {
  if (!p.patch || !p.live.fights) return null
  const n = p.live.fights, d = (p.gained - p.lost) / n, variance = (p.gained + p.lost) / n - d * d
  return { delta: d * 100, margin: 1.96 * Math.sqrt(Math.max(0, variance) / n) * 100 }
}
