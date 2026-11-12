import { BONUS_KEYS, ROLE_RULE_KEYS, ROLES, STAT_KEYS, VALUE_KINDS, type Boards, type Effect, type GameSet, type Item, type Piece, type RoleRules, type Trait, type Unit, type Values } from '@/engine/types.ts'
import { DEFAULT_ROLES, DEFAULT_RULES, SANDBOX } from '@/sets/sandbox.ts'
import { readMeta } from './comps.ts'

// The sets the app offers: the current TFT set (app/sets/tft.json serves it, from CommunityDragon, and follows each
// patch), the built-in sandbox, and one set of your own, imported from a JSON file. Documents and links name a set by
// its entry here; a link's "tft18" (or a MetaForge board's) is the TFT entry, whatever set it is on now.

export interface SetEntry {
  id: string
  name: string
  source: string
  /** Where a fetched set is served from */
  file?: string
}

export const TFT = 'tft'
export const CUSTOM = 'custom'
export const BUILT_IN: SetEntry[] = [
  { id: TFT, name: 'Teamfight Tactics', source: 'The current set and patch, from CommunityDragon', file: '/sets/tft.json' },
  { id: SANDBOX.id, name: SANDBOX.name, source: SANDBOX.source },
]

/** The entry a set id belongs to */
export const entryOf = (id: string) => (/^tft\d*$/.test(id) ? TFT : id)
/** Riot's sets carry Riot's legal line */
export const isRiot = (entry: string) => entry === TFT

const loading = new Map<string, Promise<GameSet>>()

