import { EV, F, MAGIC, OUT, PHYS, S, TRUE } from '../consts.ts'
import type { Body, Cast, Fight, Kit } from '../fight.ts'
import { rowOf } from '../hex.ts'

// TFT Set 18, played the way the game describes it: every champion's ability (summons, transforms, channels, dashes),
// what items and traits do in combat, and Set 18's roles. The numbers aren't here: each unit, item and trait carries its
// own (set.units[].ability.values and the like: the game data's, tft.tools' where it has none), so a patch to any of
// them changes the fight.

type V = Record<string, number>
type TraitState = { level: number; count: number; v: V }

const casts: Record<string, Cast> = {}
/** Passives and anything a unit sets up at the start, by unit key */
const passives: Record<string, (c: Fight, u: Body) => void> = {}
/** By item id */
const items: Record<string, (c: Fight, u: Body, v: V) => void> = {}
/** By trait id: the side, the trait at its breakpoint, and the units that have it */
const traits: Record<string, (c: Fight, side: number, t: TraitState, members: Body[]) => void> = {}

/* ── Helpers ───────────────────────────────────────────── */

const foe = (u: Body) => 1 - u.side
const burning = (c: Fight, b: Body) => c.now < b.burnUntil || c.now < b.hotUntil
/** The target when it can still be hit, or the nearest enemy */
const aim = (c: Fight, u: Body, t: Body | null | undefined) => (t && c.targetable(t) ? t : c.nearestEnemy(u))
const pick = <T>(c: Fight, list: T[]): T | undefined => list[Math.floor(c.R() * list.length)]
const within = (c: Fight, u: Body, r: number) => c.enemies(u).filter((e) => c.dist(u, e) <= r)
/** Points a unit at a new target, as after a leap */
const retarget = (c: Fight, u: Body, t: Body) => { u.target = t; u.targetSince = c.now }
/** Bonus damage on top of an attack: it sets off nothing else */
const bonus = (c: Fight, u: Body, t: Body, amount: number, type: 0 | 1 | 2 = MAGIC) => (t.alive ? c.deal(u, t, amount, type, F.quiet) : 0)
/** A count of casts for the results, when an ability isn't cast with mana */
const counted = (c: Fight, u: Body) => { c.out[u.owner * OUT + 4]++ }
/** Damage along a line, less for each enemy it passes through */
const pierce = (c: Fight, u: Body, line: Body[], base: number, falloff: number, floor: number, type: 0 | 1 = PHYS, each?: (e: Body, k: number) => void) => {
  line.forEach((e, k) => {
    c.hit(u, e, base * Math.max(floor, 1 - falloff * k), type)
    each?.(e, k)
  })
}
/** Spread over a time in even ticks */
const spread = (c: Fight, u: Body, seconds: number, ticks: number, fn: (k: number) => void, token?: number) => {
  for (let k = 1; k <= ticks; k++) c.after((seconds * k) / ticks, () => { if (token === undefined || u.channel === token) fn(k) }, u)
}
const summonerBonus = (c: Fight, side: number, which: 'yorick' | 'azir' | 'beak' | 'zyra') => {
  const t = c.traits[side].summoner
  return t ? (t.v[which] ?? 0) * (t.v.scale ?? 1) : 0
}
const boardUnits = (c: Fight, side: number) => c.units.slice(0, c.n).filter((b) => b.side === side && b.alive)
/** The unit with the most items (then the highest cost) */
const strongest = (list: Body[]) => [...list].sort((a, b) => (b.f?.items.length ?? 0) - (a.f?.items.length ?? 0) || b.cost - a.cost || b.star - a.star)[0]
const uniqueThreeStars = (c: Fight, side: number) => new Set(boardUnits(c, side).filter((b) => b.star === 3 && !b.f?.plant).map((b) => b.f?.unit)).size

interface Empowered { left: number; as: number; magic: number; lock: boolean }
/** The next attacks gain attack speed and deal bonus magic damage. The caster's own (lock) hold its mana until used. */
function empower(c: Fight, b: Body, attacks: number, as: number, magic: number, lock = false) {
  const refs = (b.refs ??= {})
  let list = refs.empowered as Empowered[] | undefined
  if (!list) {
    list = refs.empowered = []
    c.onHit(b, (c, b, t) => {
      const l = b.refs!.empowered as Empowered[]
      for (let k = l.length - 1; k >= 0; k--) {
        const e = l[k]
        if (e.magic > 0) bonus(c, b, t, e.magic)
        if (--e.left <= 0) { b.asPct -= e.as; l.splice(k, 1); if (e.lock && !l.some((x) => x.lock)) c.manaUnlock(b) }
      }
    })
  }
  list.push({ left: attacks, as, magic, lock })
  b.asPct += as
  if (lock) c.manaLock(b)
}

/* ── 1 cost ────────────────────────────────────────────── */

casts.da_18_akali_ad = (c, u, t) => {
  const strike = (target: Body, left: number) => {
    let dmg = c.scale(u, u.v.dmgAd, u.v.dmgAp)
    if (burning(c, target)) dmg += c.scale(u, u.v.burnAd)
    c.hit(u, target, dmg, PHYS)
    // Ability power Akali casts again whenever it kills
    if (!target.alive && left > 0 && c.apMode(u)) { const next = c.nearestEnemy(u); if (next) strike(next, left - 1) }
  }
  strike(t, 4)
}

casts.da_18_camille = (c, u, t) => {
  c.shield(u, u, u.v.shield, u.v.shieldTime)
  c.hit(u, t, c.scale(u, u.v.dmgAd, u.v.dmgAp), PHYS)
}

casts.da_cinderling18 = (c, u, t) => {
  c.hit(u, t, c.scale(u, u.v.dmgAd, u.v.dmgAp), PHYS)
  c.wound(t, u.v.wound, u.v.time)
  c.burn(u, t, u.v.burn, u.v.time)
  if (u.n.alpha) u.adPct += u.v.alphaAd // Scarlet Buff
}

casts.da_karma18 = (c, u, t) => {
  const token = c.lock(u, u.v.tetherTime, true), ticks = 3
  spread(c, u, u.v.tetherTime, ticks, (k) => {
    if (!t.alive) return
    c.hit(u, t, c.byAp(u, u.v.tether) / ticks, MAGIC)
    if (k < ticks) return
    u.n.channeling = 0
    for (const e of c.around(t.cell, 1, foe(u))) { c.hit(u, e, c.byAp(u, u.v.burst), MAGIC); c.chill(e, u.v.slow, u.v.slowTime) }
  }, token)
}

casts.da_18_kobuko = (c, u) => {
  const total = c.byAp(u, u.v.heal) + u.v.healHp * u.maxHp
  spread(c, u, u.v.healTime, 4, () => c.heal(u, u, total / 4))
  u.n.bash = 1
  c.manaLock(u)
}
passives.da_18_kobuko = (c, u) => c.pre(u, (c, u, a) => {
  if (!u.n.bash) return
  u.n.bash = 0
  c.manaUnlock(u)
  a.skip = true
  c.hit(u, a.target, c.byAp(u, u.v.bash) + u.v.bashHp * u.maxHp, MAGIC)
})

passives.da_18_leona = (c, u) => {
  const r = c.byAp(u, u.v.resists)
  c.buff(u, S.armor, r, u.v.decay, true)
  c.buff(u, S.mr, r, u.v.decay, true)
}
casts.da_18_leona = (c, u, t) => {
  c.hit(u, t, c.armor(u) * u.v.dmgArmor, MAGIC)
  c.stun(u, t, u.v.stun)
}

casts.da_18_ornn = (c, u, t) => {
  c.shield(u, u, c.byAp(u, u.v.shield), u.v.shieldTime)
  for (const e of c.cone(u.cell, t.cell, foe(u), 2)) c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC)
}

// Pebbles burns through her mana bar while the laser lasts
casts.da_18_sentry = (c, u, t) => {
  const seconds = 1 / Math.max(0.05, u.v.drain), token = c.lock(u, seconds, true)
  let done = 0
  c.every(1, () => {
    if (u.channel !== token) return false
    const target = aim(c, u, t), span = Math.min(1, seconds - done)
    done += span
    if (target) {
      c.hit(u, target, c.byAp(u, u.v.dps) * span, MAGIC)
      target.mrDown += u.v.mrShred * span
    }
    if (u.n.alpha) { // Teal Buff: mana regen for every 4 seconds channeled
      u.n.channeled = (u.n.channeled ?? 0) + span
      while (u.n.channeled >= 4) { u.n.channeled -= 4; u.manaRegen += u.v.alphaRegen }
    }
    if (done >= seconds - 1e-6) { u.n.channeling = 0; return false }
  }, u, Math.min(1, seconds))
}

