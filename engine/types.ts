// Everything the simulator reads. A set is its rules plus the units, items and traits of one game.

export type Star = 1 | 2 | 3
/** 0 is blue (the bottom half of the board), 1 is red (the top half) */
export type Side = 0 | 1

/** A unit's numbers at one star. Stars multiply health and attack damage (Rules.starHp, Rules.starAd). */
export interface Stats {
  hp: number
  /** Mana to cast; 0 means the unit never casts */
  mana: number
  startMana: number
  ad: number
  /** Attacks per second */
  as: number
  armor: number
  mr: number
  /** In hexes */
  range: number
  /** Crit chance, 0 to 1 */
  crit: number
  /** Crit damage multiplier: 1.4 deals 140% */
  critDmg: number
}

/** What items and traits add. The Pct fields multiply the base: adPct 0.35 is +35% attack damage. */
export interface Bonus {
  hp?: number
  hpPct?: number
  armor?: number
  mr?: number
  ap?: number
  adPct?: number
  asPct?: number
  startMana?: number
  /** Mana per second */
  manaRegen?: number
  crit?: number
  critDmg?: number
  omnivamp?: number
  /** Damage amplification: 0.1 deals 10% more */
  amp?: number
  /** Damage reduction: 0.1 takes 10% less */
  durability?: number
  range?: number
  /** Attack speed gained with every attack, stacking: 0.07 is +7% a hit */
  stackAs?: number
  /** A shield worth this share of max health at the start of combat, for 8 seconds */
  shield?: number
  /** Abilities can crit (1 = yes): TFT calls it Precision */
  abilityCrit?: number
}

export const BONUS_KEYS = ['hp', 'hpPct', 'armor', 'mr', 'ap', 'adPct', 'asPct', 'startMana', 'manaRegen', 'crit', 'critDmg', 'omnivamp', 'amp', 'durability', 'range', 'stackAs', 'shield', 'abilityCrit'] as const
export type BonusKey = (typeof BONUS_KEYS)[number]
export const STAT_KEYS = ['hp', 'mana', 'startMana', 'ad', 'as', 'armor', 'mr', 'range', 'crit', 'critDmg'] as const
export type StatKey = (typeof STAT_KEYS)[number]

export type EffectKind = 'damage' | 'heal' | 'shield' | 'stun' | 'buff'
/**
 * Who an effect lands on. target: the unit's current target · splash: the target and enemies within `radius` of it ·
 * farthest / lowest: the farthest enemy, the enemy with the least health · all: every enemy · self · ally: the ally
 * with the least health (the caster included) · team: every ally
 */
export type EffectTarget = 'target' | 'splash' | 'farthest' | 'lowest' | 'all' | 'self' | 'ally' | 'team'
export type BuffStat = 'asPct' | 'adPct' | 'armor' | 'mr' | 'ap' | 'durability' | 'omnivamp'

/** One piece of an ability, for sets without a script for it (the sandbox, sets of your own) */
export interface Effect {
  kind: EffectKind
  target: EffectTarget
  /** One value per star. Damage, heal and shield: an amount (see `scale`). Stun: seconds. Buff: how much of `stat`. */
  value: [number, number, number]
  /** ap: multiplied by ability power / 100 · ad: a percentage of attack damage · hp: a percentage of the caster's max health */
  scale?: 'ap' | 'ad' | 'hp'
  /** Damage only, magic by default */
  type?: 'physical' | 'magic' | 'true'
  /** Splash radius in hexes */
  radius?: number
  /** Seconds a shield or buff lasts (0: the rest of combat) */
  duration?: number
  stat?: BuffStat
}

/**
 * How a scripted number is used and shown. ap: an amount multiplied by ability power / 100 · appct: a share that grows
 * with ability power the same way · ad, hp: a share of attack damage or max health · armor, mr, res: a share of armor,
 * magic resist, or both added · pct: a share, shown as % · flat, sec, count, hex, mana: as is
 */
export type ValueKind = 'ap' | 'appct' | 'ad' | 'hp' | 'armor' | 'mr' | 'res' | 'flat' | 'pct' | 'sec' | 'count' | 'hex' | 'mana'
export const VALUE_KINDS = ['ap', 'appct', 'ad', 'hp', 'armor', 'mr', 'res', 'flat', 'pct', 'sec', 'count', 'hex', 'mana'] as const

/** A named number a script reads: one per star for an ability, one per breakpoint for a trait, or one for all */
export interface Value {
  label: string
  kind: ValueKind
  v: number[]
}
export type Values = Record<string, Value>

export interface Ability {
  name: string
  /** What the ability does, for sets without a script (empty when `values` drive a script) */
  effects: Effect[]
  /** Numbers guessed from the unit's role and cost, not read from the game */
  estimated?: boolean
  /** What it does in the game, in words */
  desc?: string
  /** The numbers the set's script reads (sets with a kit) */
  values?: Values
}

