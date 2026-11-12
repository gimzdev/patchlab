// Numbers the fight and the scripts that play a set's abilities share

/** A fight moves in steps of 1/20 of a second */
export const DT = 0.05
/** Per unit, in Fighter order: damage dealt, taken, healed, shielded, casts, alive (0/1), health left (0 to 1) */
export const OUT = 7
/** Per tick and unit in a recording: cell, health, shield, mana, flags, max health */
export const FRAME = 6
export const FLAG = { alive: 1, stunned: 2, casting: 4, untargetable: 8 } as const
/** Recorded events: [tick, kind, from, to]. A dash's `to` is the cell it lands on. */
export const EV = { attack: 0, crit: 1, cast: 2, death: 3, hit: 4, dash: 5 } as const

export const PHYS = 0
export const MAGIC = 1
export const TRUE = 2
export type DamageType = 0 | 1 | 2

/** What kind of damage a hit is */
export const F = {
  attack: 1,
  ability: 2,
  /** Over time: never crits, and doesn't set off on-hit effects */
  dot: 4,
  /** Sets off no on-hit effects (reflected and bonus damage) */
  quiet: 8,
  crit: 16,
  /** An ability hit that can't crit */
  nocrit: 32,
} as const

/** Timed stat buffs, by slot */
export const S = { as: 0, ad: 1, ap: 2, armor: 3, mr: 4, amp: 5, dur: 6, vamp: 7, crit: 8, ignore: 9 } as const
export const NS = 10