casts.da_18_rakan = (c, u) => {
  c.shield(u, u, c.byAp(u, u.v.shield), u.v.shieldTime)
  let best: Body | null = null
  for (const a of c.allies(u, false)) if (!best || a.dealt > best.dealt) best = a
  if (best) c.buff(best, S.as, c.byAp(u, u.v.as_), u.v.asTime, true, `rakan${u.i}`)
}

passives.da_18_reksai = (c, u) => c.every(1, () => {
  const k = c.now < (u.n.boost ?? 0) ? 3 : 1
  c.heal(u, u, (u.v.regen + u.v.regenHp * u.maxHp) * k)
}, u)
casts.da_18_reksai = (c, u) => {
  u.n.boost = c.now + u.v.boost
  for (const e of c.around(u.cell, 1, foe(u))) { c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC); c.stun(u, e, u.v.stun) }
}

casts.da_18_varus = (c, u, t) => {
  c.lock(u, 0.75)
  c.after(0.4, () => {
    const target = aim(c, u, t)
    if (target) pierce(c, u, c.bestLine(u, target), c.scale(u, u.v.dmgAd, u.v.dmgAp), u.v.falloff, u.v.floor)
  }, u)
}

casts.da_18_veigar = (c, u, t) => {
  const low = c.hpShare(t) < u.v.threshold
  c.hit(u, t, c.byAp(u, low ? u.v.lowDmg : u.v.dmg), MAGIC)
  if (!t.alive) u.ap += u.v.apOnKill * 100
}

casts.da_18_xayah = (c, u) => {
  if (!(u.n.feathers > 0)) u.asPct += u.v.as_
  u.n.feathers = u.v.attacks
  c.manaLock(u)
}
passives.da_18_xayah = (c, u) => c.pre(u, (c, u, a) => {
  if (!(u.n.feathers > 0)) return
  a.skip = true
  c.event(EV.hit, u, a.target)
  c.deal(u, a.target, c.scale(u, u.v.feather) * (a.crit ? u.critDmg : 1), PHYS, F.attack | (a.crit ? F.crit : 0))
  a.target.armorDown += c.byAp(u, u.v.shred)
  if (--u.n.feathers === 0) { u.asPct -= u.v.as_; c.manaUnlock(u) }
})

passives.da_18_yorick = (c, u) => c.onDeath(u, (c, u) => {
  const hp = (u.v.spirit + u.v.spiritHp * u.maxHp) * (1 + summonerBonus(c, u.side, 'yorick'))
  const b = c.spawn(u, { name: 'Spirit Walker', icon: c.summons.spirit, size: 0.8, cell: u.cell, hp, ad: u.adBase, as: 0.7, armor: u.f?.armor ?? 30, mr: u.f?.mr ?? 30, range: 1 })
  if (b) c.taunt(b, 3, 3)
})
casts.da_18_yorick = (c, u, t) => {
  c.heal(u, u, c.byAp(u, u.v.heal))
  c.hit(u, t, c.scale(u, u.v.dmgAd), PHYS)
}

/* ── 2 cost ────────────────────────────────────────────── */

casts.da_18_alistar = (c, u, t) => {
  c.heal(u, u, c.byAp(u, u.v.heal) + u.v.healHp * u.maxHp)
  c.cleanse(u)
  for (const a of c.allies(u, false).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, 2)) c.heal(u, a, c.byAp(u, u.v.allyHeal))
  c.hit(u, t, c.byAp(u, u.v.dmg), MAGIC)
  c.stun(u, t, u.v.stun)
}

// Every third attack is a Headshot
passives.da_18_caitlyn = (c, u) => c.pre(u, (c, u, a) => {
  if (u.attacks % Math.max(1, Math.round(u.v.every)) !== 0) return
  a.skip = true
  counted(c, u)
  c.hit(u, a.target, c.scale(u, u.v.dmgAd, u.v.dmgAp), PHYS)
})

casts.da_18_elise = (c, u) => {
  if (!u.n.spider) {
    u.n.spider = 1
    c.growHp(u, u.v.spiderHp)
    c.form(u, c.summons.spider)
  } else { c.buff(u, S.as, u.v.as_, u.v.asTime, true, 'cast-as'); c.manaLock(u, u.v.asTime) }
}
passives.da_18_elise = (c, u) => c.onHit(u, (c, u, t) => {
  if (!u.n.spider) return
  bonus(c, u, t, c.byAp(u, u.v.dmg))
  c.heal(u, u, c.byAp(u, u.v.heal))
})

casts.da_gromp18_ap = (c, u, t) => {
  c.hit(u, t, c.byAp(u, u.v.dmg), MAGIC)
  if (c.apMode(u)) for (const e of c.around(t.cell, 1, foe(u))) c.dot(u, e, c.byAp(u, u.v.area), u.v.areaTime, MAGIC)
  else c.chill(t, u.v.slow, u.v.slowTime)
}
passives.da_gromp18_ap = (c, u) => { if (u.n.alpha) c.every(5, () => { u.ap += u.v.alphaAp * 100 }, u) } // Purple Buff

// Kayle ascends with her stars: bonus magic damage, then shred, then waves through the target
passives.da_18_kayle = (c, u) => c.onHit(u, (c, u, t) => {
  bonus(c, u, t, c.byAp(u, u.v.dmg))
  if (u.star >= 2) c.shredIt(t, u.v.shred, u.v.shredTime)
  if (u.star >= 3) for (const e of c.line(u.cell, t.cell, foe(u))) if (e !== t) bonus(c, u, e, c.byAp(u, u.v.wave))
})

casts.da_18_leblanc = (c, u, t) => {
  c.hit(u, t, c.byAp(u, u.v.dmg), MAGIC)
  for (const e of c.around(t.cell, 1, foe(u))) if (e !== t) c.hit(u, e, c.byAp(u, u.v.splash), MAGIC)
}

casts.da_murkwolf18 = (c, u, t) => {
  const target = c.lowest(within(c, u, 3)) ?? t
  c.leap(u, target)
  retarget(c, u, target)
  c.hit(u, target, c.scale(u, u.v.dmgAd, u.v.dmgAp), PHYS)
  if (!(u.n.claws > 0)) u.asPct += u.v.as_
  u.n.claws = 2
  c.manaLock(u)
}
passives.da_murkwolf18 = (c, u) => {
  c.pre(u, (c, u, a) => { if (u.n.claws > 0) a.dmg += c.scale(u, u.v.empowered) })
  c.onHit(u, (c, u) => { if (u.n.claws > 0 && --u.n.claws === 0) { u.asPct -= u.v.as_; c.manaUnlock(u) } })
  if (u.n.alpha) { // Grey Buff: Precision, and more crit the more health it has lost
    u.precision++
    const base = u.crit
    c.every(0.25, () => { u.crit = base + u.v.alphaCrit + (u.v.alphaCritMax - u.v.alphaCrit) * (1 - c.hpShare(u)) }, u, 0.05)
  }
}

// Scuttlecrab's attacks are a dance that hits everything next to it
passives.da_scuttlecrab18 = (c, u) => {
  c.pre(u, (c, u, a) => {
    a.skip = true
    const dmg = c.scale(u, u.v.dance) * (a.crit ? u.critDmg : 1)
    for (const e of c.around(u.cell, 1, foe(u))) c.deal(u, e, dmg, PHYS, F.attack | (a.crit ? F.crit : 0))
  })
  if (u.n.alpha) for (const a of boardUnits(c, u.side)) c.onBelow(a, 0.5, (c, a) => c.heal(u, a, a.maxHp * u.v.alphaHeal)) // Green Buff
}
casts.da_scuttlecrab18 = (c, u) => {
  c.buff(u, S.dur, u.v.durability, u.v.burrow, false, 'cast-dur')
  c.manaLock(u, u.v.burrow)
  const total = c.byAp(u, u.v.heal)
  spread(c, u, u.v.burrow, 6, () => c.heal(u, u, total / 6))
}

casts.da_18_sejuani = (c, u, t) => {
  c.shield(u, u, c.byAp(u, u.v.shield) + u.v.shieldHp * u.maxHp, u.v.shieldTime)
  for (const e of c.cone(u.cell, t.cell, foe(u), 2)) c.hit(u, e, c.byAp(u, u.v.cone), MAGIC)
  for (const e of c.line(u.cell, t.cell, foe(u), 0.62, 3.2)) c.hit(u, e, c.byAp(u, u.v.line), MAGIC)
}

casts.da_18_shen = (c, u) => {
  c.shield(u, u, c.byAp(u, u.v.shield), u.v.shieldTime)
  const others = c.allies(u, false)
  const ally = c.lowest(others.filter((a) => a.hp < a.maxHp && c.dist(u, a) <= 3), true) ?? c.nearest(others, u.cell)
  if (ally) c.shield(u, ally, c.byAp(u, u.v.allyShield), u.v.shieldTime)
  for (const b of ally ? [u, ally] : [u]) empower(c, b, 3, u.v.as_, c.byAp(u, u.v.dmg), b === u)
}

