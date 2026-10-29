'use client'

import { memo, useSyncExternalStore } from 'react'
import { fightSeed } from '@/engine/batch.ts'
import { EV, F } from '@/engine/consts.ts'
import { DT, emptyRecording, fight, FLAG, FRAME, type FightResult, type Recording } from '@/engine/fight.ts'
import { CELLS, DIST } from '@/engine/hex.ts'
import { prepare } from '@/engine/prepare.ts'
import type { Boards, GameSet, Unit } from '@/engine/types.ts'
import { num } from '@/lib/format.ts'
import { BOARD_H, BOARD_W, centerOf, R } from './board.tsx'
import { Close, Dice, Pause, Play } from './icons.tsx'
import { hexPath, TokenShape } from './token.tsx'
import { IconButton, Segmented } from './ui.tsx'

// Watching one fight: it's fought once with recording on, then played back on the board. Units walk from hex to hex,
// lunge at what's next to them and shoot at what isn't, flash when struck, pulse when they cast and break apart when
// they fall; every hit and heal floats up as a number. Summons (Kruglettes, Spirit Walkers, plants) pop in when they
// appear. All of it is worked out from the recording once, then drawn at the clock's time.

interface Slot {
  /** What it's drawn as: a unit of the set (a summon borrows its owner's, with its own name and icon) */
  unit: Unit
  side: 0 | 1
  /** The tick it joins the fight (0: from the start) */
  from: number
  size: number
  /** Keeps its side in the fight: it's in the units left */
  counts: boolean
  /** Fills a mana bar */
  mana: boolean
  /** Its portraits, the first from the start: a form it takes (Elise's spider) adds one */
  looks: { tick: number; unit: Unit; clip: string }[]
}

/** An attack, landing at t (seconds): a lunge at a unit next to it, a shot at one further off */
interface Swing { t: number; from: number; to: number; crit: boolean; shot: boolean; travel: number }
/** A moment drawn on a unit: a cast, an ability's hit, a fall, a summon's arrival, a new form */
interface Burst { t: number; slot: number; kind: 'cast' | 'hit' | 'fall' | 'spawn' | 'form'; tone: string }
/** A number that floats up from a unit, in one of a few lanes so the ones in the air at once don't overlap */
interface Pop { t: number; slot: number; value: number; tone: Tone; crit: boolean; dot: boolean; lane: number; by: [number, number, number] }
type Tone = 'phys' | 'magic' | 'true' | 'heal'

export interface ReplayData {
  set: GameSet
  rec: Recording
  result: FightResult
  slots: (Slot | null)[]
  /** Per slot: where it stands when it joins */
  start: number[]
  /** Per slot, the hexes it moved between and when (fast: a dash or a leap) */
  moves: { tick: number; from: number; to: number; fast: boolean }[][]
  /** Per slot, the tick it fell (-1: it didn't) */
  deaths: number[]
  swings: Swing[]
  /** Per slot, its own attacks */
  swingsBy: Swing[][]
  /** Per slot, when it was struck and by whom */
  struckBy: { t: number; from: number; crit: boolean }[][]
  castsBy: { t: number }[][]
  bursts: Burst[]
  pops: Pop[]
  /** Per tick and side: health left as a share of all the side has had, and its units left */
  team: [Float32Array, Float32Array]
  left: [Uint8Array, Uint8Array]
  /** Units that fell, for the timeline */
  falls: { t: number; side: 0 | 1 }[]
  duration: number
  which: 'live' | 'patch'
  index: number
}

const TONE: Record<Tone, string> = { phys: 'var(--dmg-phys)', magic: 'var(--dmg-magic)', true: 'var(--dmg-true)', heal: 'var(--heal)' }
const tint = (side: 0 | 1) => (side ? 'var(--red)' : 'var(--blue)')
const byTime = <T extends { t: number }>(list: T[]) => list.sort((a, b) => a.t - b.t)
/** The first index of a list sorted by t whose t is at least x */
function after<T extends { t: number }>(list: T[], x: number) {
  let lo = 0, hi = list.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < x) lo = m + 1; else hi = m }
  return lo
}

