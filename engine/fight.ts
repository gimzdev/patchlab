import { DT, EV, F, FLAG, FRAME, MAGIC, NS, OUT, PHYS, S, TRUE, type DamageType } from './consts.ts'
import { CELLS, CX, CY, DIST, NEIGHBORS } from './hex.ts'
import { KITS } from './kits/index.ts'
import type { Fighter, Prepared, SideTraits } from './prepare.ts'
import { rng } from './rng.ts'
import type { Effect, Role, RoleRules, Rules, Side, Star } from './types.ts'

// One fight, in steps of 1/20 of a second. Units pick the closest enemy (tanks a little first), walk a hex at a time
// until it is in range, attack on their attack-speed timer and cast when their mana is full and a target is in range.
// Damage goes through amplification, resistances (less any shred or sunder), durability and shields. A set with a kit
// (engine/kits) plays its abilities, items and traits with scripts: summons, transforms, burns, taunts and the rest.
// Everything random (who goes first, ties, crits) comes from the seed, so a seed always replays the same fight.

export { DT, FLAG, FRAME, OUT }

export interface FightResult {
  /** -1: draw */
  winner: -1 | 0 | 1
  time: number
  units: Float64Array
}

/** A unit that joined the fight: a summon, in a recording slot after the board's units */
export interface Spawn {
  slot: number
  tick: number
  /** The board unit it belongs to */
  owner: number
  side: Side
  name: string
  icon?: string
  /** Drawn this much smaller than a unit */
  size: number
  /** Keeps its side in the fight (a Kruglette does, a Zyra plant doesn't) */
  counts: boolean
}

/** A fight frame by frame, to watch: per tick and slot, FRAME numbers (cell, health, shield, mana, flags, max health) */
export interface Recording {
  ticks: number
  slots: number
  frames: Float32Array
  /** [tick, kind (see EV), from, to] */
  events: number[][]
  spawns: Spawn[]
  /** A unit taking another form: [tick, slot, icon] */
  forms: [number, number, string][]
  /** Every bit of damage, five numbers each: tick, from, to, amount, its F flags * 4 + its type */
  hits: number[]
  /** Every heal, four numbers each: tick, from, to, amount */
  heals: number[]
}
export const emptyRecording = (): Recording => ({ ticks: 0, slots: 0, frames: new Float32Array(0), events: [], spawns: [], forms: [], hits: [], heals: [] })

/** Room for summons past the board's units */
const SUMMON_SLOTS = 32

export interface Attack {
  target: Body
  dmg: number
  type: DamageType
  crit: boolean
  /** A script dealt the attack's damage itself */
  skip: boolean
}

export type Cast = (c: Fight, u: Body, t: Body) => void
export type PreAttack = (c: Fight, u: Body, a: Attack) => void
export type OnAttack = (c: Fight, u: Body, t: Body, a: Attack) => void
export type OnDeal = (c: Fight, u: Body, t: Body, dmg: number, flags: number, type: DamageType) => void
/** blocked: the damage resistances and durability kept off */
export type OnTaken = (c: Fight, u: Body, from: Body, dmg: number, flags: number, type: DamageType, blocked: number) => void
export type OnDeath = (c: Fight, dead: Body, killer: Body | null) => void
export type OnCast = (c: Fight, caster: Body, spent: number) => void
export type Mod = (c: Fight, a: Body, b: Body, flags: number) => number

/** The scripts that play a set: its abilities by unit key, and everything else set up at the start of each fight */
export interface Kit {
  start(c: Fight): void
  casts: Record<string, Cast>
}

interface Buff { stat: number; value: number; start: number; until: number; decay: boolean; key?: string }
interface Shield { amt: number; total: number; start: number; until: number; decay: boolean; src: Body; end?: (c: Fight, u: Body, broke: boolean) => void }
interface Dot { src: Body; rate: number; start: number; until: number; type: DamageType; tag: string }
interface Timer { at: number; every: number; fn: () => unknown; owner: Body | null; dead: boolean }
interface Threshold { at: number; fn: (c: Fight, u: Body) => void; done: boolean }

const NOV: Record<string, number> = Object.freeze({}) as Record<string, number>

/** A unit in a fight: one from the board, or one summoned */
export class Body {
  f: Fighter | null = null
  key = ''
  star: Star = 1
  role: Role | undefined = undefined
  cost = 0
  /** The ability's numbers at its star */
  v: Record<string, number> = NOV
  traits: string[] = []
  master: Body | null = null
  summon = false
  /** Keeps its side in the fight */
  counts = true
  /** Can't be targeted and stands on no hex (Zyra's plants, Tiny Beaks) */
  ghost = false
  immobile = false
  /** Doesn't attack or cast (a Stonebark Tree) */
  inert = false
  noCast = false
  alive = true
  cell = 0
  icon: string | undefined = undefined
  hp = 0
  maxHp = 1
  mana = 0
  maxMana = 0
  /** Mana Reave: more mana needed for the next cast */
  reave = 0
  manaMult = 1
  /** No mana until then: the game's mana lock, while a cast's effect lasts (empowered attacks, a timed buff) */
  manaLockUntil = 0
  manaPerAttack = 0
  manaRegen = 0
  /** Gains mana from damage taken */
  tankMana = false
  adBase = 0
  adPct = 0
  adMult = 1
  asBase = 0
  asPct = 0
  ap = 100
  apMult = 1
  armor = 0
  mr = 0
  crit = 0.25
  critDmg = 1.4
  vamp = 0
  amp = 0
  dur = 0
  range = 1
  /** Sources of Precision: abilities can crit */
  precision = 0
  armorIgnore = 0
  stackAs = 0
  /** Damage kills enemies below this share of their max health */
  execute = 0
  /** Armor and magic resist per enemy targeting it (Monolith, Gargoyle Stoneplate) */
  perTargeter = 0
  /** Timed buffs, summed by stat slot (S) */
  readonly t = new Float64Array(NS)
  buffs: Buff[] = []
  shields: Shield[] = []
  shieldTotal = 0
  dots: Dot[] = []
  stunUntil = 0
  castUntil = 0
  untargetableUntil = 0
  invulnUntil = 0
  /** Immune to crowd control */
  unstoppableUntil = 0
  sleepUntil = 0
  sleepLeft = 0
  sleepWake: ((c: Fight, u: Body) => void) | null = null
  wound = 0
  woundUntil = 0
  shred = 0
  shredUntil = 0
  sunder = 0
  sunderUntil = 0
  vuln = 0
  vulnUntil = 0
  chill = 0
  chillUntil = 0
  /** The strongest burn (burns don't stack) and Inferno's own, which stacks with it */
  burn = 0
  burnUntil = 0
  burnFrom: Body | null = null
  hot = 0
  hotUntil = 0
  hotFrom: Body | null = null
  /** Armor and magic resist taken away for the rest of the fight */
  armorDown = 0
  mrDown = 0
  target: Body | null = null
  targetSince = 0
  /** Taunted: it must attack this unit */
  forced: Body | null = null
  forcedUntil = 0
  attackAt = 0
  moveAt = 0
  attacks = 0
  casts = 0
  dealt = 0
  /** Changes when a channel is interrupted */
  channel = 0
  targetersTick = -1
  targeterCount = 0
  /** A script's own numbers, and anything else it keeps */
  n: Record<string, number> = {}
  refs: Record<string, unknown> | null = null
  /** An ability that replaced the unit's own (Mega Gnar's Grab n' Throw) */
  ability: Cast | null = null
  preAttack: PreAttack[] | null = null
  onAttack: OnAttack[] | null = null
  onDeal: OnDeal[] | null = null
  onTaken: OnTaken[] | null = null
  onDeath: OnDeath[] | null = null
  thresholds: Threshold[] | null = null
  ampMods: Mod[] | null = null
  durMods: Mod[] | null = null
  constructor(readonly i: number, readonly side: Side, public owner: number, public name: string) {}
}

