import { BONUS_KEYS, ROLE_RULE_KEYS, RULE_KEYS, STAT_KEYS, type Bonus, type GameSet, type Overrides, type RoleRules, type Rules, type Value } from './types.ts'

// Balance changes are numbers at paths, so a patch is small enough for a link:
//   u.<unit>.<stat>            u.squire.armor
//   u.<unit>.e<n>.v<star>      u.squire.e0.v2   (the ability's first effect, at 2 stars)
//   u.<unit>.e<n>.radius|duration
//   u.<unit>.$<value>[.v<star>] u.krug.$kruglette.v2   (a scripted ability's number: per star, or one for all)
//   i.<item>.<bonus>           i.greatsword.adPct
//   i.<item>.$<value>          i.guinsoo-s-rageblade.$stack
//   t.<trait>.b<n>.<bonus>     t.bulwark.b1.armor   (for the trait's units)
//   t.<trait>.t<n>.<bonus>     t.arcane.t0.ap       (for the whole team)
//   t.<trait>.b<n>.units
//   t.<trait>.$<value>[.b<n>]  t.vanguard.$shield.b1  (a scripted trait's number: per breakpoint, or one for all)
//   r.<rule>  r.<rule>.v<n>    r.maxAs, r.starHp.v2
//   r.roles.<key>              r.roles.tank   (sets with roles)

const STATS = new Set<string>(STAT_KEYS), BONUSES = new Set<string>(BONUS_KEYS), RULES = new Set<string>(RULE_KEYS), ROLE_RULES = new Set<string>(ROLE_RULE_KEYS)
const index = (s: string | undefined, prefix: string) => (s && s[0] === prefix && /^\d+$/.test(s.slice(1)) ? Number(s.slice(1)) : -1)

/** The scripted value a path names, and which of its numbers */
function valueOf(set: GameSet, path: string): { value: Value; at: number } | null {
  const [kind, id, a, b, extra] = path.split('.')
  if (extra !== undefined || a?.[0] !== '$') return null
  const name = a.slice(1)
  const value = kind === 'u' ? set.units.find((u) => u.id === id)?.ability.values?.[name] : kind === 'i' ? set.items.find((i) => i.id === id)?.values?.[name] : kind === 't' ? set.traits.find((t) => t.id === id)?.values?.[name] : undefined
  if (!value) return null
  if (value.v.length <= 1) return b === undefined ? { value, at: 0 } : null
  const at = kind === 'u' ? index(b, 'v') - 1 : kind === 't' ? index(b, 'b') : -1
  return at >= 0 && at < value.v.length ? { value, at } : null
}

/** The paths of a scripted value: one per star or breakpoint, or one */
export function valuePaths(prefix: string, name: string, value: Value): string[] {
  if (value.v.length <= 1) return [`${prefix}.$${name}`]
  const kind = prefix[0]
  return value.v.map((_, i) => `${prefix}.$${name}.${kind === 'u' ? `v${i + 1}` : `b${i}`}`)
}

/** Whether a path names a number this set has (or a bonus it could have) */
export function validPath(set: GameSet, path: string): boolean {
  const [kind, id, a, b, extra] = path.split('.')
  if (extra !== undefined) return false
  if (a?.[0] === '$') return valueOf(set, path) !== null
  if (kind === 'u') {
    const unit = set.units.find((u) => u.id === id)
    if (!unit || !a) return false
    if (a[0] === 'e') {
      const effect = unit.ability.effects[index(a, 'e')]
      return !!effect && ((index(b, 'v') >= 1 && index(b, 'v') <= 3) || b === 'radius' || b === 'duration')
    }
    return STATS.has(a) && b === undefined
  }
  if (kind === 'i') return !!set.items.find((i) => i.id === id) && BONUSES.has(a) && b === undefined
  if (kind === 't') {
    const trait = set.traits.find((t) => t.id === id)
    if (a?.[0] === 't') return !!trait?.breakpoints[index(a, 't')] && BONUSES.has(b)
    return !!trait?.breakpoints[index(a, 'b')] && (b === 'units' || BONUSES.has(b))
  }
  if (kind === 'r') {
    if (id === 'roles') return !!set.rules.roles && ROLE_RULES.has(a) && b === undefined
    if (!RULES.has(id)) return false
    const rule = set.rules[id as keyof Rules]
    return Array.isArray(rule) ? index(a, 'v') >= 1 && index(a, 'v') <= rule.length && b === undefined : a === undefined
  }
  return false
}

