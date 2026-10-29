import { cell } from './hex.ts'
import { COLS, ROWS, type Bonus, type Boards, type Effect, type GameSet, type Item, type Piece, type Role, type Rules, type Side, type Star, type Unit, type Values } from './types.ts'

/** A unit ready to fight: its numbers with stars, items and traits worked in */
export interface Fighter {
  side: Side
  cell: number
  star: Star
  unit: string
  key?: string
  name: string
  cost: number
  role?: Role
  damage?: 'attack' | 'magic'
  resource?: Unit['resource']
  plant?: boolean
  /** Its traits, an emblem's included */
  traits: string[]
  hp: number
  adBase: number
  adPct: number
  asBase: number
  asPct: number
  ap: number
  armor: number
  mr: number
  mana: number
  startMana: number
  manaRegen: number
  range: number
  crit: number
  critDmg: number
  omnivamp: number
  amp: number
  durability: number
  stackAs: number
  shield: number
  /** Sources of Precision (abilities can crit) */
  abilityCrit: number
  effects: Effect[]
  /** The ability's scripted numbers at this star */
  v: Record<string, number>
  /** Its items, each with its scripted numbers */
  items: { id: string; v: Record<string, number> }[]
}

export interface ActiveTrait {
  id: string
  name: string
  /** Units with the trait, each counted once (twice for a Lux's chosen trait) */
  count: number
  /** The breakpoint reached (-1: none) */
  level: number
  /** Units needed at each breakpoint */
  steps: number[]
}

/** A side's traits that are on, with their scripted numbers at the breakpoint reached */
export type SideTraits = Record<string, { level: number; count: number; v: Record<string, number> }>

/** What a fight needs: both sides' fighters (blue's first, in board order), the rules and the kit that plays them */
export interface Prepared {
  fighters: Fighter[]
  rules: Rules
  kit?: string
  traits: [SideTraits, SideTraits]
  /** Icons of what units summon or turn into */
  summons: Record<string, string>
}

/** A value list's number at a star or a breakpoint: the last one given carries on */
export const at = (v: number[], i: number) => (v.length ? v[Math.min(v.length - 1, Math.max(0, i))] : 0)
const pickValues = (values: Values | undefined, i: number) => {
  const out: Record<string, number> = {}
  if (values) for (const [k, x] of Object.entries(values)) out[k] = at(x.v, i)
  return out
}

