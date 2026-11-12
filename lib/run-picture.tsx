// A shared run, read on the server: what its link picture shows (app/opengraph-image-run) and what its page says about it
// (app/run). The code is the one the Share button makes (lib/state.ts), unpacked here with Node's own inflate.
import type { ReactElement, ReactNode } from 'react'
import { inflateRawSync } from 'node:zlib'
import { patchNotes } from '@/engine/patch.ts'
import type { GameSet, Piece } from '@/engine/types.ts'
import { iconUrl, readSet } from '@/lib/sets.ts'
import { boardsOf, fit, readShared, type Opened } from '@/lib/state.ts'
import { SANDBOX } from '@/sets/sandbox.ts'
import snapshot from '@/sets/tft-snapshot.json'
import { num, pct, signed } from './format.ts'

export const PICTURE = { width: 1200, height: 630 }
/** Longer codes (your own set inside the link) get the site's own picture: a picture's address must stay short */
export const PICTURE_MAX = 3000

const INK = { night: '#0f0d0b', panel: '#161411', sunk: '#1d1a16', raised: '#2a251f', ink: '#f1e9d8', soft: '#b8ab94', muted: '#857a68', gold: '#e2b86a', blue: '#6b9ef0', red: '#e06e5c' }
const COST = ['#a3a9af', '#a3a9af', '#4fb07c', '#4f93d8', '#b16ad6', '#deb04e']

