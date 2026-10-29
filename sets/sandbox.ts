import type { Ability, Boards, GameSet, RoleRules, Rules, Stats, Unit } from '../engine/types.ts'

// The built-in set: 15 original units, 6 traits and 12 items on auto-battler numbers, to play with or to start a game
// of your own from. Every number here can be changed in the app (live or patched) without touching this file.

export const DEFAULT_RULES: Rules = {
  starHp: [1, 1.8, 3.24],
  starAd: [1, 1.5, 2.25],
  manaPerAttack: 10,
  manaFromDamage: [0.01, 0.03],
  maxManaFromDamage: 42.5,
  moveTime: 0.45,
  castTime: 0.5,
  maxAs: 5,
  overtime: 20,
  overtimeAmp: 0.25,
  maxTime: 40,
}

/** Set 18's roles, for sets that have them */
export const DEFAULT_ROLES: RoleRules = { tank: 5, fighter: 10, assassin: 10, caster: 7, marksman: 10, specialist: 0, casterRegen: 2, fighterAs: 0.2, assassinDr: 0.15, tankPull: 0.5 }

const stats = (hp: number, ad: number, as: number, armor: number, mr: number, range: number, mana: number, startMana: number): Stats => ({ hp, ad, as, armor, mr, range, mana, startMana, crit: 0.25, critDmg: 1.4 })
const unit = (id: string, name: string, cost: number, traits: string[], s: Stats, ability: Ability): Unit => ({ id, name, cost, traits, stats: s, ability })

/** The boards a first visit starts with: a frontline-and-casters team against a fast melee one */
export const SAMPLE_BOARDS: Boards = {
  blue: [
    { unit: 'paladin', star: 2, items: ['plateguard'], row: 4, col: 2 },
    { unit: 'juggernaut', star: 1, items: ['lifestone'], row: 4, col: 4 },
    { unit: 'squire', star: 2, items: [], row: 4, col: 3 },
    { unit: 'warlock', star: 1, items: ['archstaff', 'manastone'], row: 7, col: 3 },
    { unit: 'medic', star: 2, items: [], row: 7, col: 1 },
    { unit: 'sorcerer', star: 2, items: ['spellblade'], row: 6, col: 5 },
  ],
  red: [
    { unit: 'stalker', star: 2, items: ['bloodblade', 'greatsword'], row: 3, col: 3 },
    { unit: 'duelist', star: 2, items: ['ragestaff'], row: 3, col: 2 },
    { unit: 'brute', star: 2, items: ['thornmail'], row: 3, col: 4 },
    { unit: 'gunner', star: 1, items: ['quickbow', 'huntersmark'], row: 0, col: 3 },
    { unit: 'archer', star: 2, items: [], row: 0, col: 1 },
    { unit: 'scout', star: 2, items: [], row: 0, col: 5 },
  ],
}