casts.da_18_teemo = (c, u, t) => {
  const near = c.byDistance(c.enemies(u), u.cell).slice(0, 3)
  for (let k = 0; k < 2; k++) for (const e of near) c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC)
  if (t.alive) c.hit(u, t, c.byAp(u, u.v.giant), MAGIC)
}

casts.da_18_warwick = (c, u, t) => {
  const dealt = c.hit(u, t, c.scale(u, u.v.dmgAd), PHYS)
  c.heal(u, u, dealt * c.byAp(u, u.v.heal))
  u.asPct += u.v.as_
}

casts.da_18_yunara = (c, u, t) => {
  c.blinkAway(u, t, 1)
  const dmg = c.scale(u, u.v.dmgAd, u.v.dmgAp)
  c.hit(u, t, dmg, PHYS)
  for (const e of c.byDistance(c.enemies(u).filter((e) => e !== t), t.cell).slice(0, u.v.splits)) c.hit(u, e, dmg * u.v.split, PHYS)
}

/* ── 3 cost ────────────────────────────────────────────── */

// Azir's next attacks are commands: each soldier strikes the target
casts.da_18_azir = (c, u) => {
  if (!(u.n.commands > 0)) u.asPct += u.v.as_
  u.n.commands = u.v.attacks
  c.manaLock(u)
}
passives.da_18_azir = (c, u) => {
  c.pre(u, (c, u, a) => {
    if (!(u.n.commands > 0)) return
    a.skip = true
    const dmg = c.byAp(u, u.v.dmg) * (1 + summonerBonus(c, u.side, 'azir'))
    for (let k = 0; k < u.v.soldiers; k++) c.hit(u, a.target, dmg, MAGIC)
  })
  c.onHit(u, (c, u) => { if (u.n.commands > 0 && --u.n.commands === 0) { u.asPct -= u.v.as_; c.manaUnlock(u) } })
}

casts.da_18_cassiopeia = (c, u, t) => {
  const poisoned = (b: Body) => b.dots.some((d) => d.tag === 'cassiopeia' && d.until > c.now)
  const second = c.nearest(c.enemies(u).filter((e) => e !== t && !poisoned(e)), t.cell)
  for (const e of second ? [t, second] : [t]) {
    c.event(EV.hit, u, e)
    c.dot(u, e, c.byAp(u, u.v.dmg), u.v.time, MAGIC, 'cassiopeia')
  }
}

casts.da_18_diana = (c, u, t) => {
  c.shield(u, u, u.v.shield, u.v.shieldTime)
  const near = c.around(u.cell, 2, foe(u)), list = near.length ? near : [t]
  for (let k = 0; k < u.v.orbs; k++) { const e = list[k % list.length]; if (e.alive) c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC) }
}

casts.da_fiddlesticks18 = (c, u) => {
  const near = c.byDistance(c.enemies(u), u.cell).slice(0, 3)
  for (const e of near) e.mrDown += u.v.mr
  const token = c.lock(u, u.v.time, true), ticks = 4
  spread(c, u, u.v.time, ticks, (k) => {
    for (const e of near) if (e.alive) c.hit(u, e, c.byAp(u, u.v.dmg) / ticks, MAGIC)
    c.heal(u, u, c.byAp(u, u.v.heal) / ticks)
    if (k === ticks) u.n.channeling = 0
  }, token)
}

casts.da_18_hecarim = (c, u) => {
  c.manaLock(u, 3)
  c.buff(u, S.armor, u.v.resists, 3, false, 'cast-armor')
  c.buff(u, S.mr, u.v.resists, 3, false, 'cast-mr')
  const heal = c.byAp(u, u.v.heal)
  spread(c, u, 3, 6, () => c.heal(u, u, heal / 6))
  for (const e of c.byDistance(c.enemies(u), u.cell).slice(0, 3)) { c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC); c.stun(u, e, u.v.stun) }
}

casts.da_18_khazix = (c, u, t) => {
  const target = c.farthest(within(c, u, 3), u.cell) ?? t
  c.leap(u, target)
  retarget(c, u, target)
  const alone = !c.allies(target, false, true).some((a) => c.dist(a, target) <= 1)
  c.hit(u, target, c.byAp(u, alone ? u.v.isolated : u.v.dmg), MAGIC)
  if (alone) u.mana += u.v.mana
}

casts.da_kogmaw18_ad = (c, u, t) => {
  const other = c.nearest(c.enemies(u).filter((e) => e !== t), t.cell)
  for (const e of other ? [t, other] : [t]) {
    let dmg = c.scale(u, u.v.dmgAd, u.v.dmgAp)
    if (c.hpShare(e) < 0.5) dmg *= u.v.lowMult
    if (c.apMode(u)) { c.event(EV.hit, u, e); c.dot(u, e, dmg, u.v.dotTime, MAGIC) }
    else c.hit(u, e, dmg, PHYS)
  }
}

// Krug splits into two Kruglettes when it dies, and they taunt
passives.da_krug18 = (c, u) => {
  const slate = (from: Body) => { for (const a of c.allies(from, false)) c.shield(from, a, a.maxHp * u.v.alphaShield, 4) }
  c.onDeath(u, (c, u) => {
    const hp = u.v.kruglette + u.v.krugletteHp * u.maxHp
    for (let k = 0; k < 2; k++) {
      const b = c.spawn(u, { name: 'Kruglette', icon: c.summons.kruglette, size: 0.66, cell: k ? c.freeNear(u.cell, 2) : u.cell, hp, ad: u.adBase * 0.5, as: u.asBase, armor: u.f?.armor ?? 40, mr: u.f?.mr ?? 40, range: 1 })
      if (!b) continue
      c.taunt(b, 2, 2.5)
      if (u.n.alpha) c.onDeath(b, (c, b) => slate(b))
    }
    if (u.n.alpha) slate(u) // Slate Buff
  })
}
casts.da_krug18 = (c, u, t) => {
  c.growHp(u, c.byAp(u, u.v.bonusHp))
  c.hit(u, t, c.scale(u, u.v.dmgAd, 0, u.v.dmgHp), PHYS)
}

// Mama Beak's Tiny Beaks attack whatever she attacks
casts.da_crimsonraptor18 = (c, u) => {
  const time = c.byAp(u, u.v.time)
  u.n.beaksUntil = c.now + time
  c.manaLock(u, Math.max(0, time - 1))
  const beaks: Body[] = []
  for (let k = 0; k < u.v.beaks; k++) {
    const b = c.spawn(u, { name: 'Tiny Beak', icon: c.summons.beak, size: 0.42, cell: c.freeNear(u.cell, 2), hp: 1, ad: 0, as: 0, armor: 0, mr: 0, range: 0, ghost: true, immobile: true, duration: time })
    if (b) { b.cell = b.cell < 0 ? u.cell : b.cell; b.inert = true; beaks.push(b) }
  }
  ;(u.refs ??= {}).beaks = beaks
}
passives.da_crimsonraptor18 = (c, u) => {
  c.onHit(u, (c, u, t) => {
    if (!(c.now < (u.n.beaksUntil ?? 0)) || !t.alive) return
    const dmg = c.scale(u, u.v.dmgAd) * (1 + summonerBonus(c, u.side, 'beak'))
    const beaks = ((u.refs?.beaks as Body[] | undefined) ?? []).filter((b) => b.alive)
    for (let k = 0; k < u.v.beaks && t.alive; k++) {
      const from = beaks[k] ?? u
      c.event(EV.attack, from, t)
      c.deal(u, t, dmg, PHYS, 0)
    }
  })
  if (u.n.alpha) c.onDeal(u, (c, u, t, dmg, flags, type) => { if (type === PHYS) t.armorDown += u.v.alphaArmor }) // Orange Buff
}

// Every third attack is a Double Strike, each one stacking attack speed
passives.da_18_masteryi_ad = (c, u) => c.onHit(u, (c, u, t) => {
  if (u.attacks % Math.max(1, Math.round(u.v.every)) !== 0) return
  counted(c, u)
  if (t.alive) { const crit = c.R() < c.critChance(u); c.deal(u, t, c.ad(u) * (crit ? u.critDmg : 1), PHYS, F.attack | (crit ? F.crit : 0)) }
  u.asPct += u.v.as_ + c.byAp(u, u.v.asAp)
})