export interface SpawnOptions {
  name: string
  icon?: string
  size?: number
  cell: number
  hp: number
  ad: number
  as: number
  armor: number
  mr: number
  range: number
  ap?: number
  ghost?: boolean
  counts?: boolean
  immobile?: boolean
  /** Seconds before it goes away */
  duration?: number
}

export class Fight {
  readonly R: () => number
  readonly rules: Rules
  readonly roles: RoleRules | undefined
  readonly kit: Kit | null
  readonly units: Body[] = []
  /** Units from the board: the first n bodies */
  readonly n: number
  readonly traits: [SideTraits, SideTraits]
  readonly summons: Record<string, string>
  readonly out: Float64Array
  readonly occ = new Int16Array(CELLS).fill(-1)
  readonly left = [0, 0]
  readonly cap: number
  now = 0
  tick = 0
  overtime = 1
  private timers: Timer[] = []
  private deadTimers = 0
  private deathHooks: OnDeath[] | null = null
  private castHooks: OnCast[] | null = null
  private readonly rec: Recording | undefined

  constructor(p: Prepared, seed: number, rec?: Recording) {
    this.R = rng(seed)
    this.rules = p.rules
    this.kit = (p.kit && KITS[p.kit]) || null
    this.roles = this.kit ? p.rules.roles : undefined
    this.traits = p.traits
    this.summons = p.summons
    this.n = p.fighters.length
    this.cap = this.n + SUMMON_SLOTS
    this.out = new Float64Array(this.n * OUT)
    this.rec = rec
    p.fighters.forEach((f, i) => this.place(f, i))
  }

  private place(f: Fighter, i: number) {
    const u = new Body(i, f.side, i, f.name)
    this.units.push(u)
    u.f = f
    u.key = f.key ?? ''
    u.star = f.star
    u.role = f.role
    u.cost = f.cost
    u.v = f.v
    u.traits = f.traits
    u.hp = u.maxHp = f.hp
    u.maxMana = f.mana
    u.mana = f.startMana
    u.manaRegen = f.manaRegen
    u.adBase = f.adBase
    u.adPct = f.adPct
    u.asBase = f.asBase
    u.asPct = f.asPct
    u.ap = f.ap
    u.armor = f.armor
    u.mr = f.mr
    u.crit = f.crit
    // More than one source of Precision: each extra one is 10% crit damage
    u.critDmg = f.critDmg + (this.kit && f.abilityCrit > 1 ? 0.1 * (f.abilityCrit - 1) : 0)
    u.precision = f.abilityCrit
    u.vamp = f.omnivamp
    u.amp = f.amp
    u.dur = f.durability
    u.range = f.range
    u.stackAs = f.stackAs
    const roles = this.roles
    u.manaPerAttack = roles ? (f.role ? roles[f.role] : 0) : this.rules.manaPerAttack
    u.tankMana = roles ? f.role === 'tank' : true
    if (this.occ[f.cell] >= 0) { u.alive = false; return } // two units on one hex: the second sits out
    u.cell = f.cell
    this.occ[f.cell] = i
    this.left[f.side]++
    u.attackAt = 0.1 + this.R() * 0.3
    if (f.shield > 0) this.shield(u, u, f.shield * f.hp, 8)
  }

  /* ── Reading a unit's numbers ─────────────────────────── */

  ad(u: Body) { return Math.max(0, u.adBase * (1 + u.adPct + u.t[S.ad]) * u.adMult) }
  ap(u: Body) { return Math.max(0, (u.ap + u.t[S.ap]) * u.apMult) }
  as(u: Body) {
    const chill = this.now < u.chillUntil ? 1 - u.chill : 1
    return Math.min(this.rules.maxAs, Math.max(0.1, u.asBase * (1 + u.asPct + u.t[S.as]) * chill))
  }
  armor(u: Body) { return u.armor + u.t[S.armor] + u.perTargeter * this.targeters(u) - u.armorDown }
  mr(u: Body) { return u.mr + u.t[S.mr] + u.perTargeter * this.targeters(u) - u.mrDown }
  critChance(u: Body) { return Math.min(1, u.crit + u.t[S.crit]) }
  hpShare(u: Body) { return u.alive ? u.hp / u.maxHp : 0 }
  /** attack damage × ad + ability power × ap / 100 + max health × hp */
  scale(u: Body, ad: number, ap = 0, hp = 0) { return (ad ? ad * this.ad(u) : 0) + (ap ? (ap * this.ap(u)) / 100 : 0) + (hp ? hp * u.maxHp : 0) }
  /** An ability number that scales with ability power */
  byAp(u: Body, x: number) { return (x * this.ap(u)) / 100 }
  /** Has AP or AD grown more (Adaptor abilities change with it) */
  apMode(u: Body) {
    const ad = u.adPct + u.t[S.ad], ap = (u.ap - 100 + u.t[S.ap]) / 100
    return ap > ad + 1e-9 || (Math.abs(ap - ad) <= 1e-9 && /_ap$/.test(u.key))
  }