export const SANDBOX: GameSet = {
  id: 'sandbox',
  name: 'Sandbox',
  source: 'Built-in set, original units',
  rules: DEFAULT_RULES,
  sample: SAMPLE_BOARDS,
  units: [
    unit('squire', 'Squire', 1, ['bulwark', 'fang'], stats(650, 50, 0.6, 35, 35, 1, 60, 20), { name: 'Hold the Line', effects: [{ kind: 'shield', target: 'self', value: [200, 260, 340], scale: 'ap', duration: 4 }] }),
    unit('scout', 'Scout', 1, ['swift', 'sharpshooter'], stats(450, 50, 0.75, 20, 20, 4, 70, 0), { name: 'Quick Shot', effects: [{ kind: 'damage', target: 'target', value: [180, 190, 200], scale: 'ad', type: 'physical' }] }),
    unit('ember', 'Ember', 1, ['arcane', 'swift'], stats(450, 40, 0.7, 15, 15, 4, 60, 20), { name: 'Cinder', effects: [{ kind: 'damage', target: 'splash', radius: 1, value: [200, 300, 450], scale: 'ap' }] }),
    unit('brute', 'Brute', 1, ['fang', 'warden'], stats(700, 55, 0.6, 35, 35, 1, 80, 30), { name: 'Smash', effects: [{ kind: 'damage', target: 'target', value: [150, 225, 340], scale: 'ap' }, { kind: 'stun', target: 'target', value: [1, 1.25, 1.5] }] }),
    unit('duelist', 'Duelist', 2, ['swift', 'fang'], stats(650, 60, 0.8, 30, 30, 1, 50, 0), { name: 'Flurry', effects: [{ kind: 'buff', target: 'self', stat: 'asPct', value: [0.5, 0.6, 0.8], duration: 4 }] }),
    unit('medic', 'Medic', 2, ['arcane', 'warden'], stats(600, 35, 0.65, 25, 25, 3, 70, 30), { name: 'Mend', effects: [{ kind: 'heal', target: 'ally', value: [200, 280, 400], scale: 'ap' }] }),
    unit('archer', 'Archer', 2, ['sharpshooter', 'fang'], stats(550, 55, 0.75, 20, 20, 4, 50, 0), { name: 'Volley', effects: [{ kind: 'damage', target: 'splash', radius: 1, value: [140, 150, 165], scale: 'ad', type: 'physical' }] }),
    unit('paladin', 'Paladin', 3, ['bulwark', 'warden'], stats(850, 60, 0.7, 45, 45, 1, 80, 40), { name: 'Aegis', effects: [{ kind: 'shield', target: 'ally', value: [250, 325, 450], scale: 'ap', duration: 4 }, { kind: 'damage', target: 'target', value: [120, 180, 270], scale: 'ap' }] }),
    unit('sorcerer', 'Sorcerer', 3, ['arcane'], stats(600, 40, 0.7, 25, 25, 4, 75, 15), { name: 'Arc Bolt', effects: [{ kind: 'damage', target: 'lowest', value: [450, 675, 1000], scale: 'ap' }] }),
    unit('stalker', 'Stalker', 3, ['fang', 'swift'], stats(700, 70, 0.8, 30, 30, 1, 60, 0), { name: 'Pounce', effects: [{ kind: 'damage', target: 'target', value: [250, 260, 280], scale: 'ad', type: 'physical' }] }),
    unit('juggernaut', 'Juggernaut', 4, ['bulwark', 'fang'], stats(950, 75, 0.75, 50, 50, 1, 100, 40), { name: 'Quake', effects: [{ kind: 'damage', target: 'splash', radius: 2, value: [250, 375, 900], scale: 'ap' }, { kind: 'stun', target: 'splash', radius: 2, value: [1.5, 1.75, 3] }] }),
    unit('warlock', 'Warlock', 4, ['arcane', 'warden'], stats(750, 45, 0.75, 30, 30, 4, 90, 30), { name: 'Hex Storm', effects: [{ kind: 'damage', target: 'all', value: [180, 270, 700], scale: 'ap' }] }),
    unit('gunner', 'Gunner', 4, ['sharpshooter', 'swift'], stats(700, 80, 0.8, 30, 30, 4, 60, 0), { name: 'Barrage', effects: [{ kind: 'damage', target: 'target', value: [300, 310, 350], scale: 'ad', type: 'physical' }] }),
    unit('titan', 'Titan', 5, ['bulwark', 'warden'], stats(1200, 90, 0.75, 70, 70, 1, 100, 50), { name: 'Colossus', effects: [{ kind: 'shield', target: 'self', value: [800, 1200, 5000], scale: 'ap', duration: 5 }, { kind: 'damage', target: 'splash', radius: 1, value: [300, 450, 2000], scale: 'ap' }] }),
    unit('archmage', 'Archmage', 5, ['arcane'], stats(900, 50, 0.8, 35, 35, 4, 100, 20), { name: 'Starfall', effects: [{ kind: 'damage', target: 'all', value: [300, 450, 1500], scale: 'ap' }, { kind: 'stun', target: 'all', value: [0.75, 1, 3] }] }),
  ],
  traits: [
    { id: 'bulwark', name: 'Bulwark', breakpoints: [{ units: 2, bonus: { armor: 20, mr: 20 } }, { units: 4, bonus: { armor: 45, mr: 45 } }] },
    { id: 'arcane', name: 'Arcane', breakpoints: [{ units: 2, bonus: {}, team: { ap: 15 } }, { units: 4, bonus: {}, team: { ap: 40 } }] },
    { id: 'swift', name: 'Swift', breakpoints: [{ units: 2, bonus: { asPct: 0.15 } }, { units: 4, bonus: { asPct: 0.4 } }] },
    { id: 'fang', name: 'Fang', breakpoints: [{ units: 2, bonus: { omnivamp: 0.12 } }, { units: 4, bonus: { omnivamp: 0.2, adPct: 0.15 } }, { units: 6, bonus: { omnivamp: 0.3, adPct: 0.35 } }] },
    { id: 'warden', name: 'Warden', breakpoints: [{ units: 2, bonus: { durability: 0.1 } }, { units: 4, bonus: { durability: 0.2 } }] },
    { id: 'sharpshooter', name: 'Sharpshooter', breakpoints: [{ units: 2, bonus: { crit: 0.2 } }, { units: 4, bonus: { crit: 0.4, critDmg: 0.2 } }] },
  ],
  items: [
    { id: 'greatsword', name: 'Greatsword', bonus: { adPct: 0.35, crit: 0.2, critDmg: 0.25 } },
    { id: 'ragestaff', name: 'Ragestaff', bonus: { ap: 10, asPct: 0.1, stackAs: 0.07 } },
    { id: 'bloodblade', name: 'Bloodblade', bonus: { adPct: 0.2, omnivamp: 0.2 } },
    { id: 'archstaff', name: 'Archstaff', bonus: { ap: 50 } },
    { id: 'spellblade', name: 'Spellblade', bonus: { ap: 15, crit: 0.3, abilityCrit: 1 } },
    { id: 'plateguard', name: 'Plateguard', bonus: { hp: 150, armor: 30, mr: 30 } },
    { id: 'lifestone', name: 'Lifestone', bonus: { hp: 300, hpPct: 0.12 } },
    { id: 'quickbow', name: 'Quickbow', bonus: { asPct: 0.4 } },
    { id: 'manastone', name: 'Manastone', bonus: { ap: 15, startMana: 25, manaRegen: 2 } },
    { id: 'aegischarm', name: 'Aegis Charm', bonus: { armor: 20, mr: 20, shield: 0.25 } },
    { id: 'thornmail', name: 'Thornmail', bonus: { armor: 50, durability: 0.08 } },
    { id: 'huntersmark', name: "Hunter's Mark", bonus: { adPct: 0.15, amp: 0.15 } },
  ],
}