casts.da_18_rammus = (c, u) => {
  c.taunt(u, 2, u.v.time)
  c.manaLock(u, u.v.time)
  c.buff(u, S.armor, u.v.resists, u.v.time, false, 'cast-armor')
  c.buff(u, S.mr, u.v.resists, u.v.time, false, 'cast-mr')
  c.shield(u, u, c.byAp(u, u.v.shield), u.v.time, (c, u) => {
    const dmg = (c.armor(u) + c.mr(u)) * u.v.dmgRes
    for (const e of c.around(u.cell, 2, foe(u))) c.hit(u, e, dmg, PHYS)
  })
}

casts.da_18_rengar = (c, u, t) => {
  const target = c.lowest(within(c, u, 3), true) ?? t
  c.leap(u, target)
  retarget(c, u, target)
  c.hit(u, target, c.scale(u, u.v.dmgAd), PHYS)
  const missing = 1 - c.hpShare(target)
  c.heal(u, u, c.byAp(u, u.v.heal + (u.v.healMax - u.v.heal) * missing))
}

// Tristana's charge: infinite range and attack speed, then an explosion that grows with every attack
casts.da_18_tristana = (c, u, t) => {
  const as = u.v.as_ + c.byAp(u, u.v.asAp), range = u.range
  u.asPct += as
  u.range = 10
  u.n.charging = 1
  u.n.charge = 0
  c.manaLock(u, u.v.time)
  const last = { cell: t.cell }
  ;(u.refs ??= {}).charge = last
  c.after(u.v.time, () => {
    u.asPct -= as
    u.range = range
    u.n.charging = 0
    const center = t.alive ? t.cell : last.cell, hits = c.around(center, 2, foe(u))
    const total = c.scale(u, u.v.dmgAd + u.v.perAttack * u.n.charge)
    for (const e of hits) c.hit(u, e, total / hits.length, PHYS)
  })
}
passives.da_18_tristana = (c, u) => c.onHit(u, (c, u, t) => {
  if (!u.n.charging) return
  u.n.charge++
  const last = u.refs?.charge as { cell: number } | undefined
  if (last && t.alive) last.cell = t.cell
})

passives.da_vi18 = (c, u) => c.onHit(u, (c, u) => { c.heal(u, u, u.v.onHit * u.maxHp) })
casts.da_vi18 = (c, u) => {
  c.heal(u, u, c.byAp(u, u.v.heal))
  c.cleanse(u)
  c.buff(u, S.as, u.v.as_, u.v.time, false, 'cast-as')
  c.buff(u, S.dur, u.v.durability, u.v.time, false, 'cast-dur')
  u.unstoppableUntil = Math.max(u.unstoppableUntil, c.now + u.v.time)
  c.manaLock(u, u.v.time)
}

/* ── 4 cost ────────────────────────────────────────────── */

casts.da_18_ahri = (c, u) => {
  const foes = c.enemies(u), r = u.v.radius
  let center = u.target?.cell ?? u.cell, best = -1, ties = 0
  for (let cell = 0; cell < 56; cell++) {
    if (c.dist(u.cell, cell) > u.v.reach) continue
    let score = 0
    for (const e of foes) { const d = c.dist(cell, e); if (d <= r) score += Math.max(0, 1 - u.v.falloff * d) }
    if (score > best + 1e-9) { best = score; center = cell; ties = 1 }
    else if (Math.abs(score - best) <= 1e-9 && c.R() * ++ties < 1) center = cell
  }
  c.after(0.4, () => { for (const e of c.around(center, r, foe(u))) c.hit(u, e, c.byAp(u, u.v.dmg) * Math.max(0, 1 - u.v.falloff * c.dist(center, e)), MAGIC) }, u)
}

passives.da_amumu18 = (c, u) => c.every(1, () => {
  c.heal(u, u, c.byAp(u, u.v.regen) + u.v.regenHp * u.maxHp)
  for (const e of c.around(u.cell, 1, foe(u))) c.deal(u, e, c.byAp(u, u.v.aura), MAGIC, F.ability | F.nocrit)
}, u)
casts.da_amumu18 = (c, u) => {
  for (const e of c.around(u.cell, 2, foe(u))) {
    const extra = burning(c, e) ? u.v.burnStun : 0
    c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC)
    c.stun(u, e, u.v.stun + extra)
  }
}

// One more swipe per 20% bonus attack speed, then a blast split around the target
casts.da_18_aphelios = (c, u, t) => {
  const swipes = Math.max(1, Math.round(u.v.swipes) + Math.floor(Math.max(0, u.asPct + u.t[S.as]) / 0.2 + 1e-9))
  const token = c.lock(u, 2, true)
  spread(c, u, 2, swipes, (k) => {
    const target = aim(c, u, t)
    if (!target) return
    c.hit(u, target, c.scale(u, u.v.swipe), PHYS)
    if (k < swipes) return
    u.n.channeling = 0
    const hits = c.around(target.cell, 2, foe(u)), total = c.scale(u, u.v.blastAd, u.v.blastAp)
    for (const e of hits) c.hit(u, e, total / hits.length, PHYS)
  }, token)
}

casts.da_brambleback18 = (c, u) => {
  c.manaLock(u, u.v.time)
  c.buff(u, S.ad, u.v.adBonus, u.v.time, false, 'cast-ad')
  c.buff(u, S.ignore, u.v.ignore + c.byAp(u, u.v.ignoreAp), u.v.time, false, 'cast-ignore')
}
passives.da_brambleback18 = (c, u) => {
  // When its target dies, it leaps at the next one
  c.anyDeath((c, dead) => {
    if (!u.alive || dead !== u.target || dead.side === u.side) return
    const next = c.nearestEnemy(u)
    if (!next) return
    c.leap(u, next)
    retarget(c, u, next)
    c.hit(u, next, c.scale(u, u.v.leap), PHYS)
  })
  if (u.n.alpha) c.onHit(u, (c, u, t) => { if (t.alive) c.burn(u, t, u.v.alphaBurn, 3); c.heal(u, u, u.v.alphaHeal * u.maxHp) }) // Red Buff
}

casts.da_18_ezreal = (c, u, t) => {
  u.n.count = (u.n.count ?? 0) + 1
  c.blinkAway(u, t, 2)
  c.hit(u, t, c.scale(u, u.v.dmgAd), PHYS)
  if (u.n.count % 4 === 0) {
    u.asPct -= u.n.wrath ?? 0
    u.n.wrath = 0
    pierce(c, u, c.bestLine(u), c.scale(u, u.v.blast), u.v.falloff, u.v.floor)
  } else {
    const as = c.byAp(u, u.v.as_)
    u.asPct += as
    u.n.wrath = (u.n.wrath ?? 0) + as
  }
}

casts.da_18_lillia = (c, u) => {
  c.heal(u, u, c.byAp(u, u.v.heal))
  for (const e of c.byDistance(c.enemies(u), u.cell).slice(0, u.v.butterflies)) {
    c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC)
    c.sleep(e, u.v.sleep, u.v.wake, (c, e) => { c.deal(u, e, e.maxHp * u.v.wakeHp, MAGIC, F.ability | F.quiet) })
  }
}

casts.da_18_malphite = (c, u) => {
  u.unstoppableUntil = Math.max(u.unstoppableUntil, c.now + u.v.shieldTime)
  c.shield(u, u, c.byAp(u, u.v.shield), u.v.shieldTime, (c, u) => {
    u.unstoppableUntil = c.now
    const dmg = c.byAp(u, u.v.dmg) + (c.armor(u) + c.mr(u)) * u.v.dmgRes
    for (const e of c.around(u.cell, u.v.radius, foe(u))) c.hit(u, e, dmg, MAGIC)
  })
}

passives.da_18_morgana = (c, u) => { u.vamp += u.v.omnivamp }
casts.da_18_morgana = (c, u, t) => {
  const curses = (e: Body) => (c.now < (e.n.curseUntil ?? 0) ? (e.n.curses ?? 0) : 0)
  for (const e of c.byDistance(c.enemies(u), u.cell).slice(0, u.v.targets)) {
    c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC)
    e.n.curses = curses(e) + 1
    e.n.curseUntil = c.now + u.v.time
  }
  const center = t.alive ? t.cell : u.cell
  let left = u.v.time
  c.every(1, () => {
    for (const e of c.around(center, 2, foe(u))) c.hit(u, e, c.byAp(u, u.v.zone) + c.byAp(u, u.v.curse) * curses(e), MAGIC, F.nocrit)
    return --left > 0
  })
}