/** The set's own number at a path (a bonus that isn't there is 0) */
export function baseValue(set: GameSet, path: string): number {
  const [kind, id, a, b] = path.split('.')
  if (a?.[0] === '$') { const v = valueOf(set, path); return v ? v.value.v[v.at] : 0 }
  if (kind === 'u') {
    const unit = set.units.find((u) => u.id === id)
    if (!unit || !a) return 0
    if (a[0] === 'e') {
      const effect = unit.ability.effects[index(a, 'e')]
      if (!effect) return 0
      if (b?.[0] === 'v') return effect.value[index(b, 'v') - 1] ?? 0
      return b === 'radius' ? (effect.radius ?? 1) : b === 'duration' ? (effect.duration ?? 0) : 0
    }
    return (unit.stats as unknown as Record<string, number>)[a] ?? 0
  }
  if (kind === 'i') return (set.items.find((i) => i.id === id)?.bonus as Record<string, number> | undefined)?.[a] ?? 0
  if (kind === 't') {
    const team = a?.[0] === 't', bp = set.traits.find((t) => t.id === id)?.breakpoints[index(a, team ? 't' : 'b')]
    if (!bp) return 0
    if (team) return ((bp.team ?? {}) as Record<string, number>)[b] ?? 0
    return b === 'units' ? bp.units : ((bp.bonus as Record<string, number>)[b] ?? 0)
  }
  if (kind === 'r') {
    if (id === 'roles') return set.rules.roles?.[a as keyof RoleRules] ?? 0
    const rule = set.rules[id as keyof Rules]
    return Array.isArray(rule) ? (rule[index(a, 'v') - 1] ?? 0) : typeof rule === 'number' ? rule : 0
  }
  return 0
}

/** The number a path has with these overrides on top of the set */
export const valueAt = (set: GameSet, path: string, ...layers: Overrides[]) => {
  for (let i = layers.length - 1; i >= 0; i--) if (path in layers[i]) return layers[i][path]
  return baseValue(set, path)
}

/** The set with every override applied (the set itself is left as it was). Later layers win. */
export function applyOverrides(set: GameSet, ...layers: Overrides[]): GameSet {
  const merged = Object.assign({}, ...layers) as Overrides
  if (!Object.keys(merged).length) return set
  const out: GameSet = structuredClone(set)
  const units = new Map(out.units.map((u) => [u.id, u])), items = new Map(out.items.map((i) => [i.id, i])), traits = new Map(out.traits.map((t) => [t.id, t]))
  for (const [path, value] of Object.entries(merged)) {
    if (!Number.isFinite(value) || !validPath(set, path)) continue
    const [kind, id, a, b] = path.split('.')
    if (a[0] === '$') {
      const name = a.slice(1)
      const named = kind === 'u' ? units.get(id)?.ability.values?.[name] : kind === 'i' ? items.get(id)?.values?.[name] : traits.get(id)?.values?.[name]
      const at = named && named.v.length > 1 ? (kind === 'u' ? index(b, 'v') - 1 : index(b, 'b')) : 0
      if (named && at >= 0) named.v[at] = named.kind === 'count' ? Math.max(0, Math.round(value)) : value
      continue
    }
    if (kind === 'u') {
      const unit = units.get(id)!
      if (a[0] === 'e') {
        const effect = unit.ability.effects[index(a, 'e')]
        if (b[0] === 'v') effect.value[index(b, 'v') - 1] = value
        else effect[b as 'radius' | 'duration'] = Math.max(0, value)
      } else (unit.stats as unknown as Record<string, number>)[a] = value
    } else if (kind === 'i') (items.get(id)!.bonus as Record<string, number>)[a] = value
    else if (kind === 't') {
      const team = a[0] === 't', bp = traits.get(id)!.breakpoints[index(a, team ? 't' : 'b')]
      if (team) ((bp.team ??= {}) as Record<string, number>)[b] = value
      else if (b === 'units') bp.units = Math.max(1, Math.round(value))
      else (bp.bonus as Record<string, number>)[b] = value
    } else if (kind === 'r') {
      if (id === 'roles') { if (out.rules.roles) out.rules.roles[a as keyof RoleRules] = value; continue }
      const rules = out.rules as unknown as Record<string, number | number[]>
      if (Array.isArray(rules[id])) (rules[id] as number[])[index(a, 'v') - 1] = value
      else rules[id] = value
    }
  }
  for (const trait of out.traits) trait.breakpoints.sort((x, y) => x.units - y.units)
  return out
}