/** A set by entry: the sandbox at once, a fetched set once per visit */
export function loadSet(entry: string): Promise<GameSet> {
  if (entry === SANDBOX.id) return Promise.resolve(SANDBOX)
  const e = BUILT_IN.find((s) => s.id === entry)
  if (!e?.file) return Promise.reject(new Error(`There's no set called “${entry}”.`))
  let p = loading.get(entry)
  if (!p) {
    p = fetch(e.file)
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't load ${e.name} (${r.status}).`)
        return r.json()
      })
      .then((json) => {
        if (!json) throw new Error(`${e.name} isn't available right now.`)
        return readSet(json).set
      })
    p.catch(() => loading.delete(entry))
    loading.set(entry, p)
  }
  return p
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'
const triple = (v: unknown): [number, number, number] => {
  const a = Array.isArray(v) ? v.map((x) => n(x, 0)) : [n(v, 0)]
  return [a[0] ?? 0, a[1] ?? a[0] ?? 0, a[2] ?? a[1] ?? a[0] ?? 0]
}
const bonus = (v: unknown) => {
  const out: Record<string, number> = {}
  if (isObj(v)) for (const k of BONUS_KEYS) if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k] as number
  return out
}
/** Named numbers for a script: one per star or breakpoint, or one for all */
const values = (v: unknown): Values | undefined => {
  if (!isObj(v)) return undefined
  const out: Values = {}
  for (const [k, x] of Object.entries(v)) {
    if (!isObj(x) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue
    const list = (Array.isArray(x.v) ? x.v : [x.v]).map((y) => n(y, NaN)).filter(Number.isFinite).slice(0, 12)
    if (!list.length) continue
    out[k] = { label: str(x.label, k).slice(0, 120), kind: (VALUE_KINDS as readonly string[]).includes(String(x.kind)) ? (x.kind as Values[string]['kind']) : 'flat', v: list }
  }
  return Object.keys(out).length ? out : undefined
}
const text = (v: unknown, max = 1000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const KINDS = new Set(['damage', 'heal', 'shield', 'stun', 'buff']), TARGETS = new Set(['target', 'splash', 'farthest', 'lowest', 'all', 'self', 'ally', 'team'])
const BUFFS = new Set(['asPct', 'adPct', 'armor', 'mr', 'ap', 'durability', 'omnivamp'])

/**
 * A set from JSON (yours, or a fetched one), checked and completed: missing numbers get sensible defaults, unknown
 * fields are dropped, and what was fixed is listed.
 */
export function readSet(json: unknown): { set: GameSet; warnings: string[] } {
  const warnings: string[] = []
  if (!isObj(json)) throw new Error('That file is not a set: it should be a JSON object with units, items and traits.')
  const units: Unit[] = [], ids = new Set<string>()
  const rawUnits = Array.isArray(json.units) ? json.units : []
  if (!rawUnits.length) throw new Error('That set has no units. Add a "units" list (see an exported set for the format).')
  for (const [i, u] of rawUnits.entries()) {
    if (!isObj(u)) continue
    const name = str(u.name, `Unit ${i + 1}`)
    let id = slug(str(u.id, name))
    while (ids.has(id)) id += '-2'
    ids.add(id)
    const s = isObj(u.stats) ? u.stats : {}
    const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, n(s[k], k === 'crit' ? 0.25 : k === 'critDmg' ? 1.4 : k === 'range' ? 1 : k === 'as' ? 0.7 : k === 'hp' ? 600 : k === 'ad' ? 50 : 0)])) as unknown as Unit['stats']
    const ability = isObj(u.ability) ? u.ability : {}
    const effects: Effect[] = (Array.isArray(ability.effects) ? ability.effects : []).filter(isObj).flatMap((e): Effect[] => {
      const kind = str(e.kind) as Effect['kind'], target = str(e.target, 'target') as Effect['target']
      if (!KINDS.has(kind) || !TARGETS.has(target)) { warnings.push(`${name}: skipped an effect it couldn't read`); return [] }
      const out: Effect = { kind, target, value: triple(e.value) }
      if (e.scale === 'ap' || e.scale === 'ad' || e.scale === 'hp') out.scale = e.scale
      if (e.type === 'physical' || e.type === 'magic' || e.type === 'true') out.type = e.type
      if (typeof e.radius === 'number') out.radius = Math.max(0, e.radius)
      if (typeof e.duration === 'number') out.duration = Math.max(0, e.duration)
      if (kind === 'buff') out.stat = BUFFS.has(str(e.stat)) ? (e.stat as Effect['stat']) : 'asPct'
      return [out]
    })
    const vals = values(ability.values), desc = text(ability.desc)
    const counts: Record<string, number> = {}
    if (isObj(u.counts)) for (const [t, k] of Object.entries(u.counts)) if (typeof k === 'number' && k >= 1 && k <= 5) counts[slug(t)] = Math.round(k)
    units.push({
      id, ...(typeof u.key === 'string' && u.key ? { key: u.key.toLowerCase() } : {}), name, cost: Math.max(u.plant ? 0 : 1, Math.round(n(u.cost, 1))), traits: (Array.isArray(u.traits) ? u.traits : []).map((t) => slug(String(t))),
      stats, ability: { name: str(ability.name, 'Ability'), effects, ...(ability.estimated ? { estimated: true } : {}), ...(desc ? { desc } : {}), ...(vals ? { values: vals } : {}) },
      ...(typeof u.icon === 'string' && u.icon ? { icon: u.icon } : {}),
      ...((ROLES as readonly string[]).includes(String(u.role)) ? { role: u.role as Unit['role'] } : {}),
      ...(u.damage === 'attack' || u.damage === 'magic' ? { damage: u.damage } : {}),
      ...(u.resource === 'ammo' || u.resource === 'rage' || u.resource === 'manaless' ? { resource: u.resource } : {}),
      ...(Object.keys(counts).length ? { counts } : {}),
      ...(u.plant === true ? { plant: true } : {}),
    })
  }
  const items: Item[] = (Array.isArray(json.items) ? json.items : []).filter(isObj).map((it, i) => ({
    id: slug(str(it.id, str(it.name, `item-${i + 1}`))), ...(typeof it.key === 'string' && it.key ? { key: it.key.toLowerCase() } : {}), name: str(it.name, `Item ${i + 1}`), bonus: bonus(it.bonus),
    ...(typeof it.icon === 'string' && it.icon ? { icon: it.icon } : {}), ...(typeof it.note === 'string' && it.note ? { note: it.note } : {}),
    ...(text(it.desc) ? { desc: text(it.desc) } : {}), ...(values(it.values) ? { values: values(it.values) } : {}),
    ...(typeof it.trait === 'string' && it.trait ? { trait: slug(it.trait) } : {}),
  }))
  const traits: Trait[] = (Array.isArray(json.traits) ? json.traits : []).filter(isObj).map((t, i) => ({
    id: slug(str(t.id, str(t.name, `trait-${i + 1}`))), name: str(t.name, `Trait ${i + 1}`),
    breakpoints: (Array.isArray(t.breakpoints) ? t.breakpoints : []).filter(isObj).map((b) => {
      const units = Math.max(1, Math.round(n(b.units, 2)))
      // An older format marked a whole-team bonus with team: true
      if (b.team === true) return { units, bonus: {}, team: bonus(b.bonus) }
      return { units, bonus: bonus(b.bonus), ...(isObj(b.team) && Object.keys(bonus(b.team)).length ? { team: bonus(b.team) } : {}) }
    }).sort((a, b) => a.units - b.units),
    ...(typeof t.icon === 'string' && t.icon ? { icon: t.icon } : {}), ...(typeof t.note === 'string' && t.note ? { note: t.note } : {}),
    ...(text(t.desc) ? { desc: text(t.desc) } : {}), ...(values(t.values) ? { values: values(t.values) } : {}),
  }))
  const traitIds = new Set(traits.map((t) => t.id))
  for (const u of units) {
    const missing = u.traits.filter((t) => !traitIds.has(t))
    if (missing.length) { warnings.push(`${u.name}: no trait called ${missing.join(', ')}`); u.traits = u.traits.filter((t) => traitIds.has(t)) }
  }
  for (const it of items) if (it.trait && !traitIds.has(it.trait)) delete it.trait
  const r = isObj(json.rules) ? json.rules : {}
  const rules = { ...DEFAULT_RULES }
  for (const k of Object.keys(DEFAULT_RULES) as (keyof typeof DEFAULT_RULES)[]) {
    const d = DEFAULT_RULES[k]
    if (Array.isArray(d)) (rules as Record<string, unknown>)[k] = Array.isArray(r[k]) ? d.map((x, i) => n((r[k] as unknown[])[i], x)) : d
    else if (typeof d === 'number') (rules as Record<string, unknown>)[k] = n(r[k], d)
  }
  if (isObj(r.roles)) {
    const roles = { ...DEFAULT_ROLES } as RoleRules
    for (const k of ROLE_RULE_KEYS) roles[k] = n((r.roles as Record<string, unknown>)[k], DEFAULT_ROLES[k])
    rules.roles = roles
  }
  const set: GameSet = {
    id: slug(str(json.id, 'custom')), name: str(json.name, 'Your set'), source: str(json.source, 'Imported set'), rules, units, items, traits,
    ...(typeof json.iconBase === 'string' && /^https:\/\//.test(json.iconBase) ? { iconBase: json.iconBase } : {}),
    ...(typeof json.version === 'string' ? { version: json.version } : {}),
    ...(typeof json.kit === 'string' && /^[a-z0-9]+$/.test(json.kit) ? { kit: json.kit } : {}),
    ...(typeof json.kitPatch === 'string' && /^\d+\.\d+[a-z]?$/.test(json.kitPatch) ? { kitPatch: json.kitPatch } : {}),
  }
  const meta = readMeta(json.meta)
  if (meta) set.meta = meta
  if (isObj(json.summons)) {
    const summons: Record<string, string> = {}
    for (const [k, v] of Object.entries(json.summons)) if (typeof v === 'string' && /^[a-z0-9_./-]+\.png$/i.test(v)) summons[k] = v
    set.summons = summons
  }
  const sample = readBoards(json.sample, set)
  if (sample) set.sample = sample
  return { set, warnings }
}