export function makeReplay(set: GameSet, boards: Boards, seed: number, index: number, which: 'live' | 'patch'): ReplayData {
  const p = prepare(set, boards), units = new Map(set.units.map((u) => [u.id, u]))
  const rec = emptyRecording()
  const result = fight(p, fightSeed(seed, index), rec)
  const S = rec.slots, T = rec.ticks
  const frame = (tick: number, slot: number, k: number) => rec.frames[(Math.max(0, Math.min(T - 1, tick)) * S + slot) * FRAME + k]
  const slots: (Slot | null)[] = Array.from({ length: S }, () => null)
  const look = (i: number, unit: Unit, tick: number, k: number) => ({ tick, unit, clip: `rp${i}-${k}` })
  p.fighters.forEach((f, i) => { const u = units.get(f.unit); if (u) slots[i] = { unit: u, side: f.side, from: 0, size: 1, counts: true, mana: f.mana > 0 && f.resource !== 'manaless', looks: [look(i, u, 0, 0)] } })
  for (const sp of rec.spawns) {
    const owner = units.get(p.fighters[sp.owner]?.unit ?? '')
    if (!owner) continue
    const unit: Unit = { ...owner, name: sp.name, icon: sp.icon ?? owner.icon }
    slots[sp.slot] = { unit, side: sp.side, from: sp.tick, size: sp.size, counts: sp.counts, mana: false, looks: [look(sp.slot, unit, sp.tick, 0)] }
  }
  for (const [tick, slot, icon] of rec.forms) { const s = slots[slot]; if (s) s.looks.push(look(slot, { ...s.unit, icon }, tick, s.looks.length)) }
  const start = slots.map((s, i) => (s ? frame(s.from, i, 0) : 0))

  const fast = new Set(rec.events.filter((e) => e[1] === EV.dash).map((e) => e[0] * S + e[2]))
  const moves = slots.map((slot, i) => {
    const list: ReplayData['moves'][number] = []
    if (!slot) return list
    for (let t = slot.from + 1; t < T; t++) {
      const a = frame(t - 1, i, 0), b = frame(t, i, 0)
      if (a !== b) list.push({ tick: t, from: a, to: b, fast: fast.has(t * S + i) })
    }
    return list
  })
  const deaths = slots.map(() => -1)
  for (const [tick, kind, from] of rec.events) if (kind === EV.death && deaths[from] < 0) deaths[from] = tick

  // What each hit was: its type, from the damage it did
  const typeOf = new Map<string, number>()
  for (let k = 0; k < rec.hits.length; k += 5) if ((rec.hits[k + 4] >> 2) & F.ability) typeOf.set(`${rec.hits[k]}:${rec.hits[k + 1]}:${rec.hits[k + 2]}`, rec.hits[k + 4] & 3)
  const swings: Swing[] = [], bursts: Burst[] = []
  const castsBy: { t: number }[][] = slots.map(() => [])
  for (const [tick, kind, from, to] of rec.events) {
    const t = tick * DT
    if (kind === EV.attack || kind === EV.crit) {
      const a = frame(tick, from, 0), b = frame(tick, to, 0), d = DIST[a * CELLS + b] ?? 1
      const shot = d > 1
      swings.push({ t, from, to, crit: kind === EV.crit, shot, travel: shot ? Math.min(0.3, 0.07 + d * 0.045) : 0 })
    } else if (kind === EV.cast) {
      castsBy[from].push({ t })
      bursts.push({ t, slot: from, kind: 'cast', tone: tint(slots[from]?.side ?? 0) })
    } else if (kind === EV.hit && from !== to) {
      const type = typeOf.get(`${tick}:${from}:${to}`) ?? (slots[from]?.unit.damage === 'attack' ? 0 : 1)
      bursts.push({ t, slot: to, kind: 'hit', tone: type === 2 ? TONE.true : type === 1 ? TONE.magic : TONE.phys })
    } else if (kind === EV.death) bursts.push({ t, slot: from, kind: 'fall', tone: tint(slots[from]?.side ?? 0) })
  }
  slots.forEach((s, i) => {
    if (s && s.from > 0) bursts.push({ t: s.from * DT, slot: i, kind: 'spawn', tone: tint(s.side) })
    s?.looks.slice(1).forEach((l) => bursts.push({ t: l.tick * DT, slot: i, kind: 'form', tone: 'var(--c5)' }))
  })
  byTime(swings)
  byTime(bursts)
  const swingsBy = slots.map(() => [] as Swing[])
  for (const s of swings) swingsBy[s.from].push(s)

  // The numbers. A unit's hits add up over a third of a second, damage over time and heals over half a second; a
  // number too small to matter beside the unit's health (a bounce, a little omnivamp) stays quiet unless it crit
  const pops: Pop[] = [], gathered = new Map<string, Pop>()
  const struckBy = slots.map(() => [] as { t: number; from: number; crit: boolean }[])
  const add = (key: string, t: number, slot: number, value: number, type: number, tone: Tone, crit: boolean, dot: boolean) => {
    let pop = gathered.get(key)
    if (!pop) { pop = { t, slot, value: 0, tone, crit, dot, lane: 0, by: [0, 0, 0] }; gathered.set(key, pop); pops.push(pop) }
    pop.value += value
    if (tone !== 'heal') {
      pop.by[type] += value
      pop.tone = pop.by[2] >= pop.by[0] && pop.by[2] >= pop.by[1] ? 'true' : pop.by[1] > pop.by[0] ? 'magic' : 'phys'
    }
  }
  for (let k = 0; k < rec.hits.length; k += 5) {
    const tick = rec.hits[k], from = rec.hits[k + 1], to = rec.hits[k + 2], value = rec.hits[k + 3], code = rec.hits[k + 4]
    const type = code & 3, flags = code >> 2, tone: Tone = type === 2 ? 'true' : type === 1 ? 'magic' : 'phys', t = tick * DT
    const crit = (flags & F.crit) !== 0, dot = (flags & F.dot) !== 0
    if (dot) { const w = Math.floor(t / 0.5); add(`d${to}:${w}`, Math.max(t, w * 0.5), to, value, type, tone, false, true) }
    else {
      const w = Math.floor(t / 0.3)
      add(crit ? `c${to}:${tick}` : `h${to}:${w}`, crit ? t : Math.max(t, w * 0.3), to, value, type, tone, crit, false)
      // A blow that shows: a crit, or one worth a bit of the unit's health
      if (from !== to && (crit || value >= 0.02 * frame(tick, to, 5))) struckBy[to].push({ t, from, crit })
    }
  }
  for (let k = 0; k < rec.heals.length; k += 4) {
    const tick = rec.heals[k], to = rec.heals[k + 2], w = Math.floor((tick * DT) / 0.5)
    add(`+${to}:${w}`, Math.max(tick * DT, w * 0.5), to, rec.heals[k + 3], 0, 'heal', false, false)
  }
  const worth = (p: Pop) => {
    const max = frame(Math.round(p.t / DT), p.slot, 5) || 1
    return p.value >= 1 && p.value >= max * (p.tone === 'heal' ? 0.04 : p.crit ? 0.015 : 0.03)
  }
  const shown = byTime(pops.filter(worth))
  // Lanes: a number takes the lowest one free on its unit
  const busy = new Map<number, { until: number; lane: number }[]>()
  for (const p of shown) {
    const live = (busy.get(p.slot) ?? []).filter((b) => b.until > p.t)
    let lane = 0
    while (live.some((b) => b.lane === lane) && lane < 3) lane++
    p.lane = lane % 3
    live.push({ until: p.t + 0.62, lane: p.lane })
    busy.set(p.slot, live)
  }

  // Each side's health and units, tick by tick
  const team: [Float32Array, Float32Array] = [new Float32Array(T), new Float32Array(T)]
  const left: [Uint8Array, Uint8Array] = [new Uint8Array(T), new Uint8Array(T)]
  for (let t = 0; t < T; t++) {
    const have = [0, 0], had = [0, 0]
    slots.forEach((s, i) => {
      if (!s || !s.counts || s.from > t) return
      const max = frame(t, i, 5)
      had[s.side] += max
      have[s.side] += frame(t, i, 1) * max
      if (frame(t, i, 4) & FLAG.alive) left[s.side][t]++
    })
    team[0][t] = had[0] ? have[0] / had[0] : 0
    team[1][t] = had[1] ? have[1] / had[1] : 0
  }
  const falls = slots.flatMap((s, i) => (s && s.counts && deaths[i] >= 0 ? [{ t: deaths[i] * DT, side: s.side }] : []))

  return { set, rec, result, slots, start, moves, deaths, swings, swingsBy, struckBy, castsBy, bursts, pops: shown, team, left, falls, duration: result.time, which, index }
}