/** How a number is shown and typed: percentages as 0 to 100, everything else as is */
export interface FieldMeta {
  label: string
  pct?: boolean
  step?: number
  /** Shown after the number */
  unit?: string
  min?: number
  max?: number
}

export const STAT_META: Record<string, FieldMeta> = {
  hp: { label: 'Health', step: 50, min: 1 },
  ad: { label: 'Attack damage', step: 5, min: 0 },
  as: { label: 'Attack speed', step: 0.05, min: 0.05 },
  armor: { label: 'Armor', step: 5 },
  mr: { label: 'Magic resist', step: 5 },
  mana: { label: 'Mana', step: 10, min: 0 },
  startMana: { label: 'Starting mana', step: 10, min: 0 },
  range: { label: 'Range', step: 1, min: 1, max: 8 },
  crit: { label: 'Crit chance', pct: true, step: 5, min: 0, max: 100 },
  critDmg: { label: 'Crit damage', pct: true, step: 10, min: 0 },
}

export const BONUS_META: Record<keyof Bonus, FieldMeta> = {
  hp: { label: 'Health', step: 50 },
  hpPct: { label: 'Health %', pct: true, step: 5 },
  armor: { label: 'Armor', step: 5 },
  mr: { label: 'Magic resist', step: 5 },
  ap: { label: 'Ability power', step: 5 },
  adPct: { label: 'Attack damage', pct: true, step: 5 },
  asPct: { label: 'Attack speed', pct: true, step: 5 },
  startMana: { label: 'Starting mana', step: 5 },
  manaRegen: { label: 'Mana per second', step: 1 },
  crit: { label: 'Crit chance', pct: true, step: 5 },
  critDmg: { label: 'Crit damage', pct: true, step: 5 },
  omnivamp: { label: 'Omnivamp', pct: true, step: 5 },
  amp: { label: 'Damage amp', pct: true, step: 5 },
  durability: { label: 'Durability', pct: true, step: 5 },
  range: { label: 'Range', step: 1 },
  stackAs: { label: 'Attack speed per hit', pct: true, step: 1 },
  shield: { label: 'Opening shield', pct: true, step: 5 },
  abilityCrit: { label: 'Abilities crit', step: 1, min: 0, max: 1 },
}

export const ROLE_META: Record<keyof RoleRules, FieldMeta> = {
  tank: { label: 'Tanks: mana per attack', step: 1, min: 0 },
  fighter: { label: 'Fighters: mana per attack', step: 1, min: 0 },
  assassin: { label: 'Assassins: mana per attack', step: 1, min: 0 },
  caster: { label: 'Casters: mana per attack', step: 1, min: 0 },
  marksman: { label: 'Marksmen: mana per attack', step: 1, min: 0 },
  specialist: { label: 'Specialists: mana per attack', step: 1, min: 0 },
  casterRegen: { label: 'Casters: mana per second', step: 0.5, min: 0 },
  fighterAs: { label: 'Fighters: attack speed', pct: true, step: 5, min: 0 },
  assassinDr: { label: 'Assassins: less damage from non-targets', pct: true, step: 1, min: 0, max: 90 },
  tankPull: { label: 'Tanks: targeted as if this much closer', step: 0.25, min: 0, unit: 'hex' },
}