// Javelins: the last one flies at the farthest enemy with the fewest items
casts.da_nidalee18_ap = (c, u) => {
  if (!(u.n.javelins > 0)) u.asPct += u.v.as_
  u.n.javelins = u.v.attacks
  c.manaLock(u)
}
passives.da_nidalee18_ap = (c, u) => {
  c.pre(u, (c, u, a) => {
    if (!(u.n.javelins > 0)) return
    a.skip = true
    if (u.n.javelins === 1) {
      const foes = c.enemies(u), fewest = Math.min(...foes.map((e) => e.f?.items.length ?? 0))
      const target = c.farthest(foes.filter((e) => (e.f?.items.length ?? 0) === fewest), u.cell) ?? a.target
      c.hit(u, target, c.byAp(u, u.v.final), MAGIC)
    } else c.hit(u, a.target, c.byAp(u, u.v.dmg), MAGIC)
  })
  c.onHit(u, (c, u) => { if (u.n.javelins > 0 && --u.n.javelins === 0) { u.asPct -= u.v.as_; c.manaUnlock(u) } })
}

casts.da_sentinel18 = (c, u) => {
  c.shield(u, u, c.byAp(u, u.v.shield) + u.v.shieldHp * u.maxHp, u.v.shieldTime)
  for (const e of c.bestLine(u).filter((e) => c.dist(u, e) <= 5)) {
    c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC)
    c.stun(u, e, 0.5)
    if (e.maxMana > 0) e.reave += u.v.reave
  }
  if (u.n.alpha) for (const a of c.allies(u)) a.manaRegen += u.v.alphaRegen // Blue Buff
}

passives.da_18_sett = (c, u) => c.onBelow(u, u.v.threshold, (c, u) => { u.mana = Math.min(u.maxMana, u.mana + 100) })
casts.da_18_sett = (c, u, t) => {
  c.lock(u, 0.75)
  c.heal(u, u, c.byAp(u, u.v.heal) + u.v.healHp * u.maxHp)
  const toward = t.cell
  c.after(0.5, () => { for (const e of c.cone(u.cell, toward, foe(u), 3, 0.4)) c.hit(u, e, c.scale(u, u.v.dmgAd, 0, u.v.dmgHp), PHYS) }, u)
}

casts.da_18_sivir = (c, u, t) => {
  const main = c.scale(u, u.v.dmgAd, u.v.dmgAp)
  let left = u.v.bounces, at = t, guard = 40
  c.hit(u, t, main, PHYS)
  if (!t.alive) left += u.v.killBounces
  while (left > 0 && guard-- > 0) {
    const from = at
    const next = c.nearest(c.enemies(u).filter((e) => e !== from && c.dist(from, e) <= 3), from.cell)
    if (!next) break
    left--
    c.hit(u, next, main * u.v.bounce, PHYS)
    if (!next.alive) left += u.v.killBounces
    at = next
  }
}

casts.da_18_soraka = (c, u, t) => {
  const fallen = (t.n.starred ?? 0) > 0
  c.hit(u, t, c.byAp(u, u.v.dmg), MAGIC)
  if (fallen) for (let k = 0; k < u.v.stars && t.alive; k++) c.hit(u, t, c.byAp(u, u.v.extra), MAGIC)
  t.n.starred = 1
}

// Zyra's plants spring up near the enemies and attack a set number of times
casts.da_18_zyra = (c, u, t) => {
  const attacks = Math.round(u.v.attacks + summonerBonus(c, u.side, 'zyra'))
  const dmg = c.byAp(u, u.v.dmg)
  for (let k = 0; k < u.v.plants; k++) {
    const near = pick(c, c.enemies(u)) ?? t
    const ring: number[] = []
    for (let cell = 0; cell < 56; cell++) { const d = c.dist(cell, near.cell); if (d >= 1 && d <= 2 && c.occ[cell] < 0) ring.push(cell) }
    const cell = pick(c, ring) ?? near.cell
    const p = c.spawn(u, { name: 'Zyra plant', icon: c.summons.plant, size: 0.5, cell, hp: 1, ad: 0, as: u.asBase || 0.75, armor: 0, mr: 0, range: 3, ghost: true, immobile: true, duration: 12 })
    if (!p) continue
    p.n.left = attacks
    p.n.plant = 1
    c.pre(p, (c, p, a) => { a.skip = true; c.deal(u, a.target, dmg, MAGIC, F.ability) })
    c.onHit(p, (c, p) => { if (--p.n.left <= 0) c.expire(p) })
  }
}

/* ── 5 cost ────────────────────────────────────────────── */

// The moon waxes with each cast; full, it crashes down on every enemy
casts.da_18_alune = (c, u) => {
  const phase = u.n.moon ?? 0
  if (phase >= 4) {
    u.n.moon = 0
    const foes = c.enemies(u)
    for (const e of foes) c.hit(u, e, c.byAp(u, u.v.moon) / foes.length, MAGIC)
    return
  }
  u.n.moon = phase + 1
  const near = c.byDistance(c.enemies(u), u.cell).slice(0, u.v.targets)
  for (let k = 0; k < u.v.shards && near.length; k++) { const e = near[k % near.length]; if (e.alive) c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC) }
}

casts.da_18_ashe = (c, u, t) => {
  const line = c.bestLine(u)
  const end = line[line.length - 1] ?? t
  pierce(c, u, line, c.scale(u, u.v.dmgAd), u.v.falloff, u.v.floor)
  const cells = new Set(c.lineCells(u.cell, end.cell))
  let left = Math.round(u.v.trail * 2)
  c.every(0.5, () => {
    for (const e of c.side(foe(u))) {
      if (!cells.has(e.cell)) continue
      c.deal(u, e, (c.scale(u, u.v.trailAd, u.v.trailAp) + u.v.trailHp * e.maxHp) * 0.5, PHYS, F.ability | F.nocrit)
      c.chill(e, u.v.slow, 0.6)
    }
    return --left > 0
  })
}

// Draven: attacks fly at random enemies in range and make them bleed; the axes cash the bleeds in
passives.da_draven18 = (c, u) => {
  c.pre(u, (c, u, a) => {
    const near = within(c, u, u.range)
    if (near.length) a.target = pick(c, near)!
    u.n.spin = c.R() < c.byAp(u, u.v.spin) ? 1 : 0
    if (u.n.spin) a.dmg *= 1 + u.v.spinBonus
  })
  c.onHit(u, (c, u, t) => {
    if (!t.alive) return
    for (let k = 0; k < (u.n.spin ? 2 : 1); k++) c.dot(u, t, c.scale(u, u.v.bleed), 12, PHYS, 'draven')
  })
}
casts.da_draven18 = (c, u) => {
  const bleeds = (e: Body) => e.dots.filter((d) => d.tag === 'draven' && d.until > c.now).length
  const foes = c.enemies(u)
  const target = foes.reduce<Body | null>((a, b) => (!a || bleeds(b) > bleeds(a) ? b : a), null)
  if (!target) return
  const line = c.line(u.cell, target.cell, foe(u))
  for (const e of line) {
    for (let axe = 0; axe < 2; axe++) c.hit(u, e, c.scale(u, u.v.axe), PHYS)
    let rest = 0
    e.dots = e.dots.filter((d) => {
      if (d.tag !== 'draven') return true
      rest += d.rate * Math.max(0, d.until - c.now)
      return false
    })
    if (rest > 0) c.deal(u, e, rest, PHYS, F.ability | F.nocrit)
  }
  const toward = target.cell
  c.after(0.6, () => { for (const e of c.line(u.cell, toward, foe(u))) for (let axe = 0; axe < 2; axe++) c.hit(u, e, c.scale(u, u.v.back), PHYS) }, u)
}

const ignite = (c: Fight, u: Body, e: Body) => c.dot(u, e, e.maxHp * u.v.ignite * u.v.igniteTime, u.v.igniteTime, PHYS, 'ignite')
const flameBreath: Cast = (c, u, t) => {
  const target = aim(c, u, t)
  if (target) pierce(c, u, c.bestLine(u, target), c.scale(u, u.v.breathAd, u.v.breathAp), u.v.falloff, u.v.floor, PHYS, (e) => ignite(c, u, e))
}
passives.da_18_elderdragon = (c, u) => {
  c.onHit(u, (c, u, t, a) => { for (const e of c.around(t.cell, 1, foe(u))) if (e !== t) bonus(c, u, e, a.dmg * u.v.splash, PHYS) })
  if (u.n.alpha) u.execute = Math.max(u.execute, u.v.alphaExecute) // Elder Dragon Buff
}
// It takes to the air (invulnerable), lands stunning and igniting every enemy, then breathes fire from then on
casts.da_18_elderdragon = (c, u) => {
  u.ability = flameBreath
  const fly = 1.25
  u.invulnUntil = c.now + fly
  u.untargetableUntil = c.now + fly
  c.lock(u, fly)
  c.after(fly, () => {
    for (const e of c.enemies(u)) { c.stun(u, e, u.v.stun); ignite(c, u, e) }
    u.vamp += u.v.omnivamp
    flameBreath(c, u, u.target ?? u)
  }, u)
}

