'use client'

import { memo, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cell as cellAt, CELLS, colOf, rowOf } from '@/engine/hex.ts'
import { COLS, ROWS, type GameSet, type Piece } from '@/engine/types.ts'
import { onSide } from '@/lib/comps.ts'
import { iconUrl } from '@/lib/sets.ts'
import { cellOf, sideOfCell, type Space } from '@/lib/state.ts'
import { useDrag } from './drag.tsx'
import { Art, hexPath, TokenShape, UnitToken } from './token.tsx'

// The board: 8 rows of 7 hexes, red's half on top, blue's below, odd rows shifted half a hex to the right

export const R = 40
const W = Math.sqrt(3) * R
const PAD = 3
export const BOARD_W = W * (COLS + 0.5) + PAD * 2
export const BOARD_H = R * 2 + 1.5 * R * (ROWS - 1) + PAD * 2
export const centerOf = (c: number) => {
  const row = rowOf(c), col = colOf(c)
  return { x: PAD + W * (col + 0.5 + (row & 1) * 0.5), y: PAD + R + row * 1.5 * R }
}
const CELL_D = Array.from({ length: CELLS }, (_, c) => { const { x, y } = centerOf(c); return hexPath(x, y, R * 0.95, R * 0.17) })
const MID_Y = PAD + R + 3.5 * 1.5 * R

export type Armed = { kind: 'unit'; id: string } | { kind: 'item'; id: string } | null

interface BoardProps {
  set: GameSet
  space: Space
  selected: number | null
  armed: Armed
  /** Units whose numbers the patch changes: they wear a marker dot */
  patched: Set<string>
  /** A hex clicked or tapped, and with what: a tap on an empty hex moves the selected unit there, a click lets go of it */
  onCell: (cell: number, pointer: string) => void
  onRemove: (cell: number) => void
  /** Drawn over the board instead of the units, while a fight plays */
  overlay?: ReactNode
  label: string
}