/** How a scripted value of each kind is typed and shown */
export function valueMeta(v: Value): FieldMeta {
  const size = Math.max(...v.v.map(Math.abs), 0)
  const step = size >= 1000 ? 50 : size >= 200 ? 10 : size >= 40 ? 5 : size >= 4 ? 1 : 0.5
  switch (v.kind) {
    case 'ap': return { label: v.label, step, unit: 'AP' }
    case 'appct': return { label: v.label, pct: true, step: 1, unit: '% AP' }
    case 'ad': return { label: v.label, pct: true, step: 5, unit: '% AD' }
    case 'hp': return { label: v.label, pct: true, step: 0.5, unit: '% HP' }
    case 'armor': return { label: v.label, pct: true, step: 5, unit: '% AR' }
    case 'mr': return { label: v.label, pct: true, step: 5, unit: '% MR' }
    case 'res': return { label: v.label, pct: true, step: 5, unit: '% res' }
    case 'pct': return { label: v.label, pct: true, step: 1 }
    case 'sec': return { label: v.label, step: 0.25, min: 0, unit: 's' }
    case 'count': return { label: v.label, step: 1, min: 0 }
    case 'hex': return { label: v.label, step: 1, min: 0, max: 8, unit: 'hex' }
    case 'mana': return { label: v.label, step: 1, min: 0 }
    default: return { label: v.label, step }
  }
}

export const RULE_META: Record<string, FieldMeta> = {
  starHp: { label: 'Health at', step: 0.1, unit: '×' },
  starAd: { label: 'Attack damage at', step: 0.1, unit: '×' },
  manaPerAttack: { label: 'Mana per attack', step: 1, min: 0 },
  manaFromDamage: { label: 'Mana from damage', pct: true, step: 0.5, min: 0 },
  maxManaFromDamage: { label: 'Mana per hit, at most', step: 2.5, min: 0 },
  moveTime: { label: 'Time to cross a hex', step: 0.05, min: 0.05, unit: 's' },
  castTime: { label: 'Cast time', step: 0.1, min: 0, unit: 's' },
  maxAs: { label: 'Attack speed cap', step: 0.5, min: 0.1 },
  overtime: { label: 'Overtime starts at', step: 5, min: 0, unit: 's' },
  overtimeAmp: { label: 'Overtime damage', pct: true, step: 5, min: 0, unit: '/s' },
  maxTime: { label: 'Time limit', step: 5, min: 5, max: 120, unit: 's' },
}

/** The number as typed in a field, and back */
export const toField = (value: number, meta?: FieldMeta) => round(meta?.pct ? value * 100 : value)
export const fromField = (value: number, meta?: FieldMeta) => (meta?.pct ? value / 100 : value)
export const round = (n: number) => Math.round(n * 1000) / 1000

/** What a path's field is like: how to show it and type it */
export function metaFor(set: GameSet, path: string): FieldMeta | undefined {
  const [kind, id, a, b] = path.split('.')
  if (a?.[0] === '$') { const v = valueOf(set, path); return v ? valueMeta(v.value) : undefined }
  if (kind === 'r' && id === 'roles') return ROLE_META[a as keyof RoleRules]
  if (kind === 'u') {
    if (a?.[0] !== 'e') return STAT_META[a]
    const effect = set.units.find((u) => u.id === id)?.ability.effects[index(a, 'e')]
    if (b === 'radius') return { label: 'Radius', step: 1, min: 0 }
    if (b === 'duration') return { label: 'Duration', step: 0.5, min: 0, unit: 's' }
    if (effect?.kind === 'stun') return { label: 'Stun', step: 0.25, min: 0, unit: 's' }
    if (effect?.kind === 'buff') return BONUS_META[effect.stat ?? 'asPct']
    return { label: EFFECT_LABEL[effect?.kind ?? 'damage'], step: effect?.scale === 'ad' || effect?.scale === 'hp' ? 5 : 10 }
  }
  if (kind === 'i') return BONUS_META[a as keyof Bonus]
  if (kind === 't') return b === 'units' ? { label: 'Units', step: 1, min: 1 } : BONUS_META[b as keyof Bonus]
  if (kind === 'r') return RULE_META[id]
  return undefined
}