// Gnar fills with rage, turns into Mega Gnar and from then on throws enemies
const grabAndThrow: Cast = (c, u, t) => {
  const foes = c.enemies(u)
  if (foes.length === 1) { c.event(EV.hit, u, t); c.kill(t, u); return } // the last one goes off the battlefield
  const far = c.farthest(foes.filter((e) => e !== t), t.cell)
  if (!far) return
  for (const e of c.line(t.cell, far.cell, foe(u))) if (e !== t) c.hit(u, e, c.scale(u, u.v.tossPass), PHYS)
  c.hit(u, t, c.scale(u, u.v.toss), PHYS)
  if (t.alive) c.moveTo(t, c.freeNear(far.cell, 1))
}
passives.da_18_gnarsmall = (c, u) => {
  c.every(1, () => { u.mana = Math.min(u.maxMana, u.mana + u.v.rate) }, u)
  c.onHit(u, (c, u) => { u.mana = Math.min(u.maxMana, u.mana + u.v.perAttack) })
}
casts.da_18_gnarsmall = (c, u) => {
  u.ability = grabAndThrow
  const spot = c.freeNear(c.bestCell(u, 2, 3), 2)
  if (spot >= 0) c.moveTo(u, spot)
  for (const e of c.around(u.cell, u.v.radius, foe(u))) {
    c.hit(u, e, c.scale(u, u.v.leap), PHYS)
    const cut = c.byAp(u, u.v.shred)
    e.armorDown += cut
    e.mrDown += cut
    c.stun(u, e, u.v.stun)
  }
  c.growHp(u, u.v.megaHp)
}

casts.da_18_ivern = (c, u) => {
  u.n.count = (u.n.count ?? 0) + 1
  const grown = u.n.count >= u.v.casts
  // Shields scale with his damage amp and can crit with Precision
  const crit = u.precision > 0 && c.R() < c.critChance(u) ? u.critDmg : 1
  const amount = c.byAp(u, u.v.shield) * (1 + u.amp + u.t[S.amp]) * crit
  for (const a of c.allies(u).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, u.v.allies)) {
    c.shield(u, a, amount, u.v.time)
    c.buff(a, S.amp, u.v.amp, u.v.time, false, `ivern${u.i}`)
    if (grown) a.asPct += u.v.as_
    for (const e of c.around(a.cell, 1, foe(u))) c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC)
  }
}

casts.da_18_kennen = (c, u, t) => {
  const boost = u.v.apPerBurn * c.enemies(u).filter((e) => burning(c, e)).length * 100
  u.ap += boost
  c.shield(u, u, c.byAp(u, u.v.shield), u.v.shieldTime)
  const spot = c.bestCell(u, 1, 3)
  const rushed = new Set([...c.line(u.cell, spot, foe(u), 0.62, Math.max(1, c.dist(u.cell, spot)) + 0.4), ...c.around(spot, 1, foe(u))])
  for (const e of rushed) c.hit(u, e, c.byAp(u, u.v.dmg), MAGIC)
  c.moveTo(u, c.freeNear(spot, 1))
  const total = c.byAp(u, u.v.storm), ticks = 4
  u.ap -= boost
  spread(c, u, u.v.stormTime, ticks, () => {
    const hits = c.around(u.cell, 2, foe(u))
    for (const e of hits) c.hit(u, e, total / ticks / hits.length, MAGIC, F.nocrit)
  })
  void t
}

// Lux: one laser for every Avatar, each with its trait's bonus
const lux = (extra?: (c: Fight, u: Body, e: Body, k: number, dealt: number) => void, after?: (c: Fight, u: Body) => void): Cast => (c, u) => {
  const mine = new Set(u.traits)
  for (const a of c.allies(u, false)) if (a.traits.some((x) => mine.has(x))) c.addMana(a, c.byAp(u, u.v.mana))
  let base = c.byAp(u, u.v.dmg)
  // Solar's Lux: bonus damage, more for each unique 3-star
  if (u.v.per3) base *= 1 + (u.v.solar ?? 0) + u.v.per3 * uniqueThreeStars(c, u.side)
  c.bestLine(u).forEach((e, k) => {
    const dmg = base * Math.max(u.v.floor ?? 0, 1 - u.v.falloff * k) * (k === 0 && u.v.first ? 1 + u.v.first : 1)
    const dealt = c.hit(u, e, dmg, MAGIC)
    extra?.(c, u, e, k, dealt)
  })
  after?.(c, u)
}
casts.da_lux18_base = lux()
casts.da_lux18_blackthorn = lux((c, u, e) => c.stun(u, e, u.v.stun))
casts.da_lux18_blossom = lux()
casts.da_18_lux_coven = lux((c, u, e) => { e.armorDown += u.v.resists; e.mrDown += u.v.resists })
casts.da_18_lux_elderwood = lux(undefined, (c, u) => { for (const a of c.allies(u)) c.growHp(a, a.maxHp * u.v.health) })
casts.da_18_lux_fae = lux((c, u, e, k, dealt) => { const a = c.lowest(c.allies(u), true); if (a) c.heal(u, a, dealt * u.v.heal) })
casts.da_18_lux_inferno = lux()
casts.da_18_lux_moonbeam = lux((c, u, e) => c.vulnerable(e, u.v.vulnerable, u.v.vulnerableTime))
casts.da_18_lux_primal = lux(undefined, (c, u) => { c.buff(u, S.as, u.v.as_, u.v.asTime, false, 'cast-as'); c.manaLock(u, u.v.asTime) })
casts.da_18_lux_sunbeam = lux()
passives.da_18_lux_inferno = (c, u) => c.anyDeath((c, dead, killer) => { if (u.alive && killer === u && dead.side !== u.side) u.mana = Math.min(u.maxMana, u.mana + u.v.takedown) })

// Maokai: saplings from damage blocked and from his death; Old Growth grows him as enemies near him die
const sapling = (c: Fight, u: Body) => {
  const e = pick(c, c.byDistance(c.enemies(u), u.cell).slice(0, 3))
  if (!e) return
  const dmg = u.v.sapling * u.maxHp
  c.after(0.6, () => { if (e.alive) c.hit(u, e, dmg, MAGIC) })
}
passives.da_18_maokai = (c, u) => {
  u.n.blocked = 0
  c.onTaken(u, (c, u, from, dmg, flags, type, blocked) => {
    u.n.blocked += blocked
    while (u.n.blocked >= u.v.blocked) { u.n.blocked -= u.v.blocked; sapling(c, u) }
  })
  c.onDeath(u, (c, u) => { for (let k = 0; k < u.v.onDeath; k++) sapling(c, u) })
  if (c.traits[u.side]['old-growth']) c.anyDeath((c, dead) => { if (u.alive && dead.side !== u.side && !dead.summon && c.dist(u, dead) <= u.v.growthRange) c.growHp(u, u.v.growthHp) })
}
casts.da_18_maokai = (c, u, t) => {
  c.hit(u, t, u.v.dmg * u.maxHp, MAGIC)
  c.heal(u, u, c.byAp(u, u.v.heal) + u.v.missing * (u.maxHp - u.hp))
}

// Taric and his paired ally: one burst of shields the first time either falls below half health, bonus damage on casts
passives.da_taric18 = (c, u) => {
  const pair = u.refs?.pair as Body | undefined
  const burst = () => {
    if (u.n.burst || !u.alive) return
    u.n.burst = 1
    const amount = u.v.shield + u.v.shieldHp * u.maxHp, got = new Set<Body>()
    for (const from of pair ? [u, pair] : [u]) if (from.alive) for (const a of c.allies(u)) if (c.dist(a, from) <= 3) got.add(a)
    for (const a of got) c.shield(u, a, amount, u.v.shieldTime)
  }
  c.onBelow(u, 0.5, burst)
  if (pair) c.onBelow(pair, 0.5, burst)
}
casts.da_taric18 = (c, u) => {
  c.heal(u, u, c.byAp(u, u.v.heal))
  const dmg = c.byAp(u, u.v.dmg), pair = u.refs?.pair as Body | undefined
  empower(c, u, 2, 0, dmg, true)
  if (pair?.alive) empower(c, pair, 2, 0, dmg)
}

/* ── Elderwood's plants ────────────────────────────────── */