export const Board = memo(function Board({ set, space, selected, armed, patched, onCell, onRemove, overlay, label }: BoardProps) {
  const { drag, begin } = useDrag()
  const [focus, setFocus] = useState(() => cellAt(4, 3))
  const [hover, setHover] = useState<number | null>(null)
  const pointer = useRef('mouse')
  const uid = useId().replace(/:/g, '')
  const units = useMemo(() => new Map(set.units.map((u) => [u.id, u])), [set])
  const items = useMemo(() => new Map(set.items.map((i) => [i.id, i])), [set])
  const byCell = useMemo(() => new Map(space.pieces.map((p) => [cellOf(p), p])), [space.pieces])

  // What a drag would do where it is now
  const over = drag?.over ?? null
  const kind = drag?.payload.kind
  const compSide = kind === 'comp' && over !== null ? sideOfCell(over) : null
  const compGhost = useMemo(() => (drag?.payload.kind === 'comp' && compSide !== null ? onSide(drag.payload.comp, compSide) : null), [drag, compSide])
  const unitGhost = (() => {
    if (over === null || overlay) return null
    if (kind === 'unit' && drag?.payload.kind === 'unit') return { unit: drag.payload.unit, cell: over }
    if (kind === 'piece' && drag?.payload.kind === 'piece' && drag.payload.cell !== over) { const p = byCell.get(drag.payload.cell); return p ? { unit: p.unit, cell: over } : null }
    if (!drag && armed?.kind === 'unit' && hover !== null && !byCell.has(hover)) return { unit: armed.id, cell: hover }
    return null
  })()
  const itemTarget = (kind === 'item' && over !== null && byCell.has(over) ? over : null) ?? (!drag && armed?.kind === 'item' && hover !== null && byCell.has(hover) ? hover : null)

  const keys = (e: KeyboardEvent) => {
    const row = rowOf(focus), col = colOf(focus)
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (moves[e.key]) {
      e.preventDefault()
      const r = Math.min(ROWS - 1, Math.max(0, row + moves[e.key][0])), k = Math.min(COLS - 1, Math.max(0, col + moves[e.key][1]))
      setFocus(cellAt(r, k))
      requestAnimationFrame(() => document.getElementById(`${uid}-${cellAt(r, k)}`)?.focus())
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCell(focus, 'keyboard')
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && byCell.has(focus)) {
      e.preventDefault()
      onRemove(focus)
    }
  }

  const describe = (c: number) => {
    const p = byCell.get(c), blue = rowOf(c) >= 4, n = blue ? rowOf(c) - 3 : 4 - rowOf(c)
    const u = p && units.get(p.unit)
    const where = `${blue ? 'Blue' : 'Red'}, ${n === 1 ? 'front row' : n === 4 ? 'back row' : `row ${n} from the front`}, column ${colOf(c) + 1}`
    return `${where}: ${u ? `${u.name}, ${p.star} star${p.star > 1 ? 's' : ''}${p.items.length ? `, ${p.items.map((i) => items.get(i)?.name ?? i).join(', ')}` : ''}` : 'empty'}`
  }

  return (
    <svg
      data-board
      viewBox={`0 0 ${BOARD_W.toFixed(1)} ${BOARD_H.toFixed(1)}`}
      className="block h-auto w-full select-none"
      role="grid"
      aria-label={label}
      onKeyDown={overlay ? undefined : keys}
    >
      <defs>
        <filter id={`${uid}-lift`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.8" floodOpacity="0.28" />
        </filter>
      </defs>
      {Array.from({ length: CELLS }, (_, c) => {
        const red = rowOf(c) < 4, side = red ? 1 : 0
        const lit = (compSide !== null && compSide === side) || (over === c && (kind === 'unit' || kind === 'piece')) || (!drag && armed?.kind === 'unit' && hover === c && !overlay)
        return <path key={c} d={CELL_D[c]} className={red ? 'cell-red' : 'cell-blue'} data-lit={lit || undefined} />
      })}
      <line x1={PAD + 6} x2={BOARD_W - PAD - 6} y1={MID_Y} y2={MID_Y} className="stroke-line-strong" strokeWidth={1} strokeDasharray="2 5" strokeLinecap="round" />
      {overlay ?? (
        <g>
          {Array.from({ length: CELLS }, (_, c) => {
            const p = byCell.get(c), u = p && units.get(p.unit), { x, y } = centerOf(c)
            const dragged = drag?.payload.kind === 'piece' && drag.payload.cell === c
            const covered = compSide !== null && sideOfCell(c) === compSide
            return (
              <g
                key={c}
                id={`${uid}-${c}`}
                data-cell={c}
                role="gridcell"
                aria-label={describe(c)}
                aria-selected={selected === c}
                tabIndex={focus === c ? 0 : -1}
                onFocus={() => setFocus(c)}
                onClick={() => onCell(c, pointer.current)}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(c)}
                onPointerLeave={() => setHover((h) => (h === c ? null : h))}
                onPointerDown={(e) => { pointer.current = e.pointerType; if (p && u) begin(e, { kind: 'piece', cell: c }, <UnitToken set={set} unit={u} size={64} className="drop-shadow-lg" />) }}
                className="cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100"
                style={p ? { touchAction: 'none' } : undefined}
              >
                <path d={CELL_D[c]} fill="transparent" />
                <path className="ring opacity-0" d={CELL_D[c]} fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 3" />
                {p && u && (
                  <PieceShape set={set} piece={p} x={x} y={y} selected={selected === c} dim={dragged || covered} target={itemTarget === c} patched={patched.has(p.unit)} lift={`url(#${uid}-lift)`} clipId={`${uid}-c${c}`} items={items} />
                )}
                {u && <title>{u.name}</title>}
              </g>
            )
          })}
          {unitGhost && <Ghost set={set} unit={unitGhost.unit} cell={unitGhost.cell} />}
          {compGhost?.map((p) => <Ghost key={cellOf(p)} set={set} unit={p.unit} cell={cellOf(p)} />)}
        </g>
      )}
    </svg>
  )
})