function readBoards(v: unknown, set: GameSet): Boards | undefined {
  if (!isObj(v)) return undefined
  const ids = new Set(set.units.map((u) => u.id)), items = new Set(set.items.map((i) => i.id))
  const side = (list: unknown, rows: [number, number]): Piece[] =>
    (Array.isArray(list) ? list : []).filter(isObj).flatMap((p) => {
      const unit = str(p.unit), row = Math.round(n(p.row, -1)), col = Math.round(n(p.col, -1))
      if (!ids.has(unit) || row < rows[0] || row > rows[1] || col < 0 || col > 6) return []
      return [{ unit, star: Math.min(3, Math.max(1, Math.round(n(p.star, 1)))) as 1 | 2 | 3, items: (Array.isArray(p.items) ? p.items : []).map(String).filter((i) => items.has(i)).slice(0, 3), row, col }]
    })
  return { blue: side(v.blue, [4, 7]), red: side(v.red, [0, 3]) }
}

/** A set as a JSON file to keep, edit or share: the live numbers baked in */
export function exportSet(set: GameSet) {
  const { id, name, source, version, iconBase, rules, units, traits, items, sample, kit, summons } = set
  return JSON.stringify({ id, name, source, ...(version ? { version } : {}), ...(iconBase ? { iconBase } : {}), ...(kit ? { kit } : {}), ...(summons ? { summons } : {}), rules, units, traits, items, ...(sample ? { sample } : {}) }, null, 2)
}

/** An icon's address: a full URL, or a path below the set's icon base */
export const iconUrl = (set: GameSet, icon?: string) => (!icon ? undefined : /^https?:\/\//.test(icon) ? icon : set.iconBase ? set.iconBase + icon : undefined)

/** What a set is called in the header: "TFT Set 18" and "Patch 16.21" */
export const setTitle = (set: GameSet) => ({ name: set.name, detail: set.version ? `Patch ${set.version}` : undefined })