/** Set 18's roles: how a unit gains mana, and a rule of its own */
export type Role = 'tank' | 'fighter' | 'assassin' | 'caster' | 'marksman' | 'specialist'
export const ROLES = ['tank', 'fighter', 'assassin', 'caster', 'marksman', 'specialist'] as const

export interface Unit {
  id: string
  /** The game's own id, when the set comes from one (TFT: the apiName, lowercased) */
  key?: string
  name: string
  cost: number
  traits: string[]
  stats: Stats
  ability: Ability
  icon?: string
  role?: Role
  /** What it's built around: attack damage or ability power */
  damage?: 'attack' | 'magic'
  /** How it fills its bar when it isn't mana: every few attacks (ammo), rage, or not at all */
  resource?: 'ammo' | 'rage' | 'manaless'
  /** Traits it counts more than once for (Avatar: a Lux's chosen trait counts twice) */
  counts?: Record<string, number>
  /** Placed by a trait (Elderwood's plants): it holds no items and counts for no trait */
  plant?: boolean
}

export interface Item {
  id: string
  /** The game's own id, as for units */
  key?: string
  name: string
  /** The stats every holder gets */
  bonus: Bonus
  icon?: string
  /** What the game's version does that isn't simulated */
  note?: string
  /** What it does in the game, in words */
  desc?: string
  /** The numbers its scripted effect reads */
  values?: Values
  /** An emblem: the trait it gives its holder */
  trait?: string
}

export interface Breakpoint {
  units: number
  /** For the units with the trait */
  bonus: Bonus
  /** For every unit on the side, the trait's own included */
  team?: Bonus
}

export interface Trait {
  id: string
  name: string
  breakpoints: Breakpoint[]
  icon?: string
  note?: string
  /** What it does in the game, in words */
  desc?: string
  /** The numbers its scripted effect reads: one per breakpoint, or one for all */
  values?: Values
}

export interface RoleRules {
  /** Mana per attack, by role */
  tank: number
  fighter: number
  assassin: number
  caster: number
  marksman: number
  specialist: number
  /** Casters' mana per second */
  casterRegen: number
  /** Fighters' attack speed (5 to 30% in the game, by stage) */
  fighterAs: number
  /** Assassins take this much less damage from everyone but their target */
  assassinDr: number
  /** Tanks are more likely to be targeted: enemies see them this many hexes closer */
  tankPull: number
}
export const ROLE_RULE_KEYS = ['tank', 'fighter', 'assassin', 'caster', 'marksman', 'specialist', 'casterRegen', 'fighterAs', 'assassinDr', 'tankPull'] as const

export interface Rules {
  /** Health and attack damage multipliers at 1, 2 and 3 stars */
  starHp: [number, number, number]
  starAd: [number, number, number]
  /** Without roles: every unit's mana per attack */
  manaPerAttack: number
  /** Mana from damage taken: shares of the damage before and after resistances (with roles: tanks only) */
  manaFromDamage: [number, number]
  maxManaFromDamage: number
  /** Seconds to cross one hex */
  moveTime: number
  /** Seconds a cast takes, without attacking */
  castTime: number
  maxAs: number
  /** Seconds into the fight when overtime starts: from then on, all damage grows by overtimeAmp every second */
  overtime: number
  overtimeAmp: number
  /** Seconds before the fight ends in a draw */
  maxTime: number
  /** Sets with roles (TFT Set 18): mana by role instead of manaPerAttack */
  roles?: RoleRules
}

export const RULE_KEYS = ['starHp', 'starAd', 'manaPerAttack', 'manaFromDamage', 'maxManaFromDamage', 'moveTime', 'castTime', 'maxAs', 'overtime', 'overtimeAmp', 'maxTime'] as const

export interface GameSet {
  id: string
  name: string
  /** Shown under the name: where the numbers come from */
  source: string
  rules: Rules
  units: Unit[]
  items: Item[]
  traits: Trait[]
  /** Icons are paths below this URL */
  iconBase?: string
  /** The boards a first visit starts with */
  sample?: Boards
  /** The game version the numbers come from */
  version?: string
  /** The scripts that play its abilities, items and traits as the game does (engine/kits) */
  kit?: string
  /** The patch the kit's ability and item numbers are from: they don't come with the game data, so they can be behind it */
  kitPatch?: string
  /** Icons for what units summon or turn into, by name (the kit's) */
  summons?: Record<string, string>
  /** MetaForge's meta comps for the set, as the site last fetched them (lib/comps.ts reads them) */
  meta?: { set: number; patch?: string; updated?: number; comps: { id: string; name: string; grade: string | null; avg: number; top4: number; n: number; board: (string | number)[][] }[] }
}

/** A unit on the board. Rows 0 to 3 are red's half, 4 to 7 blue's, so each side's front row is 3 or 4. */
export interface Piece {
  unit: string
  star: Star
  items: string[]
  row: number
  col: number
}

export interface Boards {
  blue: Piece[]
  red: Piece[]
}

export const ROWS = 8
export const COLS = 7

/** Numbers changed from the set, by path: see engine/patch.ts */
export type Overrides = Record<string, number>