/** The traits a piece has: its unit's, and an emblem's */
export function pieceTraits(unit: Unit, piece: Piece, items: Map<string, Item>): string[] {
  if (unit.plant) return []
  const out = [...unit.traits]
  for (const id of piece.items.slice(0, 3)) {
    const t = items.get(id)?.trait
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** Traits per side: distinct units count once, like in game (a Lux counts its chosen trait twice) */
export function activeTraits(set: GameSet, pieces: Piece[]): ActiveTrait[] {
  const units = new Map(set.units.map((u) => [u.id, u])), items = new Map(set.items.map((i) => [i.id, i]))
  const distinct = new Map<string, { unit: Unit; traits: Set<string> }>()
  for (const p of pieces) {
    const u = units.get(p.unit)
    if (!u || u.plant) continue
    let e = distinct.get(u.id)
    if (!e) distinct.set(u.id, (e = { unit: u, traits: new Set() }))
    for (const t of pieceTraits(u, p, items)) e.traits.add(t)
  }
  const counts = new Map<string, number>()
  for (const { unit, traits } of distinct.values()) for (const t of traits) counts.set(t, (counts.get(t) ?? 0) + (unit.counts?.[t] ?? 1))
  return set.traits
    .map((t) => {
      const count = counts.get(t.id) ?? 0
      let level = -1
      t.breakpoints.forEach((bp, i) => { if (count >= bp.units) level = i })
      return { id: t.id, name: t.name, count, level, steps: t.breakpoints.map((bp) => bp.units) }
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.level - a.level || b.count - a.count || a.name.localeCompare(b.name))
}

const add = (into: Required<Bonus>, from: Bonus) => {
  for (const [k, v] of Object.entries(from)) if (typeof v === 'number' && Number.isFinite(v) && k in into) into[k as keyof Bonus] += v
}
const empty = (): Required<Bonus> => ({ hp: 0, hpPct: 0, armor: 0, mr: 0, ap: 0, adPct: 0, asPct: 0, startMana: 0, manaRegen: 0, crit: 0, critDmg: 0, omnivamp: 0, amp: 0, durability: 0, range: 0, stackAs: 0, shield: 0, abilityCrit: 0 })

/** Both boards as fighters, blue's first, each side from its front row back whatever order the boards list them in:
 *  where a script breaks a tie by order (Taric's pair, the Riftbeast that gets the Alpha Mark), the board decides, the
 *  same way for both sides (the results list units the same way) */
export function prepare(set: GameSet, boards: Boards): Prepared {
  const units = new Map(set.units.map((u) => [u.id, u])), items = new Map(set.items.map((i) => [i.id, i]))
  const traits = new Map(set.traits.map((t) => [t.id, t]))
  const r = set.rules, roles = set.kit ? r.roles : undefined
  const fighters: Fighter[] = []
  const sides: [SideTraits, SideTraits] = [{}, {}]
  // Red's half seen from red's side: its front row is row 3, so a mirrored board lines up the same
  const byHex = (ps: Piece[], side: Side) => {
    const at = (p: Piece) => (side === 0 ? cell(p.row, p.col) : cell(ROWS - 1 - p.row, COLS - 1 - p.col))
    return [...ps].sort((a, b) => at(a) - at(b))
  }
  ;([[0, byHex(boards.blue, 0)], [1, byHex(boards.red, 1)]] as const).forEach(([side, pieces]) => {
    const active = activeTraits(set, pieces)
    for (const a of active) {
      if (a.level < 0) continue
      sides[side][a.id] = { level: a.level, count: a.count, v: pickValues(traits.get(a.id)?.values, a.level) }
    }
    for (const piece of pieces) {
      const unit = units.get(piece.unit)
      if (!unit) continue
      const bonus = empty()
      const held = unit.plant ? [] : piece.items.slice(0, 3).map((id) => items.get(id)).filter((i): i is Item => !!i)
      for (const item of held) add(bonus, item.bonus)
      const own = pieceTraits(unit, piece, items)
      for (const a of active) {
        if (a.level < 0) continue
        const bp = traits.get(a.id)?.breakpoints[a.level]
        if (!bp) continue
        if (own.includes(a.id)) add(bonus, bp.bonus)
        if (bp.team && !unit.plant) add(bonus, bp.team)
      }
      const s = unit.stats, star = piece.star
      const role = unit.role
      // Roles: fighters attack faster, casters regenerate mana
      if (roles && role === 'fighter') bonus.asPct += roles.fighterAs
      if (roles && role === 'caster') bonus.manaRegen += roles.casterRegen
      const mana = unit.resource === 'manaless' || unit.resource === 'ammo' ? 0 : Math.max(0, s.mana)
      fighters.push({
        side, cell: cell(piece.row, piece.col), star, unit: unit.id, key: unit.key, name: unit.name, cost: unit.cost, role, damage: unit.damage, resource: unit.resource, plant: unit.plant, traits: own,
        hp: Math.max(1, (s.hp * r.starHp[star - 1] + bonus.hp) * (1 + bonus.hpPct)),
        adBase: s.ad * r.starAd[star - 1], adPct: bonus.adPct, asBase: s.as, asPct: bonus.asPct,
        ap: 100 + bonus.ap, armor: s.armor + bonus.armor, mr: s.mr + bonus.mr,
        mana, startMana: Math.min(mana, s.startMana + bonus.startMana), manaRegen: bonus.manaRegen,
        range: Math.max(1, Math.round(s.range + bonus.range)), crit: Math.min(1, s.crit + bonus.crit), critDmg: s.critDmg + bonus.critDmg,
        omnivamp: bonus.omnivamp, amp: bonus.amp, durability: Math.min(0.9, bonus.durability), stackAs: bonus.stackAs, shield: bonus.shield,
        abilityCrit: bonus.abilityCrit, effects: unit.ability.effects,
        v: pickValues(unit.ability.values, star - 1),
        items: held.map((i) => ({ id: i.id, v: pickValues(i.values, 0) })),
      })
    }
  })
  return { fighters, rules: r, kit: set.kit, traits: sides, summons: set.summons ?? {} }
}