export const EFFECT_LABEL: Record<string, string> = { damage: 'Damage', heal: 'Heal', shield: 'Shield', stun: 'Stun', buff: 'Buff' }

/** A path in words: "Squire · Armor", "Squire · Shield 2★", "Bulwark (4) · Armor", "Rules · Cast time" */
export function describe(set: GameSet, path: string): { name: string; field: string; meta?: FieldMeta } {
  const [kind, id, a, b] = path.split('.')
  const meta = metaFor(set, path)
  if (a?.[0] === '$') {
    const v = valueOf(set, path)
    const owner = kind === 'u' ? set.units.find((u) => u.id === id)?.name : kind === 'i' ? set.items.find((i) => i.id === id)?.name : set.traits.find((t) => t.id === id)?.name
    const trait = kind === 't' ? set.traits.find((t) => t.id === id) : undefined
    const where = v && v.value.v.length > 1 ? (kind === 'u' ? ` ${v.at + 1}★` : trait?.breakpoints[v.at] ? ` at ${trait.breakpoints[v.at].units}` : '') : ''
    return { name: owner ?? id, field: `${v?.value.label ?? a.slice(1)}${where}`, meta }
  }
  if (kind === 'u') {
    const unit = set.units.find((u) => u.id === id)
    const name = unit?.name ?? id
    if (a?.[0] === 'e') {
      const effect = unit?.ability.effects[index(a, 'e')]
      const what = !effect ? 'Ability' : effect.kind === 'buff' ? `${BONUS_META[effect.stat ?? 'asPct']?.label ?? 'Buff'} buff` : EFFECT_LABEL[effect.kind]
      if (b?.[0] === 'v') return { name, field: `${what} ${b.slice(1)}★`, meta }
      return { name, field: `${what} ${b}`, meta }
    }
    return { name, field: meta?.label ?? a, meta }
  }
  if (kind === 'i') return { name: set.items.find((i) => i.id === id)?.name ?? id, field: meta?.label ?? a, meta }
  if (kind === 'r') {
    if (id === 'roles') return { name: 'Rules', field: meta?.label ?? a, meta }
    const rule = set.rules[id as keyof Rules]
    const which = Array.isArray(rule) ? (id === 'manaFromDamage' ? (a === 'v1' ? ' (before resists)' : ' (after resists)') : ` ${a.slice(1)}★`) : ''
    return { name: 'Rules', field: `${meta?.label ?? id}${which}`, meta }
  }
  const team = a?.[0] === 't', trait = set.traits.find((t) => t.id === id), bp = trait?.breakpoints[index(a, team ? 't' : 'b')]
  const name = `${trait?.name ?? id}${bp ? ` (${bp.units})` : ''}`
  if (b === 'units') return { name, field: 'Units needed', meta }
  return { name, field: `${meta?.label ?? b}${team ? ', whole team' : ''}`, meta }
}

export interface Note {
  path: string
  from: number
  to: number
  name: string
  field: string
  meta?: FieldMeta
}

/** The changes a layer makes on top of the numbers below it, ready to list as patch notes */
export function patchNotes(set: GameSet, below: Overrides, layer: Overrides): Note[] {
  return Object.entries(layer)
    .filter(([path]) => validPath(set, path))
    .map(([path, to]) => ({ path, to, from: path in below ? below[path] : baseValue(set, path), ...describe(set, path) }))
    .filter((n) => Math.abs(n.to - n.from) > 1e-9)
    .sort((a, b) => order(a.path) - order(b.path) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path, undefined, { numeric: true }))
}
const order = (path: string) => 'utir'.indexOf(path[0])

/** Drops overrides the set doesn't have and ones equal to the numbers below them */
export function clean(set: GameSet, layer: Overrides, below: Overrides = {}): Overrides {
  const out: Overrides = {}
  for (const [path, value] of Object.entries(layer)) {
    if (!Number.isFinite(value) || !validPath(set, path)) continue
    const under = path in below ? below[path] : baseValue(set, path)
    if (Math.abs(value - under) > 1e-9) out[path] = value
  }
  return out
}