/* ── The clock: one store the board and the controls both read ── */

export interface Clock {
  subscribe: (f: () => void) => () => void
  time: () => number
  state: () => string
  play: () => void
  pause: () => void
  seek: (t: number) => void
  speed: (s: number) => void
  load: (duration: number) => void
}

export function createClock(): Clock {
  let t = 0, playing = false, rate = 1, duration = 0, raf = 0, last = 0
  const subs = new Set<() => void>()
  const emit = () => subs.forEach((f) => f())
  const loop = (now: number) => {
    if (!playing) return
    // A frame's timestamp can come before the moment play was pressed: never step back
    t = Math.min(duration, t + (Math.max(0, now - last) / 1000) * rate)
    last = now
    if (t >= duration) playing = false
    emit()
    if (playing) raf = requestAnimationFrame(loop)
  }
  return {
    subscribe: (f) => { subs.add(f); return () => { subs.delete(f) } },
    time: () => t,
    state: () => `${playing ? 1 : 0}|${rate}`,
    play: () => { if (t >= duration) t = 0; playing = true; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); emit() },
    pause: () => { playing = false; cancelAnimationFrame(raf); emit() },
    seek: (x) => { t = Math.max(0, Math.min(duration, x)); emit() },
    speed: (s) => { rate = s; emit() },
    load: (d) => { duration = d; t = 0; emit() },
  }
}

