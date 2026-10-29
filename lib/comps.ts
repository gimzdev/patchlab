import { activeTraits } from '@/engine/prepare.ts'
import type { Bonus, GameSet, Item, Piece, Star, Unit } from '@/engine/types.ts'

// Comps: whole boards to put on a side in one go. Three kinds: the meta comps MetaForge measures on ranked games (TFT
// only, fetched), comps built here around each trait of the set, and the boards you saved. A comp's pieces always
// stand on blue's half (rows 4 to 7, row 4 the front line); red gets them turned around.

/** MetaForge's /api/comps: the meta comps of the current set, each a board of game ids */
export interface MetaReply {
  set: number
  patch?: string
  updated?: number
  comps: { id: string; name: string; grade: string | null; avg: number; top4: number; n: number; board: (string | number)[][] }[]
}

export interface Comp {
  id: string
  name: string
  source: 'meta' | 'trait' | 'saved'
  pieces: Piece[]
  /** MetaForge's numbers for a meta comp */
  meta?: { grade: string | null; avg: number; top4: number; games: number }
}

const FRONT = [3, 2, 4, 1, 5, 0, 6]
const BACK = [3, 1, 5, 2, 4, 0, 6]

/** Turns blue's pieces into red's (and back): the board seen from the other side */
export const turn = (p: Piece): Piece => ({ ...p, row: 7 - p.row, col: 6 - p.col })

/** A side's pieces as a comp's (on blue's half) */
export const asComp = (pieces: Piece[], side: 0 | 1) => pieces.map((p) => ({ ...(side ? turn(p) : p), items: [...p.items] }))

/** A comp's pieces on a side */
export const onSide = (comp: Pick<Comp, 'pieces'>, side: 0 | 1) => comp.pieces.map((p) => ({ ...(side ? turn(p) : p), items: [...p.items] }))

/* ── Built from the set ───────────────────────────────── */