const isElderwood = (b: Body) => b.traits.includes('elderwood') || !!b.f?.plant
passives.da_elderwood18_lifeblossom = (c, u) => {
  u.inert = true
  c.every(4, () => {
    const gain = u.n.grown ? u.v.more : u.v.first
    u.n.grown = 1
    for (const a of c.allies(u, false)) if (a.traits.includes('elderwood')) { a.adPct += gain; a.ap += gain * 100 }
  }, u)
}
passives.da_elderwood18_stonebarktree = (c, u) => {
  u.inert = true
  const wood = c.traits[u.side].elderwood
  if (wood?.v.treeHp) c.growHp(u, wood.v.treeHp)
  c.onDeath(u, (c, u) => { for (const e of c.byDistance(c.enemies(u), u.cell).slice(0, u.v.stuns)) c.stun(u, e, u.v.stun) })
}
passives.da_elderwood18_protector = (c, u) => c.anyDeath((c, dead) => {
  if (!u.alive || dead === u || dead.side !== u.side || !isElderwood(dead)) return
  c.heal(u, u, u.v.heal * u.maxHp)
  c.buff(u, S.as, u.v.as_, 3, false, 'protector-as')
})
casts.da_elderwood18_protector = (c, u, t) => {
  c.hit(u, t, c.byAp(u, u.v.dmg), MAGIC)
  for (const e of c.around(t.cell, 2, foe(u))) if (e !== t) c.hit(u, e, c.byAp(u, u.v.splash), MAGIC)
  c.stun(u, t, u.v.stun)
}

/* ── Items ─────────────────────────────────────────────── */

const struck = (flags: number) => (flags & (F.attack | F.ability)) !== 0

items['adaptive-helm'] = (c, u, v) => {
  u.manaMult *= 1 + v.manaMult
  if (u.role === 'tank' || u.role === 'fighter') { u.armor += v.resists; u.mr += v.resists }
  else { u.adPct += v.adap; u.ap += v.adap * 100 }
}
items['archangel-s-staff'] = (c, u, v) => c.every(v.period, () => { u.ap += v.ap }, u)
items.bloodthirster = (c, u, v) => c.onBelow(u, v.threshold, (c, u) => c.shield(u, u, v.shield * u.maxHp, v.time))
items['blue-buff'] = (c, u, v) => { u.adMult *= 1 + v.mult; u.apMult *= 1 + v.mult }
items['bramble-vest'] = (c, u, v) => {
  c.durMod(u, (c, u, src, flags) => (flags & F.attack ? v.reduction : 0))
  let ready = 0
  c.onTaken(u, (c, u, from, dmg, flags) => {
    if (!(flags & F.attack) || c.now < ready) return
    ready = c.now + v.cooldown
    for (const e of c.around(u.cell, 1, foe(u))) c.deal(u, e, v.dmg, MAGIC, F.quiet)
  })
}
items.crownguard = (c, u, v) => c.shield(u, u, v.shield * u.maxHp, v.time, (c, u) => { u.ap += v.ap })
items['dragon-s-claw'] = (c, u, v) => c.every(v.period, () => { c.heal(u, u, v.heal * u.maxHp) }, u)
items['edge-of-night'] = (c, u, v) => c.onBelow(u, v.threshold, (c, u) => {
  u.untargetableUntil = c.now + v.time
  c.cleanse(u, true)
  c.heal(u, u, v.heal * (u.maxHp - u.hp))
})
items.evenshroud = (c, u, v) => {
  c.buff(u, S.armor, v.resists, v.time)
  c.buff(u, S.mr, v.resists, v.time)
  c.every(0.5, () => { for (const e of c.around(u.cell, v.radius, foe(u))) c.sunderIt(e, v.sunder, 0.6) }, u, 0.05)
}
items['gargoyle-stoneplate'] = (c, u, v) => { u.perTargeter += v.per }
items['giant-slayer'] = (c, u, v) => c.ampMod(u, (c, u, t) => (t.role === 'tank' ? v.tank : 0))
items['guinsoo-s-rageblade'] = (c, u, v) => c.every(1, () => { u.asPct += v.stack }, u)
items['hand-of-justice'] = (c, u, v) => {
  // Attack damage and ability power doubled while healthy, omnivamp doubled when not
  let high = true
  u.adPct += 2 * v.adap
  u.ap += 200 * v.adap
  u.vamp += v.omnivamp
  c.every(0.25, () => {
    const now = c.hpShare(u) >= v.threshold
    if (now === high) return
    high = now
    const s = now ? 1 : -1
    u.adPct += s * v.adap
    u.ap += s * 100 * v.adap
    u.vamp -= s * v.omnivamp
  }, u)
}
items['hextech-gunblade'] = (c, u, v) => c.onDeal(u, (c, u, t, dmg) => { const a = c.lowest(c.allies(u), true); if (a) c.heal(u, a, dmg * v.share) })
items['ionic-spark'] = (c, u, v) => {
  c.every(0.5, () => { for (const e of c.around(u.cell, v.radius, foe(u))) c.shredIt(e, v.shred, 0.6) }, u, 0.05)
  c.anyCast((c, caster, spent) => { if (u.alive && caster.side !== u.side && c.dist(u, caster) <= v.radius) c.deal(u, caster, spent * v.burst, MAGIC, F.quiet) })
}
items['kraken-s-fury'] = (c, u, v) => {
  let k = 0
  c.onHit(u, (c, u) => {
    if (k >= v.stacks) return
    k++
    u.adPct += v.ad
    if (k === v.stacks) u.asPct += v.as_
  })
}
items['last-whisper'] = (c, u, v) => c.onDeal(u, (c, u, t, dmg, flags) => { if (struck(flags)) c.sunderIt(t, v.sunder, v.time) })
items.morellonomicon = (c, u, v) => c.onDeal(u, (c, u, t, dmg, flags) => { if (struck(flags)) { c.burn(u, t, v.burn, v.time); c.wound(t, v.wound, v.time) } })
items['nashor-s-tooth'] = (c, u, v) => c.onHit(u, (c, u, t, a) => c.addMana(u, v.mana + (a.crit ? v.critMana : 0)))
items['protector-s-vow'] = (c, u, v) => c.onBelow(u, v.threshold, (c, u) => {
  u.mana = Math.min(u.maxMana + u.reave, u.mana + v.mana)
  c.shield(u, u, v.shield * u.maxHp, v.time)
})
items.quicksilver = (c, u, v) => {
  u.unstoppableUntil = Math.max(u.unstoppableUntil, v.time)
  c.every(1, () => { if (c.now > v.time + 1e-6) return false; u.asPct += v.stack }, u)
}
items['red-buff'] = (c, u, v) => c.onDeal(u, (c, u, t, dmg, flags) => { if (struck(flags)) { c.burn(u, t, v.burn, v.time); c.wound(t, v.wound, v.time) } })
items['spear-of-shojin'] = (c, u, v) => c.onHit(u, (c, u) => c.addMana(u, v.mana))
items['spirit-visage'] = (c, u, v) => c.every(1, () => { c.heal(u, u, v.regen * (u.maxHp - u.hp)) }, u)
items['steadfast-heart'] = (c, u, v) => c.durMod(u, (c, u) => (c.hpShare(u) > 0.5 ? v.high : 0))
items['sterak-s-gage'] = (c, u, v) => c.onBelow(u, v.threshold, (c, u) => c.shield(u, u, v.shield * u.maxHp, v.time, undefined, true))
items['striker-s-flail'] = (c, u, v) => {
  const ends: number[] = []
  c.onDeal(u, (c, u, t, dmg, flags) => {
    if (!(flags & F.crit)) return
    while (ends.length && ends[0] <= c.now) ends.shift()
    if (ends.length >= v.stacks) return
    ends.push(c.now + v.time)
    c.buff(u, S.amp, v.amp, v.time)
  })
}
items['sunfire-cape'] = (c, u, v) => c.every(v.period, () => {
  const e = pick(c, c.around(u.cell, v.radius, foe(u)))
  if (e) { c.burn(u, e, v.burn, v.time); c.wound(e, v.wound, v.time) }
}, u, 0.05)
items['titan-s-resolve'] = (c, u, v) => {
  let k = 0
  const stack = () => {
    if (k >= v.stacks) return
    k++
    u.adPct += v.adap
    u.ap += v.adap * 100
    if (k === v.stacks) { u.amp += v.amp; u.unstoppableUntil = Infinity }
  }
  c.onHit(u, stack)
  c.onTaken(u, stack)
}
items['void-staff'] = (c, u, v) => c.onDeal(u, (c, u, t, dmg, flags) => { if (struck(flags)) c.shredIt(t, v.shred, v.time) })
// Emblems: the trait itself comes with the item; these are their own effects
items['brawler-emblem'] = (c, u, v) => c.onHit(u, (c, u, t) => { bonus(c, u, t, v.hpDmg * u.maxHp) })
items['defender-emblem'] = (c, u, v) => {
  const front = u.side === 0 ? 4 : 3
  u.asPct += v.as_ * c.allies(u, false).filter((a) => rowOf(a.cell) === front).length
}
items['executioner-emblem'] = (c, u, v) => { u.execute = Math.max(u.execute, v.execute) }
items['hunter-emblem'] = (c, u, v) => c.anyDeath((c, dead, killer) => { if (u.alive && killer && (killer === u || killer.master === u) && dead.side !== u.side) u.adPct += v.ad })
items['invoker-emblem'] = (c, u, v) => c.anyCast((c, caster, spent) => { if (caster === u) u.ap += spent * v.ap })
items['juggernaut-emblem'] = (c, u, v) => c.anyDeath((c, dead) => { if (u.alive && dead !== u && dead.side === u.side && dead.traits.includes('juggernaut')) u.mana = Math.min(u.maxMana + u.reave, u.mana + v.mana) })
items['rapidfire-emblem'] = (c, u, v) => c.onHit(u, (c, u, t) => { bonus(c, u, t, v.true * t.maxHp, TRUE) })
items['ravager-emblem'] = (c, u, v) => {
  u.n.healed = 0
  let counted = 0
  c.every(0.5, () => { while (u.n.healed - counted >= 300) { counted += 300; u.amp += v.amp } }, u)
}
items['spellweaver-emblem'] = (c, u, v) => c.anyCast((c, caster) => { if (u.alive && caster !== u && caster.side === u.side && !caster.summon) c.addMana(u, v.mana) })
items['sprykin-emblem'] = (c, u, v) => { if (u.n.rider) { u.asPct += v.as_; u.armor += v.resists; u.mr += v.resists } }