const useTime = (c: Clock) => useSyncExternalStore(c.subscribe, c.time, () => 0)
const useClockState = (c: Clock) => useSyncExternalStore(c.subscribe, c.state, () => '0|1')

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const easeOut = (x: number) => 1 - (1 - x) ** 3
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const backOut = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2

/** A unit's portrait, drawn once at the origin and moved by its group: only the group's transform changes each frame */
const Token = memo(function Token({ set, unit, r, clip }: { set: GameSet; unit: Unit; r: number; clip: string }) {
  return <TokenShape set={set} unit={unit} cx={0} cy={0} r={r} clipId={clip} />
})

let reduced: boolean | null = null
const calm = () => (reduced ??= typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

/** The fight drawn at the clock's time, in the board's own coordinates */
export const ReplayLayer = memo(function ReplayLayer({ data, clock }: { data: ReplayData; clock: Clock }) {
  const time = useTime(clock)
  const { rec, slots, set } = data
  const S = rec.slots, f = Math.max(0, time) / DT, tick = Math.max(0, Math.min(rec.ticks - 1, Math.floor(f)))
  const moveTime = set.rules.moveTime, still = calm()
  const frame = (i: number, k: number, t = tick) => rec.frames[(Math.max(0, Math.min(rec.ticks - 1, t)) * S + i) * FRAME + k]

  // Where each unit stands now: walking eases between hexes, a dash or a leap snaps there
  const base = (i: number) => {
    const list = data.moves[i]
    let lo = 0, hi = list.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].tick <= f) lo = m + 1; else hi = m }
    const m = list[lo - 1]
    if (!m) return centerOf(data.start[i])
    const p = clamp01((time - m.tick * DT) / (m.fast ? 0.2 : moveTime)), e = m.fast ? easeOut(p) : easeInOut(p)
    const a = centerOf(m.from), b = centerOf(m.to)
    return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }
  }
  const shown: number[] = []
  slots.forEach((s, i) => { if (s && f >= s.from && (data.deaths[i] < 0 || time - data.deaths[i] * DT < 0.55)) shown.push(i) })
  const home = new Map<number, { x: number; y: number }>()
  const at = (i: number) => { let p = home.get(i); if (!p) { p = base(i); home.set(i, p) } return p }
  shown.forEach(at)

  // How far each unit leans: towards what it strikes, away from what struck it
  const lean = (i: number) => {
    const me = at(i), list = data.swingsBy[i]
    let dx = 0, dy = 0, lunge = 0
    for (let k = after(list, time - 0.2); k < list.length && list[k].t <= time + 0.32; k++) {
      const s = list[k], q = at(s.to), vx = q.x - me.x, vy = q.y - me.y, len = Math.hypot(vx, vy) || 1
      if (!s.shot) {
        const u = time - s.t, amt = u < -0.12 || u > 0.2 ? 0 : u <= 0 ? (1 + u / 0.12) ** 2 : (1 - u / 0.2) ** 2
        if (amt > lunge) { lunge = amt; dx = (vx / len) * amt * R * 0.27; dy = (vy / len) * amt * R * 0.27 }
      } else {
        const u = time - (s.t - s.travel)
        if (u >= 0 && u <= 0.16 && !lunge) { const amt = 1 - u / 0.16; dx = (-vx / len) * amt * 3.5; dy = (-vy / len) * amt * 3.5 }
      }
    }
    const struck = data.struckBy[i]
    const k = after(struck, time + 1e-6) - 1
    let flash = 0
    if (k >= 0 && time - struck[k].t <= 0.14) {
      const s = struck[k], age = (time - s.t) / 0.14, q = at(s.from), vx = me.x - q.x, vy = me.y - q.y, len = Math.hypot(vx, vy) || 1
      flash = (s.crit ? 0.45 : 0.28) * (1 - age)
      if (!still) { dx += (vx / len) * 3.2 * (1 - age); dy += (vy / len) * 3.2 * (1 - age) }
    }
    return { dx: still ? 0 : dx, dy: still ? 0 : dy, flash }
  }

  const drawn = shown.map((i) => {
    const slot = slots[i]!, me = at(i), { dx, dy, flash } = lean(i)
    const flags = frame(i, 4), r = R * 0.7 * slot.size
    const casts = data.castsBy[i], c = after(casts, time + 1e-6) - 1
    const castAge = c >= 0 ? time - casts[c].t : 9
    let scale = castAge < 0.34 ? 1 + 0.16 * Math.sin((Math.PI * castAge) / 0.34) : 1
    if (slot.from > 0) scale *= 0.3 + 0.7 * backOut(clamp01((time - slot.from * DT) / 0.32))
    const fell = data.deaths[i] >= 0 ? time - data.deaths[i] * DT : -1
    let opacity = 1
    if (fell >= 0) { scale *= 1 - 0.4 * easeOut(clamp01(fell / 0.55)); opacity = 1 - clamp01(fell / 0.55) }
    const away = (flags & FLAG.untargetable) !== 0
    const ghost = away && slot.from > 0
    const lift = away && !ghost ? -11 : 0
    let look = slot.looks[0]
    for (const l of slot.looks) if (l.tick <= f) look = l
    return { i, slot, x: me.x + dx, y: me.y + dy + lift, ground: me.y + dy, r, scale, opacity, flash, flags, ghost, away, look, fell }
  })
  // Lower on the board drawn later, so units overlap the way they stand
  drawn.sort((a, b) => a.y - b.y)

  const ended = time >= data.duration - 1e-6
  const winner = data.result.winner
  const lastTick = rec.ticks - 1
  return (
    <g style={{ pointerEvents: 'none' }}>
      <defs>
        <filter id="rp-gray" colorInterpolationFilters="sRGB"><feColorMatrix type="saturate" values="0" /></filter>
        <radialGradient id="rp-shadow"><stop offset="0" stopColor="var(--shadow)" /><stop offset="1" stopColor="var(--shadow)" stopOpacity="0" /></radialGradient>
      </defs>

      {/* Shadows, on the ground even under a unit in the air */}
      {drawn.map((d) => (d.ghost ? null : <ellipse key={`s${d.i}`} cx={d.x} cy={d.ground + d.r * 0.82} rx={d.r * (d.away ? 0.62 : 0.86)} ry={d.r * 0.3} fill="url(#rp-shadow)" opacity={d.opacity * (d.away ? 0.6 : 1)} />))}

      {/* The units */}
      {drawn.map((d) => (
        <g key={`u${d.i}`} transform={`translate(${d.x.toFixed(2)} ${d.y.toFixed(2)}) scale(${d.scale.toFixed(3)})`} opacity={d.opacity * (d.ghost ? 0.92 : 1)} filter={d.fell >= 0 ? 'url(#rp-gray)' : undefined}>
          <Token set={set} unit={d.look.unit} r={d.r} clip={d.look.clip} />
          {d.flash > 0 && <path d={hexPath(0, 0, d.r)} fill="#fff" opacity={d.flash} />}
          {(d.flags & FLAG.stunned) !== 0 && d.fell < 0 && (
            <circle r={d.r * 1.12} fill="none" strokeWidth={2.2} strokeDasharray="4 5" strokeLinecap="round" style={{ stroke: 'var(--c5)' }} transform={`rotate(${((time * 220) % 360).toFixed(1)})`} />
          )}
        </g>
      ))}

      {/* Shots in flight, and where blows land */}
      {(() => {
        const out = []
        for (let k = after(data.swings, time - 0.14); k < data.swings.length && data.swings[k].t <= time + 0.3; k++) {
          const s = data.swings[k], from = slots[s.from], to = slots[s.to]
          if (!from || !to) continue
          const a = at(s.from), b = at(s.to), color = tint(from.side)
          if (s.shot && time >= s.t - s.travel && time <= s.t) {
            // A short streak behind the shot, the same length however far it flies
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, p = (time - (s.t - s.travel)) / s.travel, q = Math.max(0, p - Math.min(0.3, 16 / len))
            const hx = a.x + (b.x - a.x) * p, hy = a.y + (b.y - a.y) * p, tx = a.x + (b.x - a.x) * q, ty = a.y + (b.y - a.y) * q
            out.push(
              <g key={`p${k}`}>
                <line x1={tx} y1={ty} x2={hx} y2={hy} strokeWidth={s.crit ? 4 : 3} strokeLinecap="round" opacity={0.45} style={{ stroke: color }} />
                <circle cx={hx} cy={hy} r={s.crit ? 4.2 : 3.2} style={{ fill: s.crit ? 'var(--c5)' : color }} />
              </g>,
            )
          }
          const age = time - s.t
          if (age >= 0 && age <= 0.14) {
            const vx = a.x - b.x, vy = a.y - b.y, len = Math.hypot(vx, vy) || 1, rr = R * 0.7 * to.size
            const cx = b.x + (vx / len) * rr * 0.55, cy = b.y + (vy / len) * rr * 0.55, e = easeOut(age / 0.14)
            out.push(<circle key={`i${k}`} cx={cx} cy={cy} r={3 + e * (s.crit ? 11 : 7)} fill="none" strokeWidth={s.crit ? 2.6 : 2} opacity={1 - e} style={{ stroke: s.crit ? 'var(--c5)' : color }} />)
          }
        }
        return out
      })()}

      {/* Casts, ability hits, falls, arrivals and new forms */}
      {(() => {
        const out = []
        for (let k = after(data.bursts, time - 0.6); k < data.bursts.length && data.bursts[k].t <= time; k++) {
          const b = data.bursts[k], slot = slots[b.slot]
          if (!slot) continue
          const age = time - b.t, { x, y } = at(b.slot), r = R * 0.7 * slot.size
          if (b.kind === 'cast' && age < 0.45) {
            const e = easeOut(age / 0.45)
            out.push(
              <g key={`b${k}`}>
                <circle cx={x} cy={y} r={r * (1 + 0.75 * e)} fill="none" strokeWidth={3.2 * (1 - e) + 0.6} opacity={0.9 * (1 - e)} style={{ stroke: b.tone }} />
                <circle cx={x} cy={y} r={r * (1.05 + 0.3 * e)} opacity={0.2 * (1 - e)} style={{ fill: b.tone }} />
              </g>,
            )
          } else if (b.kind === 'hit' && age < 0.3) {
            const e = easeOut(age / 0.3)
            out.push(
              <g key={`b${k}`} opacity={1 - e}>
                <circle cx={x} cy={y} r={r * (1 + 0.35 * e)} fill="none" strokeWidth={2} style={{ stroke: b.tone }} />
                <path d={hexPath(x, y, r)} opacity={0.18} style={{ fill: b.tone }} />
              </g>,
            )
          } else if (b.kind === 'fall' && age < 0.6 && !still) {
            const e = easeOut(age / 0.6)
            out.push(
              <g key={`b${k}`} opacity={1 - e}>
                <circle cx={x} cy={y} r={r * (0.8 + 0.7 * e)} fill="none" strokeWidth={2} style={{ stroke: b.tone }} />
                {[0, 1, 2, 3, 4, 5].map((n) => {
                  const ang = (n / 6) * Math.PI * 2 + b.slot * 0.7, d = r * (1 + 0.8 * e)
                  return <circle key={n} cx={x + Math.cos(ang) * d} cy={y + Math.sin(ang) * d} r={2.4 * (1 - e) + 0.5} style={{ fill: b.tone }} />
                })}
              </g>,
            )
          } else if (b.kind === 'spawn' && age < 0.4) {
            const e = easeOut(age / 0.4)
            out.push(<circle key={`b${k}`} cx={x} cy={y} r={r * (1.7 - 0.6 * e)} fill="none" strokeWidth={2.2} opacity={0.85 * (1 - e)} style={{ stroke: b.tone }} />)
          } else if (b.kind === 'form' && age < 0.5) {
            const e = easeOut(age / 0.5)
            out.push(
              <g key={`b${k}`}>
                <circle cx={x} cy={y} r={r * (1 + 0.9 * e)} fill="none" strokeWidth={3} opacity={1 - e} style={{ stroke: b.tone }} />
                <circle cx={x} cy={y} r={r} fill="#fff" opacity={0.6 * (1 - e)} />
              </g>,
            )
          }
        }
        return out
      })()}

      {/* Health (with what was just lost), shields and mana, over the units */}
      {drawn.map((d) => {
        if (d.ghost || d.fell >= 0.3) return null
        const hp = frame(d.i, 1), was = frame(d.i, 1, tick - 8), shield = frame(d.i, 2), mana = frame(d.i, 3)
        const hasMana = d.slot.mana
        const w = R * 1.3 * Math.max(0.75, d.slot.size), x = d.x - w / 2, y = d.y - d.r * d.scale - 9
        const total = Math.max(1, hp + shield), hpW = (w * hp) / total, shW = (w * shield) / total, chip = Math.max(0, Math.min(1, was) - hp)
        return (
          <g key={`h${d.i}`} opacity={d.opacity}>
            <rect x={x - 1} y={y - 1} width={w + 2} height={hasMana ? 9 : 6} rx={2.5} style={{ fill: 'var(--bar-bg)' }} />
            {chip > 0.001 && <rect x={x + hpW} y={y} width={(w * chip) / total} height={4} rx={1} fill="#fff" opacity={0.85} />}
            <rect x={x} y={y} width={hpW} height={4} rx={1} style={{ fill: tint(d.slot.side) }} />
            {shW > 0.3 && <rect x={x + hpW} y={y} width={shW} height={4} rx={1} style={{ fill: 'var(--shield)' }} />}
            {hasMana && <rect x={x} y={y + 5} width={w * mana} height={2} rx={1} style={{ fill: (d.flags & FLAG.casting) !== 0 ? '#fff' : 'var(--mana)' }} />}
          </g>
        )
      })}

      {/* Damage and heals, rising */}
      {(() => {
        const out = []
        for (let k = after(data.pops, time - 0.95); k < data.pops.length && data.pops[k].t <= time; k++) {
          const p = data.pops[k], slot = slots[p.slot]
          if (!slot) continue
          const age = time - p.t, { x, y } = at(p.slot), r = R * 0.7 * slot.size
          const grow = age < 0.1 ? 0.6 + (p.crit ? 0.75 : 0.5) * Math.sin((Math.PI / 2) * (age / 0.1)) : 1 + (p.crit ? 0.35 : 0.1) * (1 - clamp01((age - 0.1) / 0.14))
          const size = (p.dot ? 8.5 : 9 + Math.min(3.5, Math.log10(p.value + 1) * 1.3)) * (p.crit ? 1.2 : 1)
          const rise = still ? 0 : 20 * easeOut(clamp01(age / 0.95))
          const opacity = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.35
          const dx = [0, -9, 9][p.lane], lift = p.lane * 14
          out.push(
            <text
              key={`n${k}`}
              transform={`translate(${(x + dx).toFixed(1)} ${(y - r - 13 - lift - rise).toFixed(1)}) scale(${grow.toFixed(3)})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={size}
              fontWeight={p.crit ? 800 : 700}
              opacity={opacity * (p.dot ? 0.85 : 1)}
              className="replay-pop"
              style={{ fill: TONE[p.tone] }}
            >
              {p.tone === 'heal' ? '+' : ''}{Math.round(p.value)}
            </text>,
          )
        }
        return out
      })()}

      {ended && (
        <g className="replay-end">
          <rect width={BOARD_W} height={BOARD_H} style={{ fill: 'var(--paper)' }} opacity={0.38} />
          <g transform={`translate(${BOARD_W / 2} ${BOARD_H / 2})`}>
            <rect x={-110} y={-36} width={220} height={72} rx={16} className="fill-panel" stroke="var(--line-strong)" strokeWidth={1} />
            <circle cx={-72} cy={-8} r={5} style={{ fill: winner === -1 ? 'var(--muted)' : tint(winner === 1 ? 1 : 0) }} />
            <text x={-60} y={-8} dominantBaseline="central" fontSize={22} fontWeight={560} letterSpacing={-0.3} className="fill-ink" style={{ fontFamily: 'var(--font-display)' }}>{winner === -1 ? 'A draw' : winner === 0 ? 'Blue wins' : 'Red wins'}</text>
            <text x={-72} y={17} dominantBaseline="central" fontSize={12.5} className="fill-muted">
              {num(data.duration, 1)} s{winner >= 0 ? ` · ${data.left[winner === 1 ? 1 : 0][lastTick]} unit${data.left[winner === 1 ? 1 : 0][lastTick] === 1 ? '' : 's'} left` : ''}
            </text>
          </g>
        </g>
      )}
    </g>
  )
})

/** Each side's health and units left, as the fight goes */
function Teams({ data, tick }: { data: ReplayData; tick: number }) {
  const side = (s: 0 | 1) => {
    const share = data.team[s][tick] ?? 0, n = data.left[s][tick] ?? 0
    const label = `${s ? 'Red' : 'Blue'}: ${n} unit${n === 1 ? '' : 's'} left, ${num(share * 100, 0)}% health`
    return (
      <div className={`flex min-w-0 flex-1 items-center gap-2 ${s ? 'flex-row-reverse' : ''}`} title={label} aria-label={label}>
        <span className={`flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-ink tabular-nums ${s ? 'flex-row-reverse' : ''}`}>
          <span className={`size-2 rounded-full ${s ? 'bg-red' : 'bg-blue'}`} />
          {n}
        </span>
        <div className={`flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-sunk ${s ? 'justify-end' : ''}`}>
          <div className={`h-full rounded-full ${s ? 'bg-red' : 'bg-blue'}`} style={{ width: `${(share * 100).toFixed(2)}%` }} />
        </div>
      </div>
    )
  }
  return <div className="flex items-center gap-4 px-1.5 pt-1">{side(0)}{side(1)}</div>
}

/** The fight's time, scrubbable: falls marked (red's above the line, blue's below), overtime shaded */
function Timeline({ data, time, onSeek }: { data: ReplayData; time: number; onSeek: (t: number) => void }) {
  const d = Math.max(0.05, data.duration), ot = data.set.rules.overtime
  return (
    <div className="relative h-9 min-w-24 flex-1">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-sunk">
        {ot < d && <div className="absolute inset-y-0 right-0 bg-red/20" style={{ left: `${(ot / d) * 100}%` }} title="Overtime" />}
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(Math.min(time, d) / d) * 100}%` }} />
      </div>
      {data.falls.map((x, k) => (
        <span key={k} className={`pointer-events-none absolute h-1.5 w-[3px] -translate-x-1/2 rounded-full ${x.side ? 'top-[calc(50%-10px)] bg-red' : 'top-[calc(50%+4px)] bg-blue'}`} style={{ left: `${(x.t / d) * 100}%` }} />
      ))}
      <input
        type="range"
        aria-label="Time"
        min={0}
        max={d}
        step={0.05}
        value={time}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="replay-range absolute inset-0 h-full w-full cursor-pointer"
      />
    </div>
  )
}

const SPEEDS = [1, 2, 4, 0.5]

/** Play, pause, scrub, speed, live or patch, another fight; each side's health above */
export function ReplayBar({ data, clock, hasPatch, onWhich, onAnother, onClose }: { data: ReplayData; clock: Clock; hasPatch: boolean; onWhich: (w: 'live' | 'patch') => void; onAnother: () => void; onClose: () => void }) {
  const time = useTime(clock)
  const [playing, rate] = useClockState(clock).split('|')
  const tick = Math.max(0, Math.min(data.rec.ticks - 1, Math.floor(time / DT)))
  const next = SPEEDS[(SPEEDS.indexOf(Number(rate)) + 1) % SPEEDS.length]
  return (
    <div className="flex flex-col gap-1">
      <Teams data={data} tick={tick} />
      {/* The controls wrap under the timeline when the bar is narrow */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-52 items-center gap-1.5">
          <IconButton label={playing === '1' ? 'Pause' : 'Play'} onClick={() => (playing === '1' ? clock.pause() : clock.play())} tone="solid">
            {playing === '1' ? <Pause /> : <Play />}
          </IconButton>
          <span className="w-[4.25rem] shrink-0 text-right text-[13px] font-semibold text-ink tabular-nums" title={time > data.set.rules.overtime ? 'Overtime: every hit deals more each second' : undefined}>
            {num(time, 1)} s{time > data.set.rules.overtime && <span className="ml-1 text-[11px] font-medium text-red">OT</span>}
          </span>
          <Timeline data={data} time={time} onSeek={(t) => { clock.pause(); clock.seek(t) }} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => clock.speed(next)} title="Playback speed" aria-label={`Playback speed: ${rate} times`} className="h-9 min-w-11 rounded-lg px-2 text-[13px] font-semibold text-soft tabular-nums hover:bg-sunk hover:text-ink">{rate === '0.5' ? '½' : rate}×</button>
          {hasPatch && <Segmented label="Numbers" value={data.which} onChange={onWhich} options={[{ value: 'live', label: 'Live' }, { value: 'patch', label: 'Patch' }]} />}
          <IconButton label="Watch another fight" onClick={onAnother}><Dice /></IconButton>
          <IconButton label="Stop watching" onClick={onClose}><Close /></IconButton>
        </div>
      </div>
    </div>
  )
}