const isTank = (u: Unit) => u.stats.range <= 2
const physical = (u: Unit) => u.ability.effects.some((e) => e.type === 'physical' || e.scale === 'ad')
const playable = (set: GameSet) => set.units.filter((u) => u.cost >= 1 && u.cost <= 5 && !/\(/.test(u.name))

const score = {
  ad: (b: Bonus) => (b.adPct ?? 0) * 100 + (b.asPct ?? 0) * 80 + (b.crit ?? 0) * 60 + (b.critDmg ?? 0) * 50 + (b.amp ?? 0) * 120 + (b.stackAs ?? 0) * 300 + (b.omnivamp ?? 0) * 30,
  ap: (b: Bonus) => (b.ap ?? 0) + (b.amp ?? 0) * 120 + (b.manaRegen ?? 0) * 10 + (b.startMana ?? 0) * 0.6 + (b.abilityCrit ?? 0) * 25 + (b.crit ?? 0) * 25,
  tank: (b: Bonus) => (b.hp ?? 0) / 12 + (b.hpPct ?? 0) * 150 + (b.armor ?? 0) + (b.mr ?? 0) + (b.durability ?? 0) * 150 + (b.shield ?? 0) * 100 + (b.omnivamp ?? 0) * 30,
}
const pick = (items: Item[], by: (b: Bonus) => number, n: number, not: Set<string>) =>
  items.filter((i) => !not.has(i.id) && by(i.bonus) > 0).sort((a, b) => by(b.bonus) - by(a.bonus) || a.name.localeCompare(b.name)).slice(0, n).map((i) => i.id)

/** Stands a team the way players do: tanks in front, the rest at the back, the carry in the middle; items on the carry and the main tank */
export function stand(set: GameSet, team: Unit[], core: Unit[] = team): Piece[] {
  const tanks = team.filter(isTank).sort((a, b) => b.stats.hp + b.stats.armor * 4 - (a.stats.hp + a.stats.armor * 4))
  const ranged = team.filter((u) => !isTank(u)).sort((a, b) => b.cost - a.cost || b.stats.ad - a.stats.ad)
  // The carry comes from the comp's own trait when it can
  const carry = ranged.find((u) => core.includes(u)) ?? ranged[0] ?? [...tanks].sort((a, b) => b.cost - a.cost || b.stats.ad - a.stats.ad)[0]
  const tank = tanks.find((u) => u !== carry)
  const used = new Set<string>()
  const itemsFor = (u: Unit) => {
    if (u === carry) return pick(set.items, physical(u) ? score.ad : score.ap, 3, used)
    if (u === tank) return pick(set.items, score.tank, 2, used)
    return []
  }
  const star = (u: Unit): Star => (u.cost <= 3 ? 2 : 1)
  const out: Piece[] = []
  tanks.forEach((u, i) => { const items = itemsFor(u); items.forEach((x) => used.add(x)); out.push({ unit: u.id, star: star(u), items, row: i < 7 ? 4 : 5, col: FRONT[i % 7] }) })
  ranged.forEach((u, i) => { const items = itemsFor(u); items.forEach((x) => used.add(x)); out.push({ unit: u.id, star: star(u), items, row: i < 7 ? 7 : 6, col: BACK[i % 7] }) })
  return out
}

/** A comp's name from its strongest traits: "Elderwood · Defender" */
export function nameOf(set: GameSet, pieces: Piece[]) {
  const top = activeTraits(set, pieces).filter((t) => t.level >= 0 && t.steps.length > 1)
  return top.slice(0, 2).map((t) => t.name).join(' · ') || (pieces.length ? 'Your board' : 'Empty')
}

/** For every trait with a real ladder: its units up to a breakpoint, filled to eight with the units that add the most */
export function traitComps(set: GameSet): Comp[] {
  const pool = playable(set)
  const out: Comp[] = []
  const seen = new Set<string>()
  for (const t of set.traits) {
    const steps = t.breakpoints.map((b) => b.units)
    const members = pool.filter((u) => u.traits.includes(t.id))
    const reach = steps.filter((s) => s >= 2 && s <= Math.min(members.length, 6))
    if (steps.length < 2 || !reach.length) continue
    const core: Unit[] = []
    let fives = 0
    for (const u of [...members].sort((a, b) => b.cost - a.cost || b.traits.length - a.traits.length || a.name.localeCompare(b.name))) {
      if (core.length >= reach[reach.length - 1]) break
      if (u.cost === 5 && fives >= 1) continue
      if (u.cost === 5) fives++
      core.push(u)
    }
    const team = [...core]
    while (team.length < 8) {
      const counts = new Map<string, number>()
      for (const u of team) for (const x of u.traits) counts.set(x, (counts.get(x) ?? 0) + 1)
      let best: Unit | undefined, bestScore = -Infinity
      for (const u of pool) {
        if (team.includes(u) || (u.cost === 5 && fives >= 1)) continue
        let s = u.cost * 0.15
        for (const x of u.traits) {
          if (x === t.id) continue
          const c = counts.get(x) ?? 0, ladder = set.traits.find((y) => y.id === x)?.breakpoints.map((b) => b.units) ?? []
          s += ladder.includes(c + 1) ? 3 : c >= 1 ? 1.2 : ladder.length > 1 ? 0.4 : 0.1
        }
        // A five-cost joins only for a breakpoint, so comps don't all lean on the same one
        if (u.cost === 5 && s < 3.5) continue
        if (s > bestScore) { bestScore = s; best = u }
      }
      if (!best) break
      if (best.cost === 5) fives++
      team.push(best)
    }
    const key = team.map((u) => u.id).sort().join(',')
    if (seen.has(key)) continue
    seen.add(key)
    const pieces = stand(set, team, core)
    const second = activeTraits(set, pieces).filter((x) => x.id !== t.id && x.level >= 0 && x.steps.length > 1)[0]
    out.push({ id: `trait:${t.id}`, name: second ? `${t.name} · ${second.name}` : t.name, source: 'trait', pieces })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/* ── Plants ───────────────────────────────────────────── */

/**
 * Elderwood gives plants to place on the board. A comp from MetaForge lists champions only, so it gets them on free
 * hexes: Stonebark Trees in front, the Lifebloom at the back, the Deepwood Protector at (7); 2-star at (9), 3 at (11).
 */
export function withPlants(set: GameSet, pieces: Piece[]): Piece[] {
  const units = new Map(set.units.map((u) => [u.id, u]))
  if (pieces.some((p) => units.get(p.unit)?.plant)) return pieces
  const wood = activeTraits(set, pieces).find((t) => t.id === 'elderwood')
  if (!wood || wood.level < 0) return pieces
  const plant = (key: string) => set.units.find((u) => u.plant && u.key === key)
  const tree = plant('da_elderwood18_stonebarktree'), bloom = plant('da_elderwood18_lifeblossom'), guard = plant('da_elderwood18_protector')
  const star: Star = wood.level >= 4 ? 3 : wood.level >= 3 ? 2 : 1
  const want: [Unit | undefined, boolean][] = [[tree, true], [bloom, false]]
  if (wood.level >= 1) want.push([tree, true])
  if (wood.level >= 2) want.push([guard, true])
  const taken = new Set(pieces.map((p) => p.row * 7 + p.col)), out = [...pieces]
  for (const [u, front] of want) {
    if (!u) continue
    const spot = (front ? [4, 5, 6, 7] : [7, 6, 5, 4]).flatMap((row) => FRONT.map((col) => row * 7 + col)).find((c) => !taken.has(c))
    if (spot === undefined) break
    taken.add(spot)
    out.push({ unit: u.id, star, items: [], row: Math.floor(spot / 7), col: spot % 7 })
  }
  return out
}

/* ── Meta comps, from MetaForge ───────────────────────── */

// The canonical host: metaforge.lol answers with a redirect, which a cross-origin request can't follow
export const METAFORGE = 'https://www.metaforge.lol/api/comps'
let metaCache: { at: number; reply: Promise<MetaReply | null> } | null = null

/** MetaForge's answer, checked: null when it isn't one */
export function readMeta(json: unknown): MetaReply | null {
  const r = json as MetaReply | null
  if (!r || typeof r !== 'object' || typeof r.set !== 'number' || !Array.isArray(r.comps)) return null
  return { set: r.set, ...(typeof r.patch === 'string' ? { patch: r.patch } : {}), ...(typeof r.updated === 'number' ? { updated: r.updated } : {}), comps: r.comps.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.board)) }
}

/** The game's own id of an item without the copies' marks (the data also has a Corrupted Guinsoo's Rageblade for
 *  another mode, and Academy copies of Thief's Gloves) */
const plainItem = (key: string) => key.toLowerCase().replace(/^tft_item_(corrupted|free)/, 'tft_item_').replace(/_academycopy\d+$/, '')

/** A set's units and items by the game's ids (MetaForge's boards and links use them) as well as their own */
export function gameIds(set: GameSet) {
  const units = new Map<string, string>(), items = new Map<string, string>()
  for (const u of set.units) { units.set(u.id, u.id); if (u.key) units.set(u.key, u.id) }
  for (const i of set.items) {
    items.set(i.id, i.id)
    if (!i.key) continue
    items.set(i.key, i.id)
    if (!items.has(plainItem(i.key))) items.set(plainItem(i.key), i.id)
  }
  return { unit: (key: string) => units.get(String(key).toLowerCase()) ?? units.get(String(key)), item: (key: string) => items.get(String(key)) ?? items.get(String(key).toLowerCase()) ?? items.get(plainItem(String(key))) }
}

/** MetaForge's comps as comps of a set (none when they're on another set); Elderwood comps get their plants */
export function metaToComps(set: GameSet, reply: MetaReply | null | undefined): Comp[] {
  if (!reply || `tft${reply.set}` !== set.id) return []
  const ids = gameIds(set)
  return reply.comps.flatMap((c) => {
    const seen = new Set<number>()
    const pieces: Piece[] = c.board.flatMap(([key, star, hex, ...held]) => {
      const unit = ids.unit(String(key)), h = Number(hex)
      if (!unit || !Number.isInteger(h) || h < 0 || h >= 28 || seen.has(h)) return []
      seen.add(h)
      return [{ unit, star: Math.min(3, Math.max(1, Number(star) || 1)) as Star, items: held.map((i) => ids.item(String(i))).filter((i): i is string => !!i).slice(0, 3), row: 4 + Math.floor(h / 7), col: h % 7 }]
    })
    if (pieces.length < 3 || pieces.length < c.board.length * 0.7) return []
    return [{ id: `meta:${c.id}`, name: c.name, source: 'meta' as const, pieces: withPlants(set, pieces), meta: { grade: c.grade, avg: c.avg, top4: c.top4, games: c.n } }]
  })
}

/**
 * The comps ranked players win with, per MetaForge: fresh from its site, or the copy the set came with (the site
 * fetches it every few hours). null when there are none for this set.
 */
export async function metaComps(set: GameSet): Promise<Comp[] | null> {
  if (!metaCache || Date.now() - metaCache.at > 30 * 60 * 1000) {
    metaCache = {
      at: Date.now(),
      reply: fetch(METAFORGE, { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : null))
        .then(readMeta)
        .catch(() => null),
    }
  }
  const live = await metaCache.reply
  if (!live) metaCache = null
  const comps = metaToComps(set, live)
  if (comps.length) return comps
  const kept = metaToComps(set, set.meta)
  return kept.length ? kept : live || set.meta ? [] : null
}

/* ── Saved comps, in this browser ─────────────────────── */

const savedKey = (entry: string) => `patchlab:v2:comps:${entry}`

export function loadSaved(entry: string): Comp[] {
  try {
    const raw = JSON.parse(localStorage.getItem(savedKey(entry)) ?? '[]') as Comp[]
    return Array.isArray(raw) ? raw.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.pieces)).map((c) => ({ ...c, source: 'saved' as const })) : []
  } catch {
    return []
  }
}

export function storeSaved(entry: string, comps: Comp[]) {
  try {
    localStorage.setItem(savedKey(entry), JSON.stringify(comps.map(({ id, name, pieces }) => ({ id, name, pieces }))))
  } catch {
    /* private mode or full: kept for this visit only */
  }
}
