// Checks of the fight engine: npm test (or node scripts/engine-test.mjs).
// It pins the rules a result rests on: a seed replays the same fight, neither side is favoured, attack speed is what
// the numbers say, resistances, crits, shields, heals and mana work as described, traits turn on at their breakpoints,
// fights end (in a win, a draw or at the time limit), a patch changes only what it names, and a shared link still opens
// when the set has moved on. Everything is seeded, so a check passes or fails the same way every time. The TFT checks
// run when the set's copy is there (sets/tft-snapshot.json).

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { register } from 'node:module'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.log(`  ! The engine checks need Node.js 22.18 or newer, which runs the engine's TypeScript as it is (this is ${process.versions.node}). Skipped.`)
  process.exit(0)
}

// The app's "@/…" imports, for the files that use them (lib/sets.ts)
const root = new URL('../', import.meta.url)
register(`data:text/javascript,${encodeURIComponent(`export const resolve = (s, c, n) => n(s.startsWith('@/') ? new URL(s.slice(2), ${JSON.stringify(root.href)}).href : s, c)`)}`)

const { prepare, activeTraits } = await import('../engine/prepare.ts')
const { Fight, fight, emptyRecording } = await import('../engine/fight.ts')
const { runFights, runPaired, fightSeed, shift, margin, mergePaired } = await import('../engine/batch.ts')
const { applyOverrides, clean, validPath } = await import('../engine/patch.ts')
const { DT, EV, MAX_TIME, OUT } = await import('../engine/consts.ts')
const { SANDBOX, DEFAULT_RULES } = await import('../sets/sandbox.ts')
const { readSet } = await import('../lib/sets.ts')
const { poolSize } = await import('../lib/runner.ts')
const { encodeLink, decodeLink, fit, readShared } = await import('../lib/state.ts')
const { currentSet, patchName, metaPatch } = await import('../lib/refresh.ts')
const { PATCHES, shipped, patchById } = await import('../lib/patches.ts')
const { RUN, runPatch } = await import('../lib/patch-run.ts')
const { readMeta } = await import('../lib/comps.ts')