/* ── Traits ────────────────────────────────────────────── */

traits.adaptor = (c, side, t, members) => { for (const u of members) { if (c.apMode(u)) u.ap += t.v.adap * 100; else u.adPct += t.v.adap } }
traits.caustic = (c, side, t, members) => { for (const u of members) c.onDeal(u, (c, u, e) => { c.shredIt(e, t.v.cut, t.v.time); c.sunderIt(e, t.v.cut, t.v.time) }) }
traits.executioner = (c, side, t, members) => {
  if (!(t.v.bleed > 0)) return
  for (const u of members) c.onDeal(u, (c, u, e, dmg, flags) => { if (flags & F.crit) c.dot(u, e, dmg * t.v.bleed, t.v.time, TRUE, 'bleed') })
}
traits.fae = (c, side, t, members) => {
  const pixies = t.v.pixies
  for (const u of members) {
    u.adPct += t.v.adap * pixies
    u.ap += t.v.adap * pixies * 100
    c.onBelow(u, 0.5, (c, u) => c.heal(u, u, t.v.heal * pixies * u.maxHp))
  }
}
traits['flora-fatalis'] = (c, side, t, members) => c.anyDeath((c, dead, killer) => {
  const k = killer?.master ?? killer
  if (!k || !k.alive || dead.side === side || !members.includes(k)) return
  k.mana = Math.min(k.maxMana + k.reave, k.mana + t.v.mana * k.manaMult)
  if (t.v.heal > 0) { const a = c.lowest(c.allies(k), true); if (a) c.heal(k, a, t.v.heal * a.maxHp) }
})
traits.hunter = (c, side, t, members) => { for (const u of members) c.ampMod(u, (c, u, e) => (u.target === e && c.now - u.targetSince >= t.v.focus ? t.v.amp : 0)) }
traits.inferno = (c, side, t, members) => {
  for (const u of members) c.onDeal(u, (c, u, e, dmg, flags) => { if (struck(flags)) { c.burn(u, e, t.v.burn, t.v.time, true); c.wound(e, t.v.wound, t.v.time) } })
}
traits.lunar = (c, side, t, members) => {
  for (const a of boardUnits(c, side)) {
    // Lunar units get more (100% more: twice as much), adjacent allies the base
    const k = members.includes(a) ? 1 + t.v.more : members.some((m) => c.dist(m, a) === 1) ? 1 : 0
    a.asPct += k * t.v.as_
    a.ap += k * t.v.ap * 100
  }
}
traits.monolith = (c, side, t, members) => { for (const u of members) u.perTargeter += t.v.per }
traits.rapidfire = (c, side, t, members) => {
  for (const u of members) {
    let k = 0
    c.onHit(u, (c, u) => { if (k < t.v.stacks) { k++; u.asPct += t.v.stack } })
  }
}
traits.ravager = (c, side, t, members) => { for (const u of members) c.ampMod(u, (c, u, e) => (c.hpShare(e) < 0.5 ? 2 * t.v.bonus : t.v.bonus)) }
traits.riftbeast = (c, side, t, members) => {
  if (t.level < 2) return
  // (7): every 5 seconds, from the start, Riftbeasts grow
  for (const u of members) c.every(5, () => {
    u.adPct += t.v.ad
    u.ap += t.v.ap
    u.asPct += t.v.as_
    u.armor += t.v.resists
    u.mr += t.v.resists
    c.growHp(u, t.v.hp)
    u.manaRegen += t.v.regen
  }, u, 0.05)
}
traits.solar = (c, side, t) => {
  const three = uniqueThreeStars(c, side), more = three >= 1 ? t.v.per3 * three : 0
  for (const a of boardUnits(c, side)) {
    c.shield(a, a, (t.v.shield + more) * a.maxHp, 30)
    a.amp += t.v.magic + more
    if (three >= 3) { a.asPct += t.v.as_; a.armor += t.v.resists; a.mr += t.v.resists }
  }
  // The Eclipse, with Lunar: the lowest health enemy dies, again and again
  const lunar = c.traits[side].lunar
  if (lunar && lunar.count >= 3) c.every(t.v.eclipseEvery, () => {
    const low = c.lowest(c.side(1 - side))
    const from = boardUnits(c, side)[0]
    if (low && from) { c.event(EV.hit, from, low); c.kill(low, from) }
  }, null, t.v.eclipseAt)
}
traits.spellweaver = (c, side, t, members) => c.anyCast((c, caster) => { if (members.includes(caster)) caster.ap += t.v.perCast })
traits.thornmaiden = (c, side, t) => {
  const plants = () => { let k = 0; for (const b of c.units) if (b.alive && b.side === side && b.n.plant) k++; return k }
  for (const a of boardUnits(c, side)) c.durMod(a, () => (plants() >= t.v.plants ? t.v.many : t.v.dur))
}
traits.vanguard = (c, side, t, members) => {
  for (const u of members) {
    const give = () => c.shield(u, u, t.v.shield * u.maxHp, t.v.time)
    give()
    c.onBelow(u, 0.5, give)
    if (t.v.dur > 0) c.durMod(u, (c, u) => (u.shieldTotal > 0 ? t.v.dur : 0))
  }
}
traits.attuned = (c, side, t) => {
  const alune = strongest(boardUnits(c, side).filter((b) => b.key === 'da_18_alune'))
  if (!alune) return
  const full = () => (alune.n.moon ?? 0) > 2
  for (const a of boardUnits(c, side)) {
    c.durMod(a, () => (full() ? 0 : t.v.dur))
    c.ampMod(a, () => (full() ? t.v.amp : 0))
  }
}

/* ── The kit ───────────────────────────────────────────── */

// Adaptor goes last: it reads which of attack damage and ability power the rest made higher
const ORDER = (id: string) => (id === 'adaptor' ? 1 : 0)

export const tft18: Kit = {
  casts,
  start(c) {
    const board = c.units.slice(0, c.n).filter((u) => u.alive)
    for (const side of [0, 1]) {
      const mine = board.filter((u) => u.side === side), st = c.traits[side]
      // The Alpha Mark: the Riftbeast with the most items gets its unique Buff
      if (st.riftbeast) { const a = strongest(mine.filter((u) => u.traits.includes('riftbeast'))); if (a) a.n.alpha = 1 }
      // Sprykin's rider: the Sprykin with the most items
      if (st.sprykin) {
        const rider = strongest(mine.filter((u) => u.traits.includes('sprykin')))
        if (rider) { rider.n.rider = 1; c.growHp(rider, rider.maxHp * st.sprykin.v.hp); rider.asPct += st.sprykin.v.as_ }
      }
      // Taric pairs with the ally holding the most items
      for (const taric of mine.filter((u) => u.key === 'da_taric18')) {
        const pair = strongest(mine.filter((u) => u !== taric && u.key !== 'da_taric18' && !u.f?.plant))
        if (pair) (taric.refs ??= {}).pair = pair
      }
    }
    for (const u of board) {
      passives[u.key]?.(c, u)
      for (const it of u.f?.items ?? []) items[it.id]?.(c, u, it.v)
    }
    for (const side of [0, 1]) {
      const mine = board.filter((u) => u.side === side)
      const list = Object.entries(c.traits[side]).sort((a, b) => ORDER(a[0]) - ORDER(b[0]))
      for (const [id, t] of list) traits[id]?.(c, side, t, mine.filter((u) => u.traits.includes(id)))
    }
  },
}

/** What the kit plays, to tell the app which units, items and traits are scripted */
export const scripted = {
  units: new Set([...Object.keys(casts), ...Object.keys(passives)]),
  items: new Set(Object.keys(items)),
  traits: new Set(Object.keys(traits)),
}
