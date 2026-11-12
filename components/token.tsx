'use client'

import { useId, useState, type ReactNode } from 'react'
import type { GameSet, Item, Trait, Unit } from '@/engine/types.ts'
import { iconUrl } from '@/lib/sets.ts'
import { cx } from './ui.tsx'

// Hexes: the board's cells and the units on them share one shape (pointy-top, softly rounded corners). Lists show
// units as rounded squares, like a shop.

export function hexPath(cx: number, cy: number, r: number, round = r * 0.14) {
  const v = Array.from({ length: 6 }, (_, k) => {
    const a = ((60 * k - 90) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
  const t = Math.min(0.45, round / r)
  const lerp = (a: number[], b: number[], f: number) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
  let d = ''
  for (let i = 0; i < 6; i++) {
    const p = v[(i + 5) % 6], c = v[i], n = v[(i + 1) % 6]
    const a = lerp(c, p, t), b = lerp(c, n, t)
    d += `${i ? 'L' : 'M'}${a[0].toFixed(2)} ${a[1].toFixed(2)}Q${c[0].toFixed(2)} ${c[1].toFixed(2)} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`
  }
  return `${d}Z`
}

export const costColor = (cost: number) => `var(--c${Math.min(5, Math.max(1, Math.round(cost)))})`

/** Two letters for a unit without art: the initials, or the first two letters of a one-word name */
export const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).replace(/^./, (c) => c.toUpperCase())
}

/** A name on one line, or on two when it has several words (split where the longer line is shortest) */
const nameLines = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length < 2) return [name]
  let best = [name], longest = Infinity
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')], l = Math.max(lines[0].length, lines[1].length)
    if (l < longest) { best = lines; longest = l }
  }
  return best
}

/** A unit's hex, drawn into an SVG at cx, cy: its art in a ring of its cost's colour, or its name without art */
export function TokenShape({ set, unit, cx: x, cy: y, r, clipId }: { set: GameSet; unit: Unit; cx: number; cy: number; r: number; clipId: string }) {
  const src = iconUrl(set, unit.icon), d = hexPath(x, y, r)
  const lines = nameLines(unit.name)
  const size = Math.min(r * 0.36, (r * 1.5) / Math.max(4, ...lines.map((l) => l.length)) * 1.7)
  // The name sits under the art, so a picture that doesn't load leaves the name showing
  return (
    <g>
      <path d={d} style={{ fill: `color-mix(in oklab, ${costColor(unit.cost)} 18%, var(--panel))` }} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={600} letterSpacing={-0.1} className="fill-ink" style={{ pointerEvents: 'none' }}>
        {lines.map((l, i) => <tspan key={i} x={x} y={y + (i - (lines.length - 1) / 2) * size * 1.12}>{l}</tspan>)}
      </text>
      {src && (
        <>
          <clipPath id={clipId}><path d={d} /></clipPath>
          <Art href={src} x={x - r} y={y - r} width={r * 2} height={r * 2} clipPath={`url(#${clipId})`} />
        </>
      )}
      <path d={d} fill="none" strokeWidth={Math.max(1.6, r * 0.085)} style={{ stroke: costColor(unit.cost) }} />
    </g>
  )
}

/** Art inside an SVG, left out when it can't be loaded (an ad blocker, a missing file) */
export function Art({ href, ...p }: { href: string; x: number; y: number; width: number; height: number; clipPath?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === href) return null
  return <image href={href} preserveAspectRatio="xMidYMid slice" onError={() => setFailed(href)} {...p} />
}

/** The board's hex token as a standalone picture (the dragged copy) */
export function UnitToken({ set, unit, size = 56, className }: { set: GameSet; unit: Unit; size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} aria-hidden>
      <TokenShape set={set} unit={unit} cx={20} cy={20} r={19} clipId={`t${id}`} />
    </svg>
  )
}

/** A unit in a list: its art in a rounded square ringed in its cost's colour (two letters without art) */
export function Portrait({ set, unit, size = 40, className, children }: { set: GameSet; unit: Unit; size?: number; className?: string; children?: ReactNode }) {
  const src = iconUrl(set, unit.icon)
  const [broken, setBroken] = useState(false)
  const ring = size >= 36 ? 2 : 1.5
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center rounded-[24%] bg-sunk font-semibold text-ink select-none', className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} className="size-full rounded-[inherit] object-cover" />
      ) : (
        initials(unit.name)
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ boxShadow: `inset 0 0 0 ${ring}px ${costColor(unit.cost)}` }} />
      {children}
    </span>
  )
}

/** An item: its art, or its initial on a dark tile (also when the art doesn't load) */
export function ItemTile({ set, item, size = 22, className }: { set: GameSet; item: Item; size?: number; className?: string }) {
  const src = iconUrl(set, item.icon)
  const [broken, setBroken] = useState(false)
  return src && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} className={cx('shrink-0 rounded-[22%] bg-sunk object-cover', className)} style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-[22%] bg-raised font-semibold text-soft', className)} style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {item.name.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}

/** The colour a trait shows at a breakpoint, as in game: bronze, silver, gold, then prismatic at the top of a long ladder */
export type Tier = 'off' | 'bronze' | 'silver' | 'gold' | 'prism'
export function tierOf(level: number, steps: number): Tier {
  if (level < 0) return 'off'
  if (steps <= 1) return 'gold'
  if (level === 0) return 'bronze'
  if (level === steps - 1) return steps >= 4 ? 'prism' : 'gold'
  return level === 1 && steps >= 3 ? 'silver' : 'gold'
}

/** A trait's hex badge: its art on the colour of the breakpoint reached */
export function TraitBadge({ set, trait, tier, size = 22 }: { set: GameSet; trait: Pick<Trait, 'name' | 'icon'>; tier: Tier; size?: number }) {
  const src = iconUrl(set, trait.icon)
  const [broken, setBroken] = useState(false)
  return (
    <span aria-hidden className={cx('trait-badge relative inline-flex shrink-0 items-center justify-center', `tier-${tier}`)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 20 20" className="absolute inset-0 size-full">
        <path d={hexPath(10, 10, 9.6, 1.8)} className="trait-hex" />
      </svg>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} className="trait-glyph relative" style={{ width: size * 0.62, height: size * 0.62 }} />
      ) : (
        <span className="trait-glyph relative font-bold" style={{ fontSize: size * 0.46 }}>{trait.name.slice(0, 1)}</span>
      )}
    </span>
  )
}
