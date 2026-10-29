import { cell, colOf, rowOf } from '@/engine/hex.ts'
import { clean } from '@/engine/patch.ts'
import type { Boards, GameSet, Overrides, Piece, Star } from '@/engine/types.ts'
import { gameIds } from './comps.ts'

// What you're working on, per set: the units on the board and two layers of numbers on top of the set: live (the game
// as it is, corrected where the set is wrong) and patch (the change you're trying). Kept in this browser, and packed
// into a link to share. A document names its set by entry (lib/sets.ts): "tft" is whatever TFT set is current.

export type Layer = 'live' | 'patch'
export interface Space {
  pieces: Piece[]
  live: Overrides
  patch: Overrides
}
export interface Doc {
  set: string
  fights: number
  spaces: Record<string, Space>
}

export const FIGHTS = [1000, 5000, 20000] as const
export const SEED = 20261026
export const MAX_ITEMS = 3

export const emptySpace = (): Space => ({ pieces: [], live: {}, patch: {} })
export const sampleSpace = (set: GameSet): Space => ({ ...emptySpace(), pieces: set.sample ? [...set.sample.blue, ...set.sample.red].map((p) => ({ ...p, items: [...p.items] })) : [] })

export const cellOf = (p: Piece) => cell(p.row, p.col)
export const pieceAt = (s: Space, c: number) => s.pieces.find((p) => cellOf(p) === c)
export const sideOfCell = (c: number): 0 | 1 => (rowOf(c) >= 4 ? 0 : 1)

/** The two boards the engine fights, each in cell order (results list units the same way) */
export function boardsOf(s: Space): Boards {
  const sorted = [...s.pieces].sort((a, b) => cellOf(a) - cellOf(b))
  return { blue: sorted.filter((p) => p.row >= 4), red: sorted.filter((p) => p.row < 4) }
}

export type Action =
  | { type: 'place'; unit: string; cell: number; star?: Star }
  | { type: 'move'; from: number; to: number }
  | { type: 'remove'; cell: number }
  | { type: 'star'; cell: number; star: Star }
  | { type: 'equip'; cell: number; item: string }
  | { type: 'unequip'; cell: number; slot: number }
  | { type: 'value'; layer: Layer; path: string; value: number | null }
  | { type: 'reset'; layer?: Layer; prefix?: string }
  | { type: 'clear'; side?: 0 | 1 }
  | { type: 'swap' }
  | { type: 'side'; side: 0 | 1; pieces: Piece[] }
  | { type: 'mirror'; from: 0 | 1 }
  | { type: 'space'; space: Space }

const at = (c: number) => ({ row: rowOf(c), col: colOf(c) })

/** One change to the space you're working on. The set is needed to drop numbers equal to the ones below them. */
export function change(s: Space, a: Action, set: GameSet): Space {
  switch (a.type) {
    case 'place': {
      const pieces = s.pieces.filter((p) => cellOf(p) !== a.cell)
      return { ...s, pieces: [...pieces, { unit: a.unit, star: a.star ?? 1, items: [], ...at(a.cell) }] }
    }
    case 'move': {
      if (a.from === a.to) return s
      const moving = pieceAt(s, a.from), there = pieceAt(s, a.to)
      if (!moving) return s
      return { ...s, pieces: s.pieces.map((p) => (p === moving ? { ...p, ...at(a.to) } : p === there ? { ...p, ...at(a.from) } : p)) }
    }
    case 'remove':
      return { ...s, pieces: s.pieces.filter((p) => cellOf(p) !== a.cell) }
    case 'star':
      return { ...s, pieces: s.pieces.map((p) => (cellOf(p) === a.cell ? { ...p, star: a.star } : p)) }
    case 'equip':
      return { ...s, pieces: s.pieces.map((p) => (cellOf(p) === a.cell && p.items.length < MAX_ITEMS ? { ...p, items: [...p.items, a.item] } : p)) }
    case 'unequip':
      return { ...s, pieces: s.pieces.map((p) => (cellOf(p) === a.cell ? { ...p, items: p.items.filter((_, i) => i !== a.slot) } : p)) }
    case 'value': {
      const layer = { ...s[a.layer] }
      if (a.value === null || !Number.isFinite(a.value)) delete layer[a.path]
      else layer[a.path] = a.value
      const next = { ...s, [a.layer]: layer }
      // Live numbers sit under the patch: a patch number that now equals live is no change any more
      return { ...next, live: clean(set, next.live), patch: clean(set, next.patch, next.live) }
    }
    case 'reset': {
      // One layer or both, everything or only the numbers under a prefix ("u.squire.e0": that effect)
      const keep = (o: Overrides) => (a.prefix ? Object.fromEntries(Object.entries(o).filter(([k]) => !(k === a.prefix || k.startsWith(`${a.prefix}.`)))) : {})
      const live = !a.layer || a.layer === 'live' ? keep(s.live) : s.live
      const patch = !a.layer || a.layer === 'patch' ? keep(s.patch) : s.patch
      return { ...s, live, patch: clean(set, patch, live) }
    }
    case 'clear':
      return { ...s, pieces: a.side === undefined ? [] : s.pieces.filter((p) => sideOfCell(cellOf(p)) !== a.side) }
    case 'swap':
      // Blue's board becomes red's and the other way round, turned to face the other side
      return { ...s, pieces: s.pieces.map((p) => ({ ...p, row: 7 - p.row, col: 6 - p.col })) }
    case 'side': {
      // A whole side at once (a comp): what was there goes, the new pieces must stand on that side
      const keep = s.pieces.filter((p) => sideOfCell(cellOf(p)) !== a.side)
      const add = a.pieces.filter((p) => sideOfCell(cellOf(p)) === a.side).map((p) => ({ ...p, items: p.items.slice(0, MAX_ITEMS) }))
      return { ...s, pieces: [...keep, ...add] }
    }
    case 'mirror': {
      // One side's board on the other too, turned around: a mirror match
      const from = s.pieces.filter((p) => sideOfCell(cellOf(p)) === a.from)
      return { ...s, pieces: [...from, ...from.map((p) => ({ ...p, items: [...p.items], row: 7 - p.row, col: 6 - p.col }))] }
    }
    case 'space':
      return a.space
  }
}