function Ghost({ set, unit, cell }: { set: GameSet; unit: string; cell: number }) {
  const u = set.units.find((v) => v.id === unit)
  if (!u) return null
  const { x, y } = centerOf(cell)
  return (
    <g opacity={0.55} style={{ pointerEvents: 'none' }}>
      <TokenShape set={set} unit={u} cx={x} cy={y} r={R * 0.84} clipId={`ghost-${cell}-${unit}`} />
    </g>
  )
}

const STAR_FILL = ['var(--star-1)', 'var(--star-2)', 'var(--star-3)']

function PieceShape({ set, piece, x, y, selected, dim, target, patched, lift, clipId, items }: { set: GameSet; piece: Piece; x: number; y: number; selected: boolean; dim: boolean; target: boolean; patched: boolean; lift: string; clipId: string; items: Map<string, GameSet['items'][number]> }) {
  const u = set.units.find((v) => v.id === piece.unit)!
  const held = piece.items.map((i) => items.get(i)).filter((i) => !!i)
  const size = R * 0.38, gap = 2, row = held.length * size + (held.length - 1) * gap
  return (
    <g opacity={dim ? 0.3 : 1} style={{ pointerEvents: 'none' }}>
      {(selected || target) && <path d={hexPath(x, y, R * 0.98, R * 0.17)} fill="none" stroke="var(--ink)" strokeWidth={target ? 2 : 2.6} strokeDasharray={target ? '4 3' : undefined} />}
      <g filter={lift}>
        <TokenShape set={set} unit={u} cx={x} cy={y} r={R * 0.84} clipId={clipId} />
      </g>
      <Stars n={piece.star} x={x} y={y - R * 0.84} />
      {patched && (
        <g>
          <circle cx={x + R * 0.66} cy={y - R * 0.5} r={5.4} className="fill-panel" />
          <circle cx={x + R * 0.66} cy={y - R * 0.5} r={4} style={{ fill: 'var(--mark-solid)' }} />
        </g>
      )}
      {held.map((it, i) => {
        const ix = x - row / 2 + i * (size + gap), iy = y + R * 0.5, src = iconUrl(set, it.icon)
        return (
          <g key={i}>
            <rect x={ix - 1.4} y={iy - 1.4} width={size + 2.8} height={size + 2.8} rx={4.2} className="fill-panel" />
            <rect x={ix} y={iy} width={size} height={size} rx={3.2} className="fill-raised" />
            <text x={ix + size / 2} y={iy + size / 2 + 0.3} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.55} fontWeight={700} className="fill-soft">{it.name.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase()}</text>
            {src && (
              <>
                <clipPath id={`${clipId}-i${i}`}><rect x={ix} y={iy} width={size} height={size} rx={3.2} /></clipPath>
                <Art href={src} x={ix} y={iy} width={size} height={size} clipPath={`url(#${clipId}-i${i})`} />
              </>
            )}
          </g>
        )
      })}
    </g>
  )
}

export function Stars({ n, x, y }: { n: number; x: number; y: number }) {
  const w = 8, total = n * w + 5
  return (
    <g transform={`translate(${x - total / 2} ${y - 6})`}>
      <rect width={total} height={12} rx={6} className="fill-panel" />
      {Array.from({ length: n }, (_, i) => (
        <path key={i} transform={`translate(${2.5 + i * w} 1.6) scale(0.86)`} d="M5 .6l1.3 2.8 3 .3-2.3 2 .7 3L5 7.2 2.3 8.7l.7-3-2.3-2 3-.3z" style={{ fill: STAR_FILL[n - 1] }} />
      ))}
    </g>
  )
}