/** The code of a link, unpacked and checked; null when it can't be read */
export function openCode(code: string): Opened | null {
  try {
    if (!/^[zj][A-Za-z0-9_-]+$/.test(code) || code.length > 20000) return null
    const raw = Buffer.from(code.slice(1).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const bytes = code[0] === 'z' ? inflateRawSync(raw, { maxOutputLength: 2_000_000 }) : raw
    return readShared(JSON.parse(bytes.toString('utf8')))
  } catch {
    return null
  }
}

let current: GameSet | null | undefined
/** The set a link was made on, when this site has it: the current TFT set, the sandbox, or your own set inside the link */
function setOf(o: Opened): GameSet | null {
  if (o.set === SANDBOX.id) return SANDBOX
  if (o.custom) { try { return readSet(o.custom).set } catch { return null } }
  if (current === undefined) { try { current = snapshot ? readSet(snapshot).set : null } catch { current = null } }
  return current && current.id === o.set ? current : null
}

export interface Run {
  set: GameSet | null
  pieces: Piece[]
  /** the numbers the patch changed, in words */
  changes: { name: string; field: string; from: string; to: string }[]
  run: Opened['run']
  title: string
  text: string
}

const shown = (v: number, pctField?: boolean) => (pctField ? `${num(v * 100, 1)}%` : num(v, 2))

/** What a link holds, ready to show: the boards, the change, the run, and a title and a line for the page */
export function readRun(code: string): Run | null {
  const o = openCode(code)
  if (!o) return null
  const set = setOf(o)
  const space = set ? fit(o.space, set) : o.space
  const changes = set ? patchNotes(set, space.live, space.patch).map((n) => ({ name: n.name, field: n.field, from: shown(n.from, n.meta?.pct), to: shown(n.to, n.meta?.pct) })) : []
  const r = o.run
  const change = changes[0] ? `${changes[0].name}, ${changes[0].field.toLowerCase()} ${changes[0].from} to ${changes[0].to}${changes.length > 1 ? ` and ${changes.length - 1} more change${changes.length > 2 ? 's' : ''}` : ''}` : ''
  const title = r ? (r.patch !== null ? `Blue wins ${pct(r.live)} → ${pct(r.patch)}` : `Blue wins ${pct(r.live)}`) : 'A Patchlab setup'
  const fights = r?.fights ? `${num(r.fights)} simulated fights${r.patch !== null ? ' each, on the same seeds' : ''}` : ''
  const text = [change && `${change}.`, fights && `${fights}.`, r ? 'Open it in Patchlab to run it again or change it.' : 'Open it in Patchlab to run it.'].filter(Boolean).join(' ')
  return { set, pieces: space.pieces, changes, run: r, title, text }
}

/** A portrait as a data URL, or null when CommunityDragon doesn't answer in time (the unit is drawn by its name then) */
async function portrait(url: string | undefined): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return null
    return `data:${res.headers.get('content-type') ?? 'image/png'};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch {
    return null
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The two boards as the lab draws them: red's half on top, blue's below, odd rows half a hex to the right */
function Boards({ set, pieces, icons }: { set: GameSet | null; pieces: Piece[]; icons: Map<string, string | null> }) {
  const W = 66, H = 58, R = 27, out: ReactNode[] = []
  const units = new Map((set?.units ?? []).map((u) => [u.id, u]))
  const at = new Map(pieces.map((p) => [p.row * 7 + p.col, p]))
  for (let c = 0; c < 56; c++) {
    const row = Math.floor(c / 7), col = c % 7, p = at.get(c), u = p ? units.get(p.unit) : undefined
    const x = col * W + (row % 2 ? W / 2 : 0), y = row * H + (row >= 4 ? 18 : 0), red = row < 4
    const icon = p ? icons.get(p.unit) ?? null : null
    out.push(
      <div key={c} style={{ position: 'absolute', left: x, top: y, width: R * 2, height: R * 2, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, overflow: 'hidden',
        background: p ? INK.raised : red ? 'rgba(224,110,92,0.08)' : 'rgba(107,158,240,0.08)', border: p ? `3px solid ${COST[u?.cost ?? 1] ?? COST[1]}` : `2px solid ${red ? 'rgba(224,110,92,0.16)' : 'rgba(107,158,240,0.16)'}`,
        color: INK.ink, fontSize: 15, fontWeight: 600 }}>
        {p ? icon ? <img src={icon} width={R * 2} height={R * 2} alt="" style={{ objectFit: 'cover' }} /> : clip(u?.name ?? p.unit, 6) : null}
      </div>,
    )
    if (p && p.star > 1)
      out.push(
        <div key={`s${c}`} style={{ position: 'absolute', left: x + R - 6 * p.star, top: y - 7, display: 'flex', gap: 2 }}>
          {Array.from({ length: p.star }, (_, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 999, background: INK.gold, border: `2px solid ${INK.night}` }} />)}
        </div>,
      )
  }
  return <div style={{ position: 'relative', display: 'flex', width: 7.5 * W, height: 8 * H + 18 }}>{out}</div>
}

/** The picture: the two boards on the left; how often blue won, before and after, and the change on the right */
export async function runPicture(run: Run | null): Promise<ReactElement> {
  const icons = new Map<string, string | null>()
  if (run?.set) {
    const ids = [...new Set(run.pieces.map((p) => p.unit))].slice(0, 24)
    const got = await Promise.all(ids.map((id) => portrait(iconUrl(run.set!, run.set!.units.find((u) => u.id === id)?.icon))))
    ids.forEach((id, i) => icons.set(id, got[i]))
  }
  const r = run?.run
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: INK.night, color: INK.ink, padding: '44px 52px' }}>
      {run && <Boards set={run.set} pieces={run.pieces} icons={icons} />}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 44, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 26, fontWeight: 700, color: INK.gold }}>Patchlab<span style={{ color: INK.muted, fontWeight: 400, fontSize: 20 }}>{run?.set?.id.startsWith('tft') ? 'a TFT simulation' : 'a simulation'}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {r ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', fontSize: 24, color: INK.soft }}>Blue wins</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, fontSize: 76, fontWeight: 700, lineHeight: 1 }}>
                <span>{pct(r.live)}</span>
                {r.patch !== null && <span style={{ fontSize: 44, color: INK.muted }}>→</span>}
                {r.patch !== null && <span style={{ color: INK.gold }}>{pct(r.patch)}</span>}
              </div>
              {r.delta !== null && <div style={{ display: 'flex', fontSize: 24, color: INK.soft }}>{`${signed(r.delta)} points${r.margin !== null ? `, ±${num(r.margin, 1)}` : ''}`}</div>}
            </div>
          ) : (
            <div style={{ display: 'flex', fontSize: 52, fontWeight: 700, lineHeight: 1.1 }}>{run ? 'A setup to fight' : 'Patchlab'}</div>
          )}
          {run?.changes.slice(0, 2).map((c) => (
            <div key={`${c.name}${c.field}`} style={{ display: 'flex', flexWrap: 'wrap', fontSize: 24, gap: 8 }}>
              <span style={{ fontWeight: 700 }}>{clip(c.name, 22)}</span><span style={{ color: INK.soft }}>{clip(c.field, 28)}</span>
              <span>{c.from}</span><span style={{ color: INK.muted }}>→</span><span style={{ color: INK.gold, fontWeight: 700 }}>{c.to}</span>
            </div>
          ))}
          {run && run.changes.length > 2 && <div style={{ display: 'flex', fontSize: 20, color: INK.muted }}>{`and ${run.changes.length - 2} more`}</div>}
        </div>
        <div style={{ display: 'flex', fontSize: 20, color: INK.muted }}>{r?.fights ? `${num(r.fights)} fights${r.patch !== null ? ' each, same seeds' : ''} · patchlab.metaforge.lol` : 'patchlab.metaforge.lol'}</div>
      </div>
    </div>
  )
}