/* ── Saving in this browser ─────────────────────────────── */

const KEY = 'patchlab:v2'

export function loadDoc(): Doc | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Doc
    return d && typeof d.set === 'string' && typeof d.spaces === 'object' ? { set: d.set, fights: FIGHTS.includes(d.fights as never) ? d.fights : 5000, spaces: d.spaces } : null
  } catch {
    return null
  }
}

export function saveDoc(d: Doc) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* private mode or full: the session still works, it just isn't kept */
  }
}

export function loadCustom(): unknown {
  try {
    const raw = localStorage.getItem(`${KEY}:custom`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
export function saveCustom(set: GameSet | null) {
  try {
    if (set) localStorage.setItem(`${KEY}:custom`, JSON.stringify(set))
    else localStorage.removeItem(`${KEY}:custom`)
  } catch {
    /* too big for this browser's storage: it lasts until the tab closes */
  }
}

/* ── Links ──────────────────────────────────────────────── */

/** What a link carries: the set, the boards, both layers of numbers and, for your own set, the set itself */
interface Shared {
  v: 1
  s: string
  p: (string | number)[][]
  l: Overrides
  q: Overrides
  n: number
  c?: unknown
}

const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

/** The setup as a link code. `setId` is the set's own id (tft18), so a link says which set it was made on. */
export async function encodeLink(doc: Doc, setId: string, custom: GameSet | null): Promise<string> {
  const s = doc.spaces[doc.set] ?? emptySpace()
  const shared: Shared = {
    v: 1, s: setId, n: doc.fights, l: s.live, q: s.patch,
    p: s.pieces.map((p) => [p.unit, p.star, cellOf(p), ...p.items]),
    ...(doc.set === 'custom' && custom ? { c: custom } : {}),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(shared))
  if (typeof CompressionStream === 'function') return `z${b64(await pipe(bytes, new CompressionStream('deflate-raw')))}`
  return `j${b64(bytes)}`
}

export async function decodeLink(code: string): Promise<{ set: string; fights: number; space: Space; custom?: unknown } | null> {
  try {
    const bytes = code[0] === 'z' ? await pipe(unb64(code.slice(1)), new DecompressionStream('deflate-raw')) : code[0] === 'j' ? unb64(code.slice(1)) : null
    if (!bytes) return null
    const d = JSON.parse(new TextDecoder().decode(bytes)) as Shared
    if (d.v !== 1 || typeof d.s !== 'string' || !Array.isArray(d.p)) return null
    const seen = new Set<number>()
    const pieces: Piece[] = d.p.flatMap((row) => {
      const [unit, star, c, ...items] = row
      if (typeof unit !== 'string' || typeof c !== 'number' || c < 0 || c >= 56 || seen.has(c)) return []
      seen.add(c)
      return [{ unit, star: Math.min(3, Math.max(1, Number(star) || 1)) as Star, items: items.map(String).slice(0, MAX_ITEMS), ...at(c) }]
    })
    const nums = (o: unknown): Overrides => Object.fromEntries(Object.entries(typeof o === 'object' && o ? o : {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))
    return { set: d.s, fights: FIGHTS.includes(d.n as never) ? d.n : 5000, space: { pieces, live: nums(d.l), patch: nums(d.q) }, ...(d.c ? { custom: d.c } : {}) }
  } catch {
    return null
  }
}

/**
 * Fits a space to a set: units and items named by the game's own ids (a MetaForge link) become the set's, and
 * whatever the set doesn't have (a link or a save from another version of it) is dropped
 */
export function fit(space: Space, set: GameSet): Space {
  const ids = gameIds(set)
  return {
    pieces: space.pieces
      .filter((p) => ids.unit(p.unit))
      .map((p) => ({ ...p, unit: ids.unit(p.unit)!, items: p.items.map((i) => ids.item(i)).filter((i): i is string => !!i).slice(0, MAX_ITEMS) })),
    live: clean(set, space.live),
    patch: clean(set, space.patch, clean(set, space.live)),
  }
}

/** A side left empty (a board shared from a team builder) gets the set's sample board, so there's a fight to run */
export function withOpponent(space: Space, set: GameSet): { space: Space; filled: 0 | 1 | null } {
  if (!set.sample) return { space, filled: null }
  const has = (side: 0 | 1) => space.pieces.some((p) => (p.row >= 4 ? 0 : 1) === side)
  if (has(0) === has(1)) return { space, filled: null }
  const side: 0 | 1 = has(0) ? 1 : 0
  const extra = (side ? set.sample.red : set.sample.blue).map((p) => ({ ...p, items: [...p.items] }))
  return { space: { ...space, pieces: [...space.pieces, ...extra] }, filled: side }
}