  targetable(b: Body) { return b.alive && !b.ghost && this.now >= b.untargetableUntil }

  /** Enemies targeting a unit, counted once a tick */
  targeters(u: Body) {
    if (!u.perTargeter) return 0
    if (u.targetersTick !== this.tick) {
      let k = 0
      for (const b of this.units) if (b.alive && b.target === u && b.side !== u.side) k++
      u.targeterCount = k
      u.targetersTick = this.tick
    }
    return u.targeterCount
  }

  /* ── Who's where ─────────────────────────────────────── */

  dist(a: Body | number, b: Body | number) { return DIST[(typeof a === 'number' ? a : a.cell) * CELLS + (typeof b === 'number' ? b : b.cell)] }

  /** Targetable units of a side */
  side(side: number): Body[] {
    const out: Body[] = []
    for (const b of this.units) if (b.side === side && this.targetable(b)) out.push(b)
    return out
  }
  enemies(u: Body) { return this.side(1 - u.side) }
  /** Living allies (itself included unless told not to), summons left out unless asked */
  allies(u: Body, self = true, summons = false): Body[] {
    const out: Body[] = []
    for (const b of this.units) if (b.side === u.side && b.alive && !b.ghost && (self || b !== u) && (summons || !b.summon)) out.push(b)
    return out
  }
  /** Targetable units of a side within r hexes of a cell */
  around(cell: number, r: number, side: number): Body[] {
    const out: Body[] = []
    for (const b of this.units) if (b.side === side && this.targetable(b) && DIST[cell * CELLS + b.cell] <= r) out.push(b)
    return out
  }
  /** Units of a list ordered by distance from a cell, ties at random */
  byDistance(list: Body[], cell: number): Body[] {
    return list.map((b) => [DIST[cell * CELLS + b.cell] + this.R() * 0.5, b] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1])
  }
  nearest(list: Body[], cell: number): Body | null {
    let best: Body | null = null, bestD = 1e9, ties = 0
    for (const b of list) {
      const d = DIST[cell * CELLS + b.cell]
      if (d < bestD) { best = b; bestD = d; ties = 1 }
      else if (d === bestD && this.R() * ++ties < 1) best = b
    }
    return best
  }
  farthest(list: Body[], cell: number): Body | null {
    let best: Body | null = null, bestD = -1, ties = 0
    for (const b of list) {
      const d = DIST[cell * CELLS + b.cell]
      if (d > bestD) { best = b; bestD = d; ties = 1 }
      else if (d === bestD && this.R() * ++ties < 1) best = b
    }
    return best
  }
  /** The unit with the least health (or the least share of it), ties at random */
  lowest(list: Body[], share = false): Body | null {
    let best: Body | null = null, low = Infinity, ties = 0
    for (const b of list) {
      const v = share ? b.hp / b.maxHp : b.hp
      if (v < low - 1e-9) { low = v; best = b; ties = 1 }
      else if (Math.abs(v - low) <= 1e-9 && this.R() * ++ties < 1) best = b
    }
    return best
  }

  /** Units of a side along a line from one cell through another and on, nearest first */
  line(from: number, toward: number, side: number, width = 0.62, length = 9): Body[] {
    const dx = CX[toward] - CX[from], dy = CY[toward] - CY[from], len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    const hits: [number, Body][] = []
    for (const b of this.units) {
      if (b.side !== side || !this.targetable(b)) continue
      const px = CX[b.cell] - CX[from], py = CY[b.cell] - CY[from], along = px * ux + py * uy
      if (along <= 0.01 || along > length || Math.abs(px * uy - py * ux) > width) continue
      hits.push([along, b])
    }
    return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1])
  }
  /** The cells a line from one cell through another crosses */
  lineCells(from: number, toward: number, width = 0.62, length = 9): number[] {
    const dx = CX[toward] - CX[from], dy = CY[toward] - CY[from], len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len, out: number[] = []
    for (let c = 0; c < CELLS; c++) {
      const px = CX[c] - CX[from], py = CY[c] - CY[from], along = px * ux + py * uy
      if (along > 0.01 && along <= length && Math.abs(px * uy - py * ux) <= width) out.push(c)
    }
    return out
  }
  /** The line from a unit through the most enemies (through `must` when given) */
  bestLine(u: Body, must?: Body | null): Body[] {
    let best: Body[] = [], n = -1
    const foes = this.enemies(u)
    for (const e of must ? [must, ...foes] : foes) {
      const l = this.line(u.cell, e.cell, 1 - u.side)
      if (must && !l.includes(must)) continue
      if (l.length > n) { best = l; n = l.length }
    }
    return best
  }
  /** Units of a side in a cone from a cell toward another, within r hexes */
  cone(from: number, toward: number, side: number, r: number, cos = 0.5): Body[] {
    const dx = CX[toward] - CX[from], dy = CY[toward] - CY[from], len = Math.hypot(dx, dy) || 1
    const out: Body[] = []
    for (const b of this.units) {
      if (b.side !== side || !this.targetable(b) || DIST[from * CELLS + b.cell] > r) continue
      const px = CX[b.cell] - CX[from], py = CY[b.cell] - CY[from], l = Math.hypot(px, py)
      if (l < 0.01 || (px * dx + py * dy) / (l * len) >= cos) out.push(b)
    }
    return out
  }
  /** The cell within `within` hexes of a unit with the most enemies within r of it */
  bestCell(u: Body, r: number, within: number): number {
    const foes = this.enemies(u)
    let best = u.target?.cell ?? u.cell, bestN = 0, ties = 0
    for (let c = 0; c < CELLS; c++) {
      if (DIST[u.cell * CELLS + c] > within) continue
      let k = 0
      for (const e of foes) if (DIST[c * CELLS + e.cell] <= r) k++
      if (k > bestN) { best = c; bestN = k; ties = 1 }
      else if (k === bestN && k > 0 && this.R() * ++ties < 1) best = c
    }
    return best
  }
  /** The free cell nearest a cell, ties at random (-1: none within maxD) */
  freeNear(cell: number, maxD = 7, avoid = -1): number {
    let best = -1, bestD = 1e9, ties = 0
    for (let c = 0; c < CELLS; c++) {
      if (this.occ[c] >= 0 || c === avoid) continue
      const d = DIST[cell * CELLS + c]
      if (d > maxD) continue
      if (d < bestD) { best = c; bestD = d; ties = 1 }
      else if (d === bestD && this.R() * ++ties < 1) best = c
    }
    return best
  }

  /* ── Moving ──────────────────────────────────────────── */

  /** Puts a unit on a free cell at once (a dash, a leap or a blink) */
  moveTo(u: Body, cell: number) {
    if (cell < 0 || cell === u.cell || this.occ[cell] >= 0 || u.ghost) return false
    if (this.occ[u.cell] === u.i) this.occ[u.cell] = -1
    this.occ[cell] = u.i
    u.cell = cell
    u.moveAt = this.now + 0.1
    this.event(EV.dash, u, cell)
    return true
  }
  /** Next to a unit, on the side nearest where it stands */
  leap(u: Body, to: Body) {
    let best = -1, bestD = 1e9, ties = 0
    for (const nb of NEIGHBORS[to.cell]) {
      if (this.occ[nb] >= 0) continue
      const d = DIST[u.cell * CELLS + nb]
      if (d < bestD) { best = nb; bestD = d; ties = 1 }
      else if (d === bestD && this.R() * ++ties < 1) best = nb
    }
    if (best < 0) best = this.freeNear(to.cell, 2)
    return this.moveTo(u, best)
  }
  /** Away from a unit, while staying in range of it */
  blinkAway(u: Body, from: Body, steps = 2) {
    let best = -1, bestD = DIST[u.cell * CELLS + from.cell], ties = 0
    for (let c = 0; c < CELLS; c++) {
      if (this.occ[c] >= 0 || DIST[u.cell * CELLS + c] > steps) continue
      const d = DIST[c * CELLS + from.cell]
      if (d > u.range) continue
      if (d > bestD) { best = c; bestD = d; ties = 1 }
      else if (d === bestD && best >= 0 && this.R() * ++ties < 1) best = c
    }
    return best >= 0 && this.moveTo(u, best)
  }

  /** A hex closer to the target; sideways when the way is blocked, so lines don't jam */
  private step(u: Body, t: Body) {
    const here = u.cell, goal = t.cell, current = DIST[here * CELLS + goal]
    let best = -1, bestD = current, ties = 0
    for (const nb of NEIGHBORS[here]) {
      if (this.occ[nb] >= 0) continue
      const d = DIST[nb * CELLS + goal]
      if (d < bestD) { best = nb; bestD = d; ties = 1 }
      else if (d === bestD && (best >= 0 || d < current) && this.R() * ++ties < 1) best = nb
    }
    if (best < 0) {
      for (const nb of NEIGHBORS[here]) if (this.occ[nb] < 0 && DIST[nb * CELLS + goal] === current && this.R() * ++ties < 1) best = nb
      if (best < 0 || this.R() < 0.5) { u.moveAt = this.now + this.rules.moveTime / 2; u.target = null; return }
    }
    this.occ[here] = -1
    this.occ[best] = u.i
    u.cell = best
    u.moveAt = this.now + this.rules.moveTime
  }

  /* ── Targets ─────────────────────────────────────────── */

  /** The closest enemy it can hit (tanks count as a little closer), or the one taunting it */
  nearestEnemy(u: Body): Body | null {
    if (u.forced && this.now < u.forcedUntil && this.targetable(u.forced)) return u.forced
    let best: Body | null = null, bestD = 1e9, ties = 0
    const pull = this.roles?.tankPull ?? 0
    for (const b of this.units) {
      if (b.side === u.side || !this.targetable(b)) continue
      const d = DIST[u.cell * CELLS + b.cell] - (b.role === 'tank' ? pull : 0)
      if (d < bestD - 1e-9) { best = b; bestD = d; ties = 1 }
      else if (Math.abs(d - bestD) <= 1e-9 && this.R() * ++ties < 1) best = b
    }
    return best
  }
  private targetOf(u: Body): Body | null {
    if (u.forced && this.now < u.forcedUntil && this.targetable(u.forced)) {
      if (u.target !== u.forced) { u.target = u.forced; u.targetSince = this.now }
      return u.forced
    }
    const t = u.target
    if (t && this.targetable(t)) return t
    const next = this.nearestEnemy(u)
    if (next !== u.target) { u.target = next; u.targetSince = this.now }
    return next
  }
  /** Enemies within r hexes must attack it for a while */
  taunt(u: Body, r: number, seconds: number) {
    for (const b of this.units) {
      if (b.side === u.side || !b.alive || b.ghost || DIST[u.cell * CELLS + b.cell] > r) continue
      b.forced = u
      b.forcedUntil = this.now + seconds
      if (b.target !== u) { b.target = u; b.targetSince = this.now }
    }
  }

  /* ── Damage, healing, shields ────────────────────────── */

  /** Ability damage, recorded as a hit */
  hit(src: Body, dst: Body, amount: number, type: DamageType, flags = 0) {
    if (!dst.alive) return 0
    this.event(EV.hit, src, dst)
    return this.deal(src, dst, amount, type, F.ability | flags)
  }

  /** Damage from one unit to another, after everything that changes it. Returns what landed (shields included). */
  deal(src: Body, dst: Body, raw: number, type: DamageType, flags: number): number {
    if (!dst.alive || !(raw > 0)) return 0
    const now = this.now
    if (now < dst.invulnUntil) return 0
    if (flags & F.ability && !(flags & (F.dot | F.nocrit | F.crit)) && src.precision > 0 && this.R() < this.critChance(src)) { raw *= src.critDmg; flags |= F.crit }
    let amp = 1 + src.amp + src.t[S.amp]
    if (src.ampMods) for (const m of src.ampMods) amp += m(this, src, dst, flags)
    let dmg = raw * Math.max(0, amp) * this.overtime
    if (now < dst.vulnUntil) dmg *= 1 + dst.vuln
    const before = dmg
    if (type === PHYS) {
      const ar = (dst.armor + dst.t[S.armor] + dst.perTargeter * this.targeters(dst)) * (now < dst.sunderUntil ? 1 - dst.sunder : 1) - dst.armorDown
      dmg *= 100 / (100 + Math.max(0, ar * (1 - Math.min(1, src.armorIgnore + src.t[S.ignore]))))
    } else if (type === MAGIC) {
      const mr = (dst.mr + dst.t[S.mr] + dst.perTargeter * this.targeters(dst)) * (now < dst.shredUntil ? 1 - dst.shred : 1) - dst.mrDown
      dmg *= 100 / (100 + Math.max(0, mr))
    }
    let dur = dst.dur + dst.t[S.dur]
    if (dst.durMods) for (const m of dst.durMods) dur += m(this, dst, src, flags)
    if (this.roles && dst.role === 'assassin' && dst.target !== src && dst.target !== src.master) dur += this.roles.assassinDr
    dmg *= 1 - Math.min(0.9, dur)
    const blocked = Math.max(0, before - dmg)
    if (now < dst.sleepUntil) {
      dst.sleepLeft -= dmg
      if (dst.sleepLeft <= 0) { dst.sleepUntil = 0; const wake = dst.sleepWake; dst.sleepWake = null; wake?.(this, dst) }
    }
    let rest = dmg
    if (dst.shieldTotal > 0) rest = this.absorb(dst, dmg)
    dst.hp -= rest
    this.out[src.owner * OUT] += dmg
    this.out[dst.owner * OUT + 1] += dmg
    if (this.rec && dmg > 0) this.rec.hits.push(this.tick, src.i, dst.i, dmg, flags * 4 + type)
    src.dealt += dmg
    if (src.master) src.master.dealt += dmg
    if (dst.tankMana && dst.maxMana > 0 && now >= dst.castUntil && now >= dst.manaLockUntil) {
      const [a, b] = this.rules.manaFromDamage
      dst.mana = Math.min(dst.maxMana + dst.reave, dst.mana + Math.min(this.rules.maxManaFromDamage, raw * a + dmg * b) * dst.manaMult)
    }
    const vamp = src.vamp + src.t[S.vamp]
    if (vamp > 0 && src.alive && !(flags & F.dot)) this.heal(src, src, dmg * vamp)
    if (dst.hp <= 0) this.kill(dst, src)
    else if (src.execute > 0 && dst.hp < dst.maxHp * src.execute) this.kill(dst, src)
    if (!(flags & (F.quiet | F.dot))) {
      if (src.onDeal) for (const h of src.onDeal) h(this, src, dst, dmg, flags, type)
      if (dst.alive && dst.onTaken) for (const h of dst.onTaken) h(this, dst, src, dmg, flags, type, blocked)
    }
    if (dst.alive && dst.thresholds) this.thresholdsOf(dst)
    return dmg
  }

  private absorb(u: Body, dmg: number) {
    // Shields that end soonest take the damage first
    if (u.shields.length > 1) u.shields.sort((a, b) => a.until - b.until)
    let rest = dmg
    for (let k = 0; k < u.shields.length && rest > 0; k++) {
      const s = u.shields[k], take = Math.min(s.amt, rest)
      s.amt -= take
      rest -= take
    }
    let total = 0
    for (let k = u.shields.length - 1; k >= 0; k--) {
      const s = u.shields[k]
      if (s.amt <= 1e-6) { u.shields.splice(k, 1); s.end?.(this, u, true) }
      else total += s.amt
    }
    u.shieldTotal = total
    return rest
  }

  heal(src: Body, dst: Body, amount: number) {
    if (!dst.alive || !(amount > 0)) return 0
    if (this.now < dst.woundUntil) amount *= 1 - dst.wound
    const h = Math.min(amount, dst.maxHp - dst.hp)
    if (h <= 0) return 0
    dst.hp += h
    this.out[src.owner * OUT + 2] += h
    if (this.rec) this.rec.heals.push(this.tick, src.i, dst.i, h)
    if (src.n.healed !== undefined) src.n.healed += h
    return h
  }

  /** A shield: decaying ones shrink to nothing over their duration; `end` runs when it breaks or runs out */
  shield(src: Body, dst: Body, amount: number, seconds: number, end?: (c: Fight, u: Body, broke: boolean) => void, decay = false) {
    if (!dst.alive || !(amount > 0)) return
    dst.shields.push({ amt: amount, total: amount, start: this.now, until: this.now + Math.max(0.05, seconds), decay, src, end })
    dst.shieldTotal += amount
    this.out[src.owner * OUT + 3] += amount
  }

  /** Grows a unit's max health, healing it by as much */
  growHp(u: Body, amount: number) {
    if (!u.alive || amount === 0) return
    u.maxHp = Math.max(1, u.maxHp + amount)
    u.hp = Math.min(u.maxHp, Math.max(1, u.hp + Math.max(0, amount)))
  }

  kill(dst: Body, src: Body | null) {
    if (!dst.alive) return
    dst.alive = false
    dst.hp = 0
    dst.shields = []
    dst.shieldTotal = 0
    if (this.occ[dst.cell] === dst.i) this.occ[dst.cell] = -1
    if (dst.counts) this.left[dst.side]--
    this.event(EV.death, dst, dst)
    if (dst.onDeath) for (const h of dst.onDeath) h(this, dst, src)
    if (this.deathHooks) for (const h of this.deathHooks) h(this, dst, src)
  }

  /* ── Effects that last ───────────────────────────────── */

  /** A stat raised for a while. Buffs add up, except one with a key: the same key again (an ability cast again while
   *  its buff lasts) replaces it, as the game refreshes the buff instead of stacking it */
  buff(u: Body, stat: number, value: number, seconds: number, decay = false, key?: string) {
    if (!u.alive || !value) return
    if (key !== undefined) {
      const k = u.buffs.findIndex((b) => b.key === key)
      if (k >= 0) {
        const b = u.buffs[k]
        u.t[b.stat] -= b.decay ? (b.value * Math.max(0, b.until - this.now)) / (b.until - b.start) : b.value
        u.buffs.splice(k, 1)
      }
    }
    u.buffs.push({ stat, value, start: this.now, until: this.now + seconds, decay, key })
    u.t[stat] += value
  }
  stun(src: Body, dst: Body, seconds: number) {
    if (!dst.alive || !(seconds > 0) || this.now < dst.unstoppableUntil || this.now < dst.invulnUntil) return
    dst.stunUntil = Math.max(dst.stunUntil, this.now + seconds)
    this.interrupt(dst)
  }
  /** Asleep until it takes `wake` damage or the time runs out */
  sleep(dst: Body, seconds: number, wake: number, onWake?: (c: Fight, u: Body) => void) {
    if (!dst.alive || this.now < dst.unstoppableUntil || this.now < dst.invulnUntil) return
    dst.sleepUntil = Math.max(dst.sleepUntil, this.now + seconds)
    dst.sleepLeft = wake
    dst.sleepWake = onWake ?? null
    this.interrupt(dst)
  }
  /** Ends a channel the unit was casting */
  interrupt(u: Body) {
    if (u.n.channeling) { u.channel++; u.n.channeling = 0; u.castUntil = this.now }
  }
  /** The unit can't act for a while: a long cast or a channel */
  lock(u: Body, seconds: number, channel = false) {
    u.castUntil = this.now + seconds
    if (channel) { u.n.channeling = 1; return ++u.channel }
    return u.channel
  }
  wound(dst: Body, share: number, seconds: number) {
    if (!dst.alive) return
    dst.wound = this.now < dst.woundUntil ? Math.max(dst.wound, share) : share
    dst.woundUntil = Math.max(dst.woundUntil, this.now + seconds)
  }
  /** Magic resist cut by a share */
  shredIt(dst: Body, share: number, seconds: number) {
    dst.shred = this.now < dst.shredUntil ? Math.max(dst.shred, share) : share
    dst.shredUntil = Math.max(dst.shredUntil, this.now + seconds)
  }
  /** Armor cut by a share */
  sunderIt(dst: Body, share: number, seconds: number) {
    dst.sunder = this.now < dst.sunderUntil ? Math.max(dst.sunder, share) : share
    dst.sunderUntil = Math.max(dst.sunderUntil, this.now + seconds)
  }
  vulnerable(dst: Body, share: number, seconds: number) {
    dst.vuln = this.now < dst.vulnUntil ? Math.max(dst.vuln, share) : share
    dst.vulnUntil = Math.max(dst.vulnUntil, this.now + seconds)
  }
  /** Attack speed cut by a share */
  chill(dst: Body, share: number, seconds: number) {
    if (this.now < dst.unstoppableUntil) return
    dst.chill = this.now < dst.chillUntil ? Math.max(dst.chill, share) : share
    dst.chillUntil = Math.max(dst.chillUntil, this.now + seconds)
  }
  /** A share of max health as true damage every second. Inferno's burns stack with the others. */
  burn(src: Body, dst: Body, share: number, seconds: number, inferno = false) {
    if (!dst.alive || !(share > 0)) return
    if (inferno) {
      if (this.now >= dst.hotUntil || share >= dst.hot) { dst.hot = share; dst.hotFrom = src }
      dst.hotUntil = Math.max(dst.hotUntil, this.now + seconds)
    } else {
      if (this.now >= dst.burnUntil || share >= dst.burn) { dst.burn = share; dst.burnFrom = src }
      dst.burnUntil = Math.max(dst.burnUntil, this.now + seconds)
    }
  }
  /** Damage spread over a time (bleeds, poisons) */
  dot(src: Body, dst: Body, total: number, seconds: number, type: DamageType, tag = '') {
    if (!dst.alive || !(total > 0)) return
    dst.dots.push({ src, rate: total / Math.max(0.05, seconds), start: this.now, until: this.now + seconds, type, tag })
  }
  /** Takes off disables (all: and every other harmful effect) */
  cleanse(u: Body, all = false) {
    u.stunUntil = 0
    u.sleepUntil = 0
    u.chillUntil = 0
    u.forcedUntil = 0
    if (all) { u.woundUntil = 0; u.burnUntil = 0; u.hotUntil = 0; u.shredUntil = 0; u.sunderUntil = 0; u.vulnUntil = 0; u.dots = [] }
  }
  addMana(u: Body, amount: number) {
    if (u.maxMana <= 0 || !u.alive || this.now < u.castUntil || this.now < u.manaLockUntil) return
    u.mana = Math.min(u.maxMana + u.reave, u.mana + amount * u.manaMult)
  }
  /** Mana lock: the unit gains no mana while its cast's effect lasts, for some seconds or until unlocked, as in the
   *  game (so an ability that refills the bar, like Azir's commands, can't chain into itself) */
  manaLock(u: Body, seconds = Infinity) { u.manaLockUntil = Math.max(u.manaLockUntil, this.now + seconds) }
  manaUnlock(u: Body) { u.manaLockUntil = 0 }

  private tickDots(u: Body, dt: number) {
    const now = this.now, from = now - dt
    // Damage can change the list (a cleanse, a bleed cashed in): go through the one there was
    const list = u.dots
    let ended = false
    for (let k = list.length - 1; k >= 0 && u.alive; k--) {
      const d = list[k]
      const span = Math.min(now, d.until) - Math.max(from, d.start)
      if (span > 0) this.deal(d.src, u, d.rate * span, d.type, F.dot)
      if (now >= d.until) ended = true
    }
    if (ended && u.dots.length) u.dots = u.dots.filter((d) => d.until > now)
    if (u.alive && from < u.burnUntil && u.burnFrom) this.deal(u.burnFrom, u, u.maxHp * u.burn * Math.min(dt, u.burnUntil - from), TRUE, F.dot)
    if (u.alive && from < u.hotUntil && u.hotFrom) this.deal(u.hotFrom, u, u.maxHp * u.hot * Math.min(dt, u.hotUntil - from), TRUE, F.dot)
  }

  private refresh(u: Body) {
    const now = this.now
    if (u.shields.length) {
      let total = 0
      for (let k = u.shields.length - 1; k >= 0; k--) {
        const s = u.shields[k]
        if (now >= s.until) { u.shields.splice(k, 1); s.end?.(this, u, false); continue }
        if (s.decay) s.amt = Math.min(s.amt, (s.total * (s.until - now)) / (s.until - s.start))
        total += s.amt
      }
      u.shieldTotal = total
    }
    if (u.buffs.length) {
      const t = u.t
      t.fill(0)
      for (let k = u.buffs.length - 1; k >= 0; k--) {
        const b = u.buffs[k]
        if (now >= b.until) { u.buffs.splice(k, 1); continue }
        t[b.stat] += b.decay ? (b.value * (b.until - now)) / (b.until - b.start) : b.value
      }
    }
  }

  /* ── Hooks, timers, summons ──────────────────────────── */

  pre(u: Body, h: PreAttack) { (u.preAttack ??= []).push(h) }
  onHit(u: Body, h: OnAttack) { (u.onAttack ??= []).push(h) }
  onDeal(u: Body, h: OnDeal) { (u.onDeal ??= []).push(h) }
  onTaken(u: Body, h: OnTaken) { (u.onTaken ??= []).push(h) }
  onDeath(u: Body, h: OnDeath) { (u.onDeath ??= []).push(h) }
  anyDeath(h: OnDeath) { (this.deathHooks ??= []).push(h) }
  anyCast(h: OnCast) { (this.castHooks ??= []).push(h) }
  ampMod(u: Body, m: Mod) { (u.ampMods ??= []).push(m) }
  durMod(u: Body, m: Mod) { (u.durMods ??= []).push(m) }
  /** Once, the first time its health falls to a share */
  onBelow(u: Body, share: number, fn: (c: Fight, u: Body) => void) { (u.thresholds ??= []).push({ at: share, fn, done: false }) }
  private thresholdsOf(u: Body) {
    const share = u.hp / u.maxHp
    for (const th of u.thresholds!) if (!th.done && share <= th.at) { th.done = true; th.fn(this, u); if (!u.alive) return }
  }

  /** Runs once after a time (stops if the owner dies first, when there is one) */
  after(seconds: number, fn: () => unknown, owner: Body | null = null) {
    this.timers.push({ at: this.now + seconds - 1e-9, every: 0, fn, owner, dead: false })
  }
  /** Runs every `seconds` until it returns false (or the owner dies) */
  every(seconds: number, fn: () => unknown, owner: Body | null = null, first = seconds) {
    this.timers.push({ at: this.now + first - 1e-9, every: seconds, fn, owner, dead: false })
  }
  private runTimers() {
    const now = this.now, list = this.timers, len = list.length, forward = this.R() < 0.5
    for (let j = 0; j < len; j++) {
      const t = list[forward ? j : len - 1 - j]
      if (t.dead || t.at > now) continue
      if (t.owner && !t.owner.alive) { t.dead = true; this.deadTimers++; continue }
      const again = t.fn()
      if (t.every > 0 && again !== false) t.at += t.every
      else { t.dead = true; this.deadTimers++ }
    }
    if (this.deadTimers > 16) { this.timers = this.timers.filter((t) => !t.dead); this.deadTimers = 0 }
  }

  /** A unit joins the fight on its master's side; null when there's no room */
  spawn(master: Body, o: SpawnOptions): Body | null {
    if (this.units.length >= this.cap || !master) return null
    let cell = o.cell
    if (!o.ghost) {
      if (cell < 0 || this.occ[cell] >= 0) cell = this.freeNear(cell >= 0 ? cell : master.cell)
      if (cell < 0) return null
    } else if (cell < 0) cell = master.cell
    const b = new Body(this.units.length, master.side, master.owner, o.name)
    b.master = master
    b.summon = true
    b.key = ''
    b.star = master.star
    b.icon = o.icon
    b.hp = b.maxHp = Math.max(1, o.hp)
    b.adBase = o.ad
    b.asBase = o.as
    b.armor = o.armor
    b.mr = o.mr
    b.range = o.range
    b.ap = o.ap ?? 100
    b.ghost = !!o.ghost
    b.counts = o.counts ?? !o.ghost
    b.immobile = !!o.immobile
    b.cell = cell
    b.attackAt = this.now + 0.2 + this.R() * 0.2
    this.units.push(b)
    if (!b.ghost) this.occ[cell] = b.i
    if (b.counts) this.left[b.side]++
    if (o.duration) this.after(o.duration, () => this.expire(b))
    this.rec?.spawns.push({ slot: b.i, tick: this.tick, owner: master.owner, side: b.side, name: o.name, icon: o.icon, size: o.size ?? 0.62, counts: b.counts })
    return b
  }
  /** A summon's time is up */
  expire(b: Body) {
    if (!b.alive) return
    b.alive = false
    if (this.occ[b.cell] === b.i) this.occ[b.cell] = -1
    if (b.counts) this.left[b.side]--
    this.event(EV.death, b, b)
  }
  /** Draws a unit with another portrait from now on */
  form(u: Body, icon: string | undefined) {
    if (icon) this.rec?.forms.push([this.tick, u.i, icon])
  }

  event(kind: number, a: Body, b: Body | number) {
    if (this.rec) this.rec.events.push([this.tick, kind, a.i, typeof b === 'number' ? b : b.i])
  }

  /* ── Acting ──────────────────────────────────────────── */

  attack(u: Body, t: Body) {
    u.attacks++
    const crit = this.R() < this.critChance(u)
    const a: Attack = { target: t, dmg: this.ad(u) * (crit ? u.critDmg : 1), type: PHYS, crit, skip: false }
    if (u.preAttack) for (const h of u.preAttack) h(this, u, a)
    const target = a.target
    if (!a.skip && target.alive) this.deal(u, target, a.dmg, a.type, F.attack | (crit ? F.crit : 0))
    if (u.maxMana > 0 && u.manaPerAttack > 0) this.addMana(u, u.manaPerAttack)
    if (u.stackAs) u.asPct += u.stackAs
    if (u.onAttack) for (const h of u.onAttack) h(this, u, target, a)
    u.attackAt = this.now + 1 / this.as(u)
    this.event(crit ? EV.crit : EV.attack, u, target)
  }

  cast(u: Body, t: Body) {
    const spent = u.maxMana + u.reave
    u.mana = 0
    u.reave = 0
    u.casts++
    this.out[u.owner * OUT + 4]++
    u.castUntil = this.now + this.rules.castTime
    this.event(EV.cast, u, t)
    const script = u.ability ?? this.kit?.casts[u.key]
    if (script) script(this, u, t)
    else if (u.f) this.castEffects(u, t, u.f.effects)
    if (this.castHooks) for (const h of this.castHooks) h(this, u, spent)
  }

  /** An ability made of effects (sets without a script) */
  castEffects(u: Body, t: Body, effects: Effect[]) {
    for (const e of effects) {
      const v = e.value[u.star - 1] ?? 0
      if (v === 0) continue
      const who = this.effectTargets(u, t, e)
      if (e.kind === 'stun') { for (const j of who) this.stun(u, j, v); continue }
      if (e.kind === 'buff') {
        const stat = BUFF_SLOT[e.stat ?? 'asPct']
        for (const j of who) {
          if ((e.duration ?? 0) > 0) this.buff(j, stat, v, e.duration as number)
          else if (stat === S.as) j.asPct += v
          else if (stat === S.ad) j.adPct += v
          else if (stat === S.ap) j.ap += v
          else if (stat === S.armor) j.armor += v
          else if (stat === S.mr) j.mr += v
          else if (stat === S.dur) j.dur += v
          else if (stat === S.vamp) j.vamp += v
        }
        continue
      }
      const amount = e.scale === 'ap' ? this.byAp(u, v) : e.scale === 'ad' ? (v / 100) * this.ad(u) : e.scale === 'hp' ? (v / 100) * u.maxHp : v
      for (const j of who) {
        if (e.kind === 'damage') this.hit(u, j, amount, e.type === 'physical' ? PHYS : e.type === 'true' ? TRUE : MAGIC)
        else if (e.kind === 'heal') this.heal(u, j, amount)
        else if (e.kind === 'shield') this.shield(u, j, amount, e.duration || 4)
      }
    }
  }

  private effectTargets(u: Body, t: Body, e: Effect): Body[] {
    const friendly = e.kind === 'heal' || e.kind === 'shield' || e.kind === 'buff'
    if (friendly) {
      if (e.target === 'team') return this.allies(u)
      if (e.target === 'ally') return [this.lowest(this.allies(u), true) ?? u]
      return [u]
    }
    const foes = this.enemies(u)
    if (!foes.length) return []
    switch (e.target) {
      case 'all': return foes
      case 'farthest': return [this.farthest(foes, u.cell)!]
      case 'lowest': return [this.lowest(foes)!]
      case 'splash': return this.around((t.alive ? t : foes[0]).cell, Math.max(0, e.radius ?? 1), 1 - u.side)
      default: return [t.alive && this.targetable(t) ? t : foes[0]]
    }
  }

  private update(u: Body) {
    const now = this.now
    if (u.buffs.length || u.shields.length) this.refresh(u)
    if (this.tick % 5 === 0 && (u.dots.length || now < u.burnUntil + 0.25 || now < u.hotUntil + 0.25)) { this.tickDots(u, 0.25); if (!u.alive) return }
    if (u.inert || now < u.stunUntil || now < u.sleepUntil || now < u.castUntil) return
    if (u.maxMana > 0 && u.manaRegen > 0 && now >= u.manaLockUntil) u.mana = Math.min(u.maxMana + u.reave, u.mana + u.manaRegen * DT * u.manaMult)
    const t = this.targetOf(u)
    if (!t) return
    if (DIST[u.cell * CELLS + t.cell] <= u.range) {
      if (u.maxMana > 0 && u.mana >= u.maxMana + u.reave && !u.noCast) { this.cast(u, t); return }
      if (now >= u.attackAt && now >= u.moveAt && u.asBase > 0) this.attack(u, t)
    } else if (u.immobile) {
      // A turret: the nearest enemy in range instead
      const near = this.nearest(this.around(u.cell, u.range, 1 - u.side), u.cell)
      if (near) { u.target = near; u.targetSince = now; if (now >= u.attackAt && u.asBase > 0) this.attack(u, near) }
    } else if (now >= u.moveAt) {
      let target = t
      if (!(u.forced === t && now < u.forcedUntil)) {
        const closer = this.nearestEnemy(u)
        if (closer && closer !== t) { target = closer; u.target = closer; u.targetSince = now }
      }
      if (DIST[u.cell * CELLS + target.cell] <= u.range) { if (now >= u.attackAt && u.asBase > 0) this.attack(u, target) }
      else this.step(u, target)
    }
  }

  private frame(tick: number) {
    const rec = this.rec
    if (!rec) return
    const base = tick * this.cap * FRAME, now = this.now
    for (const u of this.units) {
      const o = base + u.i * FRAME
      rec.frames[o] = u.cell
      rec.frames[o + 1] = u.alive ? Math.max(0, u.hp) / u.maxHp : 0
      rec.frames[o + 2] = u.alive ? Math.min(1, u.shieldTotal / u.maxHp) : 0
      rec.frames[o + 3] = u.maxMana > 0 ? Math.min(1, u.mana / (u.maxMana + u.reave)) : 0
      rec.frames[o + 4] = (u.alive ? FLAG.alive : 0) | (now < u.stunUntil || now < u.sleepUntil ? FLAG.stunned : 0) | (now < u.castUntil ? FLAG.casting : 0) | (u.ghost || now < u.untargetableUntil ? FLAG.untargetable : 0)
      rec.frames[o + 5] = u.maxHp
    }
    rec.ticks = tick + 1
  }

  run(): FightResult {
    const maxTicks = Math.ceil(this.rules.maxTime / DT)
    if (this.rec) {
      this.rec.frames = new Float32Array((maxTicks + 1) * this.cap * FRAME)
      this.rec.slots = this.cap
      this.rec.events = []
      this.rec.spawns = []
      this.rec.forms = []
      this.rec.hits = []
      this.rec.heals = []
      this.rec.ticks = 0
    }
    this.kit?.start(this)
    this.frame(0)
    let tick = 0, winner: -1 | 0 | 1 = -1
    if (!this.left[0] || !this.left[1]) winner = !this.left[0] && !this.left[1] ? -1 : this.left[0] ? 0 : 1
    else
      for (tick = 1; tick <= maxTicks; tick++) {
        this.tick = tick
        this.now = tick * DT
        this.overtime = this.now > this.rules.overtime ? 1 + this.rules.overtimeAmp * (this.now - this.rules.overtime) : 1
        if (this.timers.length) this.runTimers()
        // Who acts first changes every tick: the list read from a random place, in a random direction. Any fixed
        // order would favour a side, and this one treats both sides alike whichever is listed first.
        const units = this.units, len = units.length, start = (this.R() * len) | 0, dir = this.R() < 0.5 ? 1 : len - 1
        for (let k = 0, i = start; k < len; k++, i = (i + dir) % len) {
          const u = units[i]
          if (u.alive) this.update(u)
        }
        this.frame(tick)
        if (!this.left[0] || !this.left[1]) { winner = !this.left[0] && !this.left[1] ? -1 : this.left[0] ? 0 : 1; break }
      }
    for (let i = 0; i < this.n; i++) {
      const u = this.units[i]
      this.out[i * OUT + 5] = u.alive ? 1 : 0
      this.out[i * OUT + 6] = u.alive ? u.hp / u.maxHp : 0
    }
    return { winner, time: Math.min(tick, maxTicks) * DT, units: this.out }
  }
}

const BUFF_SLOT: Record<string, number> = { asPct: S.as, adPct: S.ad, armor: S.armor, mr: S.mr, ap: S.ap, durability: S.dur, omnivamp: S.vamp }

/** One fight of a prepared setup with a seed (and, to watch it, a recording to fill) */
export function fight(p: Prepared, seed: number, record?: Recording): FightResult {
  return new Fight(p, seed, record).run()
}