let passed = 0
const failed = []
const fail = (name, e) => { failed.push(name); console.log(`  ✖ ${name}\n      ${String(e?.message ?? e).split('\n').join('\n      ')}`) }
const check = (name, fn) => {
  try { fn(); passed++ } catch (e) { fail(name, e) }
}
const checkLater = async (name, fn) => {
  try { await fn(); passed++ } catch (e) { fail(name, e) }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, expected ${b} ± ${tol}`)

/* ── A set small enough to count by hand: a striker and a wall that never hits back ── */
const base = { mana: 0, startMana: 0, armor: 0, mr: 0, range: 1, crit: 0, critDmg: 1.4 }
const lab = (striker = {}, wall = {}, rules = {}, ability = { name: 'None', effects: [] }) => ({
  id: 'lab', name: 'Lab', source: 'test', rules: { ...DEFAULT_RULES, overtime: 1000, ...rules },
  units: [
    { id: 'striker', name: 'Striker', cost: 1, traits: ['blade'], stats: { ...base, hp: 1000, ad: 100, as: 1, ...striker }, ability },
    { id: 'wall', name: 'Wall', cost: 1, traits: ['stone'], stats: { ...base, hp: 1e7, ad: 0, as: 0, ...wall }, ability: { name: 'None', effects: [] } },
    { id: 'second', name: 'Second', cost: 2, traits: ['blade'], stats: { ...base, hp: 1000, ad: 100, as: 1 }, ability: { name: 'None', effects: [] } },
  ],
  items: [{ id: 'crest', name: 'Crest', bonus: {}, trait: 'blade' }, { id: 'plate', name: 'Plate', bonus: { armor: 100, hp: 500 } }],
  traits: [
    { id: 'blade', name: 'Blade', breakpoints: [{ units: 2, bonus: { adPct: 0.5 } }, { units: 3, bonus: { adPct: 1 }, team: { armor: 10 } }] },
    { id: 'stone', name: 'Stone', breakpoints: [{ units: 1, bonus: { armor: 20 } }] },
  ],
})
const duel = { blue: [{ unit: 'striker', star: 1, items: [], row: 4, col: 3 }], red: [{ unit: 'wall', star: 1, items: [], row: 3, col: 3 }] }
/** One fight of the lab set, recorded: its result, the striker's attack ticks and every hit */
const watch = (set, boards = duel, seed = 7) => {
  const rec = emptyRecording(), result = new Fight(prepare(set, boards), seed, rec).run()
  const attacks = rec.events.filter((e) => (e[1] === EV.attack || e[1] === EV.crit) && e[2] === 0).map((e) => e[0])
  const hits = []
  for (let k = 0; k < rec.hits.length; k += 5) hits.push({ tick: rec.hits[k], from: rec.hits[k + 1], to: rec.hits[k + 2], amount: rec.hits[k + 3] })
  return { rec, result, attacks, hits }
}
const noStone = (set) => ({ ...set, traits: set.traits.filter((t) => t.id !== 'stone'), units: set.units.map((u) => ({ ...u, traits: u.traits.filter((t) => t !== 'stone') })) })

/* ── Seeds ── */
check('a seed replays the same fight, recorded or not', () => {
  const p = prepare(SANDBOX, SANDBOX.sample)
  for (const seed of [1, 2, 99, 20261026]) {
    const a = fight(p, seed), b = fight(p, seed), c = fight(p, seed, emptyRecording())
    assert.equal(a.winner, b.winner); assert.equal(a.time, b.time); assert.deepEqual([...a.units], [...b.units])
    assert.equal(a.winner, c.winner); assert.equal(a.time, c.time); assert.deepEqual([...a.units], [...c.units])
  }
})
check('other seeds give other fights', () => {
  const p = prepare(SANDBOX, SANDBOX.sample)
  assert.ok(new Set(Array.from({ length: 40 }, (_, i) => fight(p, fightSeed(5, i)).time)).size > 10)
})
check('every fight of a run has its own seed, the same in the live and the patched run', () => {
  assert.equal(new Set(Array.from({ length: 20000 }, (_, i) => fightSeed(20261026, i))).size, 20000)
  assert.equal(fightSeed(1, 5), fightSeed(1, 5))
  assert.notEqual(fightSeed(1, 5), fightSeed(2, 5))
})
check('a run cut into slices adds up to the same run', () => {
  const p = prepare(SANDBOX, SANDBOX.sample)
  const whole = runPaired(p, null, 3, 0, 300)
  const parts = [[0, 8], [8, 92], [100, 200]].map(([from, n]) => runPaired(p, null, 3, from, n)).reduce(mergePaired)
  assert.deepEqual(parts.live.wins, whole.live.wins); assert.equal(parts.live.fights, 300); near(parts.live.time, whole.live.time, 1e-6, 'time')
})

/* ── Neither side is favoured ── */
const turned = (pieces) => pieces.map((p) => ({ ...p, row: 7 - p.row, col: 6 - p.col }))
check('a mirror match is even', () => {
  const t = runFights(SANDBOX, { blue: SANDBOX.sample.blue, red: turned(SANDBOX.sample.blue) }, 11, 0, 3000)
  near(t.wins[0] / t.fights, 0.5, 0.035, 'blue wins')
})
check('swapping the sides swaps the result', () => {
  const a = runFights(SANDBOX, SANDBOX.sample, 12, 0, 3000), b = runFights(SANDBOX, { blue: turned(SANDBOX.sample.red), red: turned(SANDBOX.sample.blue) }, 13, 0, 3000)
  near(a.wins[0] / a.fights, b.wins[1] / b.fights, 0.045, 'blue as blue against blue as red')
})

/* ── Targets ── */
check('a unit attacks the nearest enemy, picks fairly between two as near, and stays on its target', () => {
  // A step lands at once and the next one waits for the move time: with a move time longer than the fight, a unit
  // gets one hex closer and no more
  const set = noStone(lab({}, { hp: 450 }, { maxTime: 12, moveTime: 1000 }))
  const red = (...at) => at.map(([row, col]) => ({ unit: 'wall', star: 1, items: [], row, col }))
  const targets = (boards, seed) => watch(set, boards, seed).rec.events.filter((e) => e[1] === EV.attack && e[2] === 0).map((e) => [e[0], e[3]])
  // Red's units are listed from its front row back: the one next to the striker is unit 1, the one three hexes away unit 2
  for (let seed = 1; seed <= 40; seed++) assert.equal(targets({ blue: duel.blue, red: red([3, 3], [1, 3]) }, seed)[0][1], 1, 'the enemy one hex away, not the one behind it')
  let first = 0
  for (let seed = 1; seed <= 400; seed++) {
    const { rec } = watch(set, { blue: duel.blue, red: red([3, 2], [3, 3]) }, seed)
    const hits = rec.events.filter((e) => e[1] === EV.attack && e[2] === 0), death = rec.events.find((e) => e[1] === EV.death)?.[0] ?? Infinity
    if (hits[0][3] === 1) first++
    assert.equal(new Set(hits.filter((e) => e[0] <= death).map((e) => e[3])).size, 1, 'one target until it falls')
    assert.ok(hits.some((e) => e[3] !== hits[0][3]), 'then the other one')
  }
  near(first / 400, 0.5, 0.08, 'share of fights that start on the first of two enemies as near')
})

/* ── Attack speed ── */
const speed = (as, rules) => {
  const { attacks } = watch(lab({ as }, {}, { maxTime: 30, ...rules }))
  return (attacks.length - 1) / ((attacks[attacks.length - 1] - attacks[0]) * DT)
}
check('attacks come at the attack speed, not rounded to the 1/20 s step', () => {
  for (const as of [0.5, 0.7, 0.75, 0.76, 1, 1.3, 2.3, 3.4, 4.5, 4.9]) near(speed(as), as, as * 0.004, `attack speed ${as}`)
  assert.ok(speed(0.76) > speed(0.75) * 1.01, 'a small buff shows')
})
check('attack speed stops at the cap', () => {
  near(speed(5), 5, 0.02, 'at the cap'); near(speed(8), 5, 0.02, 'over the cap'); near(speed(8, { maxAs: 2 }), 2, 0.01, 'a lower cap')
})

check('move time and cast time count as they are, not rounded up to the 1/20 s step', () => {
  // Seven rows apart, both walk: three steps each, then the striker's attack waits for its third step to end
  const first = (moveTime) => watch(noStone(lab({}, { hp: 1e7 }, { maxTime: 6, moveTime })), { blue: [{ ...duel.blue[0], row: 7 }], red: [{ ...duel.red[0], row: 0 }] }).attacks[0] * DT
  for (const m of [0.4, 0.42, 0.45, 0.47, 0.5]) { const t = first(m); assert.ok(t >= 0.05 + 3 * m - 1e-9 && t < 0.05 + 3 * m + DT, `first attack with ${m} s a hex: ${t} s`) }
  assert.ok(first(0.42) < first(0.45) && first(0.47) > first(0.45), 'a hundredth of a second shows')
  // Two attacks fill the bar, the cast starts on the next step: a cycle is 0.55 s and the cast time
  const ping = { name: 'Ping', effects: [{ kind: 'shield', target: 'self', value: [1, 1, 1], duration: 1 }] }
  const cycle = (castTime) => { const c = watch(noStone(lab({ mana: 20, as: 2 }, {}, { maxTime: 60, manaLock: 0, castTime }, ping))).rec.events.filter((e) => e[1] === EV.cast).map((e) => e[0]); return ((c[c.length - 1] - c[0]) * DT) / (c.length - 1) }
  for (const c of [0.5, 0.52, 0.55, 0.6, 0.75]) near(cycle(c), 0.55 + c, 0.006, `cycle with a cast of ${c} s`)
})

/* ── Damage ── */
const perHit = (striker, wall, ability) => watch(noStone(lab(striker, wall, { maxTime: 10 }, ability))).hits.filter((h) => h.from === 0).map((h) => h.amount)
check('armor and magic resist take 100 / (100 + resistance); true damage ignores them', () => {
  for (const h of perHit({}, { armor: 0 })) near(h, 100, 1e-9, 'no armor')
  for (const h of perHit({}, { armor: 100 })) near(h, 50, 1e-9, '100 armor')
  for (const h of perHit({}, { armor: 300, mr: 0 })) near(h, 25, 1e-9, '300 armor')
  for (const h of perHit({}, { armor: -50 })) near(h, 100, 1e-9, 'armor below 0 counts as 0')
  const spell = (type) => ({ name: 'Bolt', effects: [{ kind: 'damage', target: 'target', value: [200, 200, 200], type }] })
  const cast = (type, wall) => perHit({ ad: 0, mana: 10, startMana: 10 }, wall, spell(type)).filter((h) => h > 0)[0]
  near(cast('magic', { mr: 100, armor: 500 }), 100, 1e-9, 'magic against 100 magic resist')
  near(cast('physical', { mr: 500, armor: 100 }), 100, 1e-9, 'physical ability against 100 armor')
  near(cast('true', { mr: 500, armor: 500 }), 200, 1e-9, 'true damage')
})
check('crits multiply by the crit damage, as often as the crit chance', () => {
  for (const h of perHit({ crit: 1, critDmg: 1.5 }, {})) near(h, 150, 1e-9, 'always crits')
  const hits = watch(noStone(lab({ as: 5, crit: 0.25 }, {}, { maxTime: 120 }))).hits.map((h) => h.amount)
  assert.ok(hits.every((h) => Math.abs(h - 100) < 1e-9 || Math.abs(h - 140) < 1e-9), 'hits are 100 or 140')
  near(hits.filter((h) => h > 120).length / hits.length, 0.25, 0.05, 'share of crits')
})
check('stars multiply health and attack damage', () => {
  const p = prepare(lab(), { blue: [{ unit: 'striker', star: 3, items: [], row: 4, col: 3 }], red: [{ unit: 'wall', star: 2, items: [], row: 3, col: 3 }] })
  near(p.fighters[0].hp, 3240, 1e-9, '3-star health'); near(p.fighters[0].adBase, 225, 1e-9, '3-star attack damage'); near(p.fighters[1].hp, 1.8e7, 1e-3, '2-star health')
})
check('overtime adds damage every second', () => {
  const hits = watch(noStone(lab({}, {}, { overtime: 5, overtimeAmp: 0.25, maxTime: 12 }))).hits
  for (const h of hits) near(h.amount, 100 * (h.tick * DT > 5 ? 1 + 0.25 * (h.tick * DT - 5) : 1), 1e-6, `hit at ${h.tick * DT} s`)
  assert.ok(hits.some((h) => h.amount > 200))
})

/* ── Mana, casts, shields, heals ── */
check('mana comes with attacks and a full bar casts', () => {
  const bolt = { name: 'Bolt', effects: [{ kind: 'damage', target: 'target', value: [300, 300, 300], type: 'true' }] }
  const { rec, result } = watch(noStone(lab({ mana: 30 }, {}, { maxTime: 20 }, bolt)))
  const casts = rec.events.filter((e) => e[1] === EV.cast).map((e) => e[0]), attacks = rec.events.filter((e) => e[1] === EV.attack).map((e) => e[0])
  assert.ok(casts.length >= 4, `${casts.length} casts`)
  assert.equal(attacks.filter((t) => t < casts[0]).length, 3, 'three attacks of 10 mana fill a bar of 30')
  assert.equal(result.units[4], casts.length, 'casts are counted')
  assert.equal(watch(noStone(lab({ mana: 0 }, {}, { maxTime: 10 }, bolt))).rec.events.filter((e) => e[1] === EV.cast).length, 0, 'no mana: no casts')
})
check('a shield takes the damage first, and a heal stops at full health', () => {
  const guard = { name: 'Guard', effects: [{ kind: 'shield', target: 'self', value: [250, 250, 250], duration: 30 }, { kind: 'heal', target: 'self', value: [5000, 5000, 5000] }] }
  const set = lab({ hp: 1000, mana: 10, startMana: 10, ad: 0 }, { hp: 1e7, ad: 100, as: 1 }, { maxTime: 6.5, manaPerAttack: 0, manaFromDamage: [0, 0] }, guard)
  const rec = emptyRecording(), f = new Fight(prepare(noStone(set), duel), 3, rec), r = f.run()
  const taken = r.units[1], left = r.units[6]
  assert.ok(taken >= 500 && taken <= 700, `the wall dealt ${taken}`)
  near(left, (1000 - (taken - 250)) / 1000, 1e-9, 'health left: the shield took the first 250')
  assert.equal(r.units[2], 0, 'a heal at full health heals nothing')
  near(r.units[3], 250, 1e-9, 'shield counted')
})
check('damage taken fills the mana bar: a share of the hit before and after resistances, up to a cap', () => {
  const guard = { name: 'Guard', effects: [{ kind: 'shield', target: 'self', value: [1, 1, 1], duration: 1 }] }
  const casts = (rules, wall = {}) => new Fight(prepare(noStone(lab({ hp: 1e6, mana: 40, ad: 0, armor: 100 }, { hp: 1e7, ad: 100, as: 1, ...wall }, { maxTime: 10.05, manaPerAttack: 0, manaLock: 0, ...rules }, guard)), duel), 3).run().units[4]
  // Ten hits fit in the time. 100 before armor, 50 after: 1 + 1.5 mana a hit, and a bar of 40 needs sixteen
  assert.equal(casts({ manaFromDamage: [0.01, 0.03] }), 0)
  // 10 + 15 mana a hit, and what is past the bar carries over: casts on hits 2, 4, 5, 7, 8 and 10
  assert.equal(casts({ manaFromDamage: [0.1, 0.3] }), 6)
  // A hit of 10,000 would give 250: capped at 42.5, it fills the bar every hit, and one hit can't cast twice
  assert.equal(casts({ manaFromDamage: [0.01, 0.03] }, { ad: 10000 }), 10)
  assert.equal(casts({ manaFromDamage: [0, 0] }), 0)
})
check('mana past a full bar carries over to the next cast, up to one cast', () => {
  const ping = { name: 'Ping', effects: [{ kind: 'shield', target: 'self', value: [1, 1, 1], duration: 1 }] }
  // A bar of 25 and 10 a hit: the third hit casts with 5 to spare, so the next cast takes two hits, then three again
  const { rec } = watch(noStone(lab({ mana: 25, as: 2 }, {}, { maxTime: 12, manaLock: 0, castTime: 0.1 }, ping)))
  const casts = rec.events.filter((e) => e[1] === EV.cast).map((e) => e[0]), hits = rec.events.filter((e) => e[1] === EV.attack && e[2] === 0).map((e) => e[0])
  const between = casts.slice(0, 5).map((c, k) => hits.filter((h) => h <= c && h > (k ? casts[k - 1] : -1)).length)
  assert.deepEqual(between, [3, 2, 3, 2, 3])
  // One gain, however big, is good for the cast it fills and one more
  const f = new Fight(prepare(noStone(lab({ mana: 60 })), duel), 1), u = f.units[0]
  f.addMana(u, 50); assert.equal(u.mana, 50); f.addMana(u, 20); assert.equal(u.mana, 70)
  f.cast(u, f.units[1]); assert.equal(u.mana, 10, '50/60 + 20 leaves 10/60 after the cast')
  u.castUntil = u.castLockUntil = 0; f.addMana(u, 1000); assert.equal(u.mana, 120); f.cast(u, f.units[1]); assert.equal(u.mana, 60)
})
check('no mana for the second after a cast', () => {
  const ping = { name: 'Ping', effects: [{ kind: 'shield', target: 'self', value: [1, 1, 1], duration: 1 }] }
  // Two attacks a second, each one a full bar: a cast every attack without the lock, every third with a lock of 1 s, every fifth with 2 s
  const casts = (manaLock) => watch(noStone(lab({ mana: 10, as: 2 }, {}, { maxTime: 30.2, manaLock, castTime: 0.1 }, ping))).result.units[4]
  const [none, one, two] = [casts(0), casts(1), casts(2)]
  assert.ok(none >= 58 && none <= 61, `${none} casts without a lock`); assert.ok(one >= 19 && one <= 21, `${one} casts with a lock of 1 s`); assert.ok(two >= 11 && two <= 13, `${two} casts with a lock of 2 s`)
  const f = new Fight(prepare(noStone(lab({ mana: 60 })), duel), 1), u = f.units[0]
  f.now = 3; f.tick = 60; f.cast(u, f.units[1]); assert.equal(u.castLockUntil, 4); f.now = 3.9; f.addMana(u, 10); assert.equal(u.mana, 0); f.now = 4; f.addMana(u, 10); assert.equal(u.mana, 10)
})
check('a stun stops attacks and casts, not mana regeneration', () => {
  const f = new Fight(prepare(noStone(lab({ mana: 100 })), duel), 1), u = f.units[0]
  u.manaRegen = 20; f.now = 1; f.tick = 20; u.stunUntil = 5; u.attackAt = 0
  f.update(u); near(u.mana, 1, 1e-9, 'mana after one step of 20 a second, stunned'); assert.equal(u.attacks, 0, 'no attack while stunned')
  u.castLockUntil = 5; f.update(u); near(u.mana, 1, 1e-9, 'none during the lock after a cast')
  u.castLockUntil = 0; u.stunUntil = 0; f.update(u); near(u.mana, 2 + 10, 1e-9, 'regeneration and the attack it can make again'); assert.equal(u.attacks, 1)
})
check('crit chance stops at 100% and the rest becomes crit damage', () => {
  const set = noStone(lab({ crit: 0.5 }, {}, { maxTime: 10.05 }))
  set.items = [{ id: 'kit', name: 'Kit', bonus: { crit: 0.75 } }]
  const p = prepare(set, { blue: [{ ...duel.blue[0], items: ['kit'] }], red: duel.red })
  near(p.fighters[0].crit, 1, 1e-9, 'crit chance'); near(p.fighters[0].critDmg, 1.65, 1e-9, 'crit damage: 1.4 and the 25% past 100%')
  for (const h of watch(set, { blue: [{ ...duel.blue[0], items: ['kit'] }], red: duel.red }).hits) near(h.amount, 165, 1e-9, 'every hit crits for 165%')
  const f = new Fight(p, 1), u = f.units[0]
  f.buff(u, 8, 0.3, 5); near(f.critChance(u), 1, 1e-9, 'a timed crit buff'); near(f.critMult(u), 1.95, 1e-9, 'its excess too')
})

/* ── Traits and items ── */
check('a trait counts each unit once and turns on at its breakpoints', () => {
  const set = lab(), at = (pieces) => Object.fromEntries(activeTraits(set, pieces).map((t) => [t.id, t.level]))
  const s = (unit, col, items = []) => ({ unit, star: 1, items, row: 4, col })
  assert.deepEqual(at([s('striker', 0)]), { blade: -1 })
  assert.deepEqual(at([s('striker', 0), s('striker', 1)]), { blade: -1 }, 'the same unit twice counts once')
  assert.deepEqual(at([s('striker', 0), s('second', 1)]), { blade: 0 })
  assert.deepEqual(at([s('striker', 0), s('second', 1), s('wall', 2, ['crest'])]), { blade: 1, stone: 0 }, 'an emblem gives its trait')
  const p = prepare(set, { blue: [s('striker', 0), s('second', 1), s('wall', 2, ['crest', 'plate'])], red: [] })
  near(p.fighters[0].adPct, 1, 1e-9, 'breakpoint bonus'); near(p.fighters[0].armor, 10, 1e-9, 'team bonus')
  near(p.fighters[2].armor, 10 + 20 + 100, 1e-9, 'team, own trait and item add up'); near(p.fighters[2].hp, 1e7 + 500, 1e-3, 'item health')
})

check('an item adds what its numbers say', () => {
  const kit = (bonus, to = 'striker') => {
    const set = noStone(lab({}, { ad: 100, as: 1 }, { maxTime: 10.05 }))
    set.items = [{ id: 'kit', name: 'Kit', bonus }]
    const boards = { blue: [{ ...duel.blue[0], items: to === 'striker' ? ['kit'] : [] }], red: [{ ...duel.red[0], items: to === 'wall' ? ['kit'] : [] }] }
    return watch(set, boards)
  }
  const dealt = (w) => w.hits.filter((h) => h.from === 0).map((h) => h.amount)
  for (const h of dealt(kit({ adPct: 0.5 }))) near(h, 150, 1e-9, '+50% attack damage')
  for (const h of dealt(kit({ amp: 0.5 }))) near(h, 150, 1e-9, '+50% damage')
  for (const h of dealt(kit({ durability: 0.2 }, 'wall'))) near(h, 80, 1e-9, '20% durability')
  for (const h of dealt(kit({ crit: 1, critDmg: 0.6 }))) near(h, 200, 1e-9, 'crit chance and crit damage')
  const fast = kit({ asPct: 0.5 }).attacks
  near((fast.length - 1) / ((fast[fast.length - 1] - fast[0]) * DT), 1.5, 0.01, '+50% attack speed')
  const stacking = kit({ stackAs: 0.1 }).attacks, gaps = stacking.slice(1).map((t, k) => (t - stacking[k]) * DT)
  near(gaps[0], 1 / 1.1, 0.051, 'first gap with 10% attack speed a hit'); near(gaps[9], 1 / 2, 0.051, 'tenth gap')
  const shielded = kit({ shield: 0.25 }).result
  near(shielded.units[3], 250, 1e-9, 'a shield of 25% of max health'); near(shielded.units[6], 1 - (shielded.units[1] - 250) / 1000, 1e-9, 'it took the first hits')
  const vamp = kit({ omnivamp: 0.2 }).result
  assert.ok(vamp.units[2] > 0 && vamp.units[2] <= vamp.units[0] * 0.2 + 1e-9, `healed ${vamp.units[2]} of ${vamp.units[0]} dealt`)
  near(prepare(lab(), { blue: [{ ...duel.blue[0], items: ['plate', 'plate', 'plate', 'plate'] }], red: duel.red }).fighters[0].armor, 300, 1e-9, 'three items at most')
})

/* ── Fights end ── */
check('an empty side means no fights', () => {
  assert.equal(runFights(SANDBOX, { blue: SANDBOX.sample.blue, red: [] }, 1, 0, 50).fights, 0)
  assert.equal(runFights(SANDBOX, { blue: [], red: [] }, 1, 0, 50).fights, 0)
  assert.equal(runPaired(prepare(SANDBOX, { blue: [], red: SANDBOX.sample.red }), null, 1, 0, 50).live.fights, 0)
})
check('a fight nobody wins is a draw at the time limit', () => {
  const r = fight(prepare(lab({ ad: 0 }, {}, { maxTime: 12 }), duel), 1)
  assert.equal(r.winner, -1); near(r.time, 12, 1e-9, 'time')
  const t = runFights(lab({ ad: 0 }, {}, { maxTime: 5 }), duel, 1, 0, 20)
  assert.deepEqual([t.wins[0], t.wins[1], t.draws], [0, 0, 20])
})
check('no time limit holds a fight for more than five minutes', () => {
  for (const maxTime of [1e9, Infinity]) near(fight(prepare(lab({ ad: 0 }, {}, { maxTime }), duel), 1).time, MAX_TIME, 1e-9, `limit ${maxTime}`)
  for (const maxTime of [0, -5, NaN]) assert.equal(fight(prepare(lab({}, {}, { maxTime }), duel), 1).time, 0)
})
check('the last unit standing wins; a unit with no health left is out', () => {
  const r = fight(prepare(lab({}, { hp: 450 }), duel), 1)
  assert.equal(r.winner, 0); assert.equal(r.units[OUT + 5], 0); assert.equal(r.units[OUT + 6], 0); assert.equal(r.units[5], 1)
  near(r.units[0], 500, 1e-9, 'five hits of 100, the last one whole')
})
check('two units given the same hex: the second sits out', () => {
  const p = prepare(lab(), { blue: [{ unit: 'striker', star: 1, items: [], row: 4, col: 3 }, { unit: 'second', star: 1, items: [], row: 4, col: 3 }], red: duel.red })
  const f = new Fight(p, 1)
  assert.equal(f.left[0], 1); assert.equal(f.units.filter((u) => u.alive && u.side === 0).length, 1)
})

/* ── Runs and patches ── */
check('live and patch fight the same seeds: a patch that changes nothing moves nothing', () => {
  const p = prepare(SANDBOX, SANDBOX.sample), same = runPaired(p, p, 9, 0, 200)
  assert.deepEqual(same.live.wins, same.patch.wins); assert.equal(same.gained + same.lost, 0)
  assert.deepEqual(shift(same), { delta: 0, margin: 0 }); assert.equal(shift(runPaired(p, null, 9, 0, 50)), null)
})
check('a buff moves the win rate its way, and the margin shrinks with more fights', () => {
  const unit = SANDBOX.sample.blue[0].unit, buffed = applyOverrides(SANDBOX, { [`u.${unit}.hp`]: SANDBOX.units.find((u) => u.id === unit).stats.hp * 2 })
  const few = runPaired(prepare(SANDBOX, SANDBOX.sample), prepare(buffed, SANDBOX.sample), 4, 0, 200), many = runPaired(prepare(SANDBOX, SANDBOX.sample), prepare(buffed, SANDBOX.sample), 4, 0, 1200)
  assert.ok(shift(many).delta > shift(many).margin, `+${shift(many).delta} ± ${shift(many).margin}`)
  assert.ok(shift(many).margin < shift(few).margin)
  near(margin(0.5, 5000), 1.385, 0.01, 'margin of 50% over 5,000 fights'); assert.ok(margin(1, 5000) > 0 && margin(1, 5000) < 0.2); assert.equal(margin(0.5, 0), 0)
})
check('a patch changes the numbers it names and nothing else', () => {
  const unit = SANDBOX.units[0], path = `u.${unit.id}.armor`, out = applyOverrides(SANDBOX, { [path]: unit.stats.armor + 15, 'u.nobody.hp': 5, [`u.${unit.id}.hp`]: NaN })
  assert.equal(out.units[0].stats.armor, unit.stats.armor + 15); assert.equal(out.units[0].stats.hp, unit.stats.hp); assert.equal(SANDBOX.units[0].stats.armor, unit.stats.armor)
  assert.ok(validPath(SANDBOX, path)); assert.ok(!validPath(SANDBOX, 'u.nobody.hp')); assert.ok(!validPath(SANDBOX, `${path}.x.y`))
  assert.deepEqual(clean(SANDBOX, { [path]: unit.stats.armor, 'r.maxAs': 4, 'u.nobody.hp': 5 }), { 'r.maxAs': 4 }, 'a number equal to the set\'s, or of a unit it doesn\'t have, is dropped')
  assert.equal(applyOverrides(SANDBOX, {}), SANDBOX)
})
check('workers: every core but one, at most 8, fewer on little memory', () => {
  assert.deepEqual([poolSize(1), poolSize(2), poolSize(4), poolSize(8), poolSize(16), poolSize(64)], [1, 1, 3, 7, 8, 8])
  assert.deepEqual([poolSize(8, 8), poolSize(8, 4), poolSize(8, 2), poolSize(8, 0.5), poolSize(2, 1)], [7, 4, 2, 2, 1])
})

/* ── Links ── */
await checkLater('a link holds the setup, the patch it was made on and its run, and still opens when the set has moved on', async () => {
  const pieces = [...SANDBOX.sample.blue, ...SANDBOX.sample.red], unit = SANDBOX.units.find((u) => u.id === pieces[0].unit), other = pieces.find((p) => p.unit !== unit.id).unit
  const patch = { [`u.${unit.id}.armor`]: unit.stats.armor + 15, [`u.${other}.hp`]: 1234 }
  const doc = { set: SANDBOX.id, fights: 5000, spaces: { [SANDBOX.id]: { pieces, live: {}, patch } } }
  const run = { live: 0.5, patch: 0.56, delta: 6, margin: 1.2, fights: 5000 }
  const opened = await decodeLink(await encodeLink(doc, SANDBOX.id, null, run, '18.6'))
  assert.equal(opened.set, SANDBOX.id); assert.equal(opened.version, '18.6'); assert.equal(opened.fights, 5000)
  assert.equal(opened.space.pieces.length, pieces.length); assert.deepEqual(opened.space.patch, patch); assert.deepEqual(opened.run, run)
  assert.equal((await decodeLink(await encodeLink(doc, SANDBOX.id, null))).version, undefined, 'a link without a patch still reads')
  // Later: one unit has left the set, and the other's armor is now what the link patched it to
  const later = { ...SANDBOX, units: SANDBOX.units.filter((u) => u.id !== other).map((u) => (u.id === unit.id ? { ...u, stats: { ...u.stats, armor: unit.stats.armor + 15 } } : u)) }
  const fitted = fit(opened.space, later)
  assert.equal(fitted.pieces.length, pieces.filter((p) => p.unit !== other).length, 'the unit that left is dropped, the rest stay')
  assert.deepEqual(fitted.patch, {}, 'a change the set already has, and one to a unit it lost, are dropped')
  assert.equal(await decodeLink('zgarbage'), null); assert.equal(await decodeLink(''), null); assert.equal(readShared({ v: 2, s: 'x', p: [] }), null)
})

/* ── TFT, when its copy is here ── */
const snapshot = JSON.parse(await readFile(new URL('sets/tft-snapshot.json', root), 'utf8').catch(() => 'null'))
if (snapshot?.units?.length && snapshot.sample) {
  const tft = readSet(snapshot).set
  check(`${tft.name}: a seed replays the same fight`, () => {
    const p = prepare(tft, tft.sample)
    for (const seed of [1, 2, 3]) {
      const a = fight(p, seed), b = fight(p, seed, emptyRecording())
      assert.equal(a.winner, b.winner); assert.equal(a.time, b.time); assert.deepEqual([...a.units], [...b.units])
    }
  })
  check(`${tft.name}: a mirror match is even`, () => {
    const t = runFights(tft, { blue: tft.sample.blue, red: turned(tft.sample.blue) }, 21, 0, 2000)
    near(t.wins[0] / t.fights, 0.5, 0.04, 'blue wins')
  })
  check(`${tft.name}: every unit fights, alone and at 3 stars, without an error`, () => {
    const foe = tft.units.find((u) => !u.plant && u.cost === 1)
    for (const u of tft.units) for (const star of [1, 3]) {
      const boards = { blue: [{ unit: u.id, star, items: [], row: 4, col: 3 }, { unit: foe.id, star: 1, items: [], row: 5, col: 2 }], red: [{ unit: foe.id, star: 2, items: [], row: 3, col: 3 }, { unit: u.id, star, items: [], row: 1, col: 4 }] }
      const p = prepare(tft, boards)
      for (const seed of [1, 2]) { const r = fight(p, seed); assert.ok(r.time > 0 && r.time <= tft.rules.maxTime + 1e-9 && r.units.every(Number.isFinite), `${u.name} ${star}★`) }
    }
  })
  check(`${tft.name}: every item fights without an error`, () => {
    const carry = tft.units.find((u) => !u.plant && u.cost === 4), foe = tft.units.find((u) => !u.plant && u.cost === 2)
    for (const item of tft.items) {
      const boards = { blue: [{ unit: carry.id, star: 2, items: [item.id], row: 4, col: 3 }], red: [{ unit: foe.id, star: 2, items: [item.id], row: 3, col: 3 }, { unit: carry.id, star: 1, items: [], row: 0, col: 0 }] }
      const r = fight(prepare(tft, boards), 5)
      assert.ok(r.time > 0 && r.units.every(Number.isFinite), item.name)
    }
  })
  check(`${tft.name}: a scripted number patched to 0 doesn't hold the fight`, () => {
    const boards = { blue: tft.sample.blue, red: tft.sample.red }
    let zeroed = 0
    for (const u of tft.units) {
      if (!boards.blue.some((p) => p.unit === u.id) && !boards.red.some((p) => p.unit === u.id) && u.id !== 'maokai') continue
      const patch = {}
      for (const [name, value] of Object.entries(u.ability.values ?? {})) for (let k = 0; k < value.v.length; k++) patch[value.v.length > 1 ? `u.${u.id}.$${name}.v${k + 1}` : `u.${u.id}.$${name}`] = 0
      const set = applyOverrides(tft, patch), on = u.id === 'maokai' ? { blue: [{ unit: 'maokai', star: 2, items: [], row: 4, col: 3 }], red: boards.red } : boards
      const t0 = performance.now(), t = runFights(set, on, 1, 0, 4)
      assert.equal(t.fights, 4); assert.ok(performance.now() - t0 < 5000, `${u.name} took too long`)
      zeroed++
    }
    assert.ok(zeroed > 5)
  })
  check(`${tft.name}: a number big enough to make a fight endless stops it with an error`, () => {
    const aphelios = tft.units.find((u) => u.key === 'da_18_aphelios'), speed = tft.traits.find((t) => t.id === 'rapidfire')
    if (!aphelios || !speed?.values) return
    // A million percent of attack speed a hit, and an ability with one more swipe per 20% of it
    const patch = {}
    for (const [name, value] of Object.entries(speed.values)) for (let k = 0; k < value.v.length; k++) patch[value.v.length > 1 ? `t.rapidfire.$${name}.b${k}` : `t.rapidfire.$${name}`] = 1e6
    const members = tft.units.filter((u) => u.traits.includes('rapidfire') && !u.plant).slice(0, 7)
    const boards = { blue: members.map((u, k) => ({ unit: u.id, star: 2, items: [], row: 7, col: k })), red: tft.sample.red }
    assert.ok(prepare(tft, boards).traits[0].rapidfire, 'the trait is on')
    assert.throws(() => runFights(applyOverrides(tft, patch), boards, 1, 0, 3), /went past [\d,]+ hits/)
    assert.equal(runFights(tft, boards, 1, 0, 3).fights, 3, 'the same boards fight with the set\'s own numbers')
  })
  check(`${tft.name}: an Elderwood plant gains 140% Health a star, a champion 180%`, () => {
    const guard = tft.units.find((u) => u.key === 'da_elderwood18_protector'), champ = tft.units.find((u) => !u.plant && u.cost === 1)
    if (!guard?.starHp) return
    const hp = (unit, star) => prepare(tft, { blue: [{ unit: unit.id, star, items: [], row: 7, col: 0 }], red: [] }).fighters.find((f) => f.unit === unit.id).hp
    near(hp(guard, 1), guard.stats.hp, 1e-6); near(hp(guard, 2), guard.stats.hp * 1.4, 1e-6); near(hp(guard, 3), guard.stats.hp * 1.96, 1e-6)
    near(hp(champ, 2), champ.stats.hp * 1.8, 1e-6)
  })
  check(`${tft.name}: Gromp's area damage is Riot's 18.4 number, and says so`, () => {
    const gromp = tft.units.find((u) => u.key === 'da_gromp18_ap')
    if (!gromp?.source) return
    assert.deepEqual(gromp.ability.values.area.v, [160, 240, 375])
    assert.match(gromp.source, /Riot's patch 18\.4 notes, 2026-10-06/)
  })
  const meta = await readFile(new URL('../sets/meta-snapshot.json', import.meta.url), 'utf8').then((t) => readMeta(JSON.parse(t)), () => null)
  const live = shipped().find((p) => `tft${p.set}` === tft.id)
  if (meta?.comps.length && live) check(`Patch ${live.label}: every comp in the table won between ${RUN.edge * 100}% and ${(1 - RUN.edge) * 100}% of its fights before the patch`, () => {
    const run = runPatch(tft, meta, live)
    if (!run) return
    assert.ok(run.comps.length >= 2)
    for (const c of run.comps) {
      assert.ok(c.before >= RUN.edge && c.before <= 1 - RUN.edge, `${c.name} won ${(c.before * 100).toFixed(1)}% before the patch`)
      assert.equal(c.fights, (run.comps.length - 1) * RUN.fights, `${c.name} fought every other comp in the table ${RUN.fights} times`)
    }
    assert.equal(run.fights, (run.comps.length * (run.comps.length - 1) / 2) * RUN.fights)
  })
} else console.log('  · No copy of the TFT set here (sets/tft-snapshot.json): its checks were left out.')

/* ── Following the game: which set the site answers with, what patch it calls it, which patches it lists ── */

await checkLater('The set follows the game: the build\'s copy while the game is on its version, the game\'s own data from then on', async () => {
  const copy = { id: 'tft18', version: '18.6', build: '16.22.1+a' }, next = { id: 'tft18', version: '18.7', build: '16.23.1+a' }
  let downloads = 0
  const live = async (build) => { downloads++; return { ...next, build } }
  assert.equal(await currentSet({ copy, build: async () => '16.22.1+a', live }), copy)
  assert.equal(downloads, 0, 'the same version downloads nothing')
  assert.deepEqual(await currentSet({ copy, build: async () => '16.23.1+a', live }), next)
  assert.equal(downloads, 1)
  // A mid-patch update keeps the patch's number and changes the data's version
  assert.equal((await currentSet({ copy, build: async () => '16.22.2+b', live })).build, '16.22.2+b')
})
await checkLater('The set is never lost: CommunityDragon down or the download failing answers with the copy, and with nothing only when there is no copy', async () => {
  const copy = { id: 'tft18', version: '18.6', build: '16.22.1+a' }
  const down = async () => { throw new Error('unreachable') }
  assert.equal(await currentSet({ copy, build: async () => null, live: down }), copy)
  assert.equal(await currentSet({ copy, build: down, live: down }), copy)
  assert.equal(await currentSet({ copy, build: async () => '16.23.1+a', live: down }), copy)
  assert.equal(await currentSet({ copy: null, build: async () => null, live: down }), null)
  assert.deepEqual(await currentSet({ copy: null, build: async () => '16.23.1+a', live: async (build) => ({ id: 'tft18', build }) }), { id: 'tft18', build: '16.23.1+a' })
})
check('The patch is called what the game data and MetaForge say, and never a patch the data is not of', () => {
  const set = { id: 'tft18', version: '18.6' }
  assert.equal(patchName(set, null), '18.6')
  assert.equal(patchName(set, { set: 18, patch: '18.6' }), '18.6')
  assert.equal(patchName(set, { set: 18, patch: '18.6b' }), '18.6b', 'MetaForge knows the letter of a mid-patch update')
  assert.equal(patchName({ id: 'tft18', version: '18.6b' }, { set: 18, patch: '18.6' }), '18.6b')
  assert.equal(patchName(set, { set: 18, patch: '18.7' }), '18.6', 'MetaForge ahead of the data: the data is still of 18.6')
  assert.equal(patchName({ id: 'tft18', version: '18.7' }, { set: 18, patch: '18.6' }), '18.7', 'the data ahead of MetaForge')
  assert.equal(patchName(set, { set: 19, patch: '19.1' }), '18.6', 'another set\'s name is not this set\'s')
  // A new set, before its kit: the game data can't name the patch, MetaForge does once it is on that set
  assert.equal(patchName({ id: 'tft19' }, { set: 19, patch: '19.1' }), '19.1')
  assert.equal(patchName({ id: 'tft19' }, { set: 18, patch: '18.8' }), undefined)
  assert.equal(patchName({ id: 'tft19' }, null), undefined)
  for (const odd of ['16.23', 'latest', '19.1 PBE', '', 'x', undefined]) assert.equal(patchName({ id: 'tft19' }, { set: 19, patch: odd }), undefined, `"${odd}" is not a patch of set 19`)
  // MetaForge's patch beside its comps: shown when the game data is on it or past it, not when it is ahead of the game
  assert.equal(metaPatch(set, '18.6'), '18.6')
  assert.equal(metaPatch(set, '18.6b'), '18.6b')
  assert.equal(metaPatch({ id: 'tft18', version: '18.7' }, '18.6'), '18.6', 'comps measured on the patch before')
  assert.equal(metaPatch(set, '18.7'), undefined, 'ahead of the game: not named')
  assert.equal(metaPatch(set, '19.1'), undefined)
  assert.equal(metaPatch({ id: 'tft19' }, '19.1'), '19.1')
  assert.equal(metaPatch(set, undefined), undefined)
})
check('A patch written ahead is not listed or answered for until its day has come and the game is on it', () => {
  const first = PATCHES[PATCHES.length - 1], newest = PATCHES[0], before = PATCHES[1]
  const day = (d) => Date.parse(`${d}T00:00:00Z`), hour = 3600000, has = (list, p) => list.some((x) => x.id === p.id)
  assert.ok(has(shipped(day(newest.date), newest.label), newest), 'its day has come and the game is on it')
  assert.ok(!has(shipped(day(newest.date) - 1, newest.label), newest), 'not before its day, whatever the game says')
  assert.ok(!has(shipped(day(newest.date) + 5 * hour, before.label), newest), 'its day has come, the game is still on the patch before')
  assert.ok(!has(shipped(day(newest.date) + 5 * hour), newest), 'nor when nothing says what the game is on')
  assert.ok(has(shipped(day(newest.date) + 24 * hour, before.label), newest) && has(shipped(day(newest.date) + 24 * hour), newest), 'a day later it is listed whatever they say')
  assert.equal(patchById(newest.id, day(newest.date) + 5 * hour, before.label), undefined)
  assert.equal(patchById(newest.id, day(newest.date) + 5 * hour, newest.label)?.id, newest.id)
  // A mid-patch update waits for its letter (18.5b is not 18.5c); a later patch or a later set lists every earlier one
  const letter = PATCHES.find((p) => /[a-z]$/.test(p.label))
  if (letter) {
    assert.ok(!has(shipped(day(letter.date), letter.label.slice(0, -1)), letter))
    assert.ok(has(shipped(day(letter.date), letter.label), letter))
    assert.ok(has(shipped(day(letter.date), `${letter.set}.99`), letter) && has(shipped(day(letter.date), `${letter.set + 1}.1`), letter))
  }
  assert.equal(shipped(day(first.date) - 1, newest.label).length, 0)
  assert.deepEqual(shipped().map((p) => p.id), PATCHES.map((p) => p.id), 'today every patch in the list is live')
  assert.deepEqual(shipped(Date.now(), newest.label).map((p) => p.id), PATCHES.map((p) => p.id))
})

console.log(failed.length ? `  ✖ ${failed.length} of ${passed + failed.length} engine checks failed` : `  ✔ ${passed} engine checks passed`)
process.exit(failed.length ? 1 : 0)
