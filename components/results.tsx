'use client'

import { memo, useState } from 'react'
import { shift, type Paired, type Tally } from '@/engine/batch.ts'
import { OUT } from '@/engine/fight.ts'
import type { GameSet, Star } from '@/engine/types.ts'
import { change, count, num, pct, seconds, signed } from '@/lib/format.ts'
import { Portrait } from './token.tsx'
import { cx, Segmented } from './ui.tsx'

export interface RunResult {
  /** The setup it ran on, to tell when it no longer matches the board */
  key: string
  fights: number
  done: number
  ms: number
  running: boolean
  /** The fighters, in the engine's order */
  units: { unit: string; name: string; star: Star; side: 0 | 1 }[]
  paired: Paired
}

const rate = (t: Tally, k: 0 | 1 | -1) => (t.fights ? (k === -1 ? t.draws : t.wins[k]) / t.fights : 0)

/** The headline, next to the run button: how often blue wins, live and patched, and how sure the change is */
export const Summary = memo(function Summary({ result, stale, hasPatch }: { result: RunResult | null; stale: boolean; hasPatch: boolean }) {
  if (!result) return <p className="text-[13px] text-pretty text-muted">{hasPatch ? 'Run to fight live against your patch, seed for seed.' : 'Run to see how often each side wins.'}</p>
  const { live, patch } = result.paired
  const s = shift(result.paired)
  const clear = s && Math.abs(s.delta) > s.margin && Math.abs(s.delta) >= 0.05
  return (
    <div aria-live="polite" className={cx('flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 transition-opacity', stale && !result.running && 'opacity-50')}>
      <span className="text-[13px] text-soft">Blue wins</span>
      <span className="font-display text-[28px] leading-none font-[560] tracking-[-0.01em] text-ink tabular-nums">{pct(rate(live, 0))}</span>
      {patch && (
        <>
          <span aria-label="becomes" className="text-lg leading-none text-muted">→</span>
          <span className="rounded-md bg-mark px-1.5 font-display text-[28px] leading-tight font-[560] tracking-[-0.01em] text-mark-ink tabular-nums">{pct(rate(patch, 0))}</span>
          {s && (
            <span className="text-[13px] text-soft tabular-nums">
              <span className="font-semibold text-ink">{signed(s.delta)} pts</span> ±{num(s.margin, 1)}
              <span className="ml-1.5 text-muted">{result.running ? 'counting…' : stale ? 'changed since: run again' : clear ? 'a clear change' : 'within the noise'}</span>
            </span>
          )}
        </>
      )}
      {stale && !result.running && !s && <span className="text-xs text-muted">Changed since: run again</span>}
    </div>
  )
})

type Metric = 'dealt' | 'taken' | 'support' | 'alive'
const METRICS: { value: Metric; label: string; title: string }[] = [
  { value: 'dealt', label: 'Damage', title: 'Damage dealt per fight, after resistances' },
  { value: 'taken', label: 'Taken', title: 'Damage taken per fight, shields included' },
  { value: 'support', label: 'Healing', title: 'Healing and shields given per fight' },
  { value: 'alive', label: 'Survival', title: 'How often the unit is still standing at the end' },
]
const read = (t: Tally, i: number, m: Metric) => {
  const o = i * OUT, n = Math.max(1, t.fights)
  if (m === 'dealt') return t.units[o] / n
  if (m === 'taken') return t.units[o + 1] / n
  if (m === 'support') return (t.units[o + 2] + t.units[o + 3]) / n
  return t.units[o + 5] / n
}

/** Under the board after a run: the split of wins, and what each unit did, live and patched */
export const Results = memo(function Results({ set, result, stale }: { set: GameSet; result: RunResult; stale: boolean }) {
  const [metric, setMetric] = useState<Metric>('dealt')
  const { live, patch } = result.paired
  const max = Math.max(1e-9, ...result.units.flatMap((_, i) => [read(live, i, metric), patch ? read(patch, i, metric) : 0]))
  const units = new Map(set.units.map((u) => [u.id, u]))
  const show = (v: number) => (metric === 'alive' ? pct(v, 0) : num(v))
  const moved = (i: number) => {
    if (!patch) return null
    const a = read(live, i, metric), b = read(patch, i, metric)
    return metric === 'alive' ? (b - a) * 100 : change(a, b) * 100
  }
  return (
    <section aria-label="Results" className={cx('transition-opacity', stale && !result.running && 'opacity-60')}>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
        <span className="text-xs text-muted">Live</span>
        <Split t={live} />
        {patch && <><span className="text-xs text-muted">Patch</span><Split t={patch} /></>}
      </div>
      <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-soft">
        <Stat label="Red wins" from={pct(rate(live, 1))} to={patch && pct(rate(patch, 1))} />
        <Stat label="Draws" from={pct(rate(live, -1))} to={patch && pct(rate(patch, -1))} />
        <Stat label="Fights last" from={seconds(live.time / Math.max(1, live.fights))} to={patch && seconds(patch.time / Math.max(1, patch.fights))} />
        <div className="text-muted tabular-nums">
          {result.running ? `${count(result.done)} of ${count(result.fights)} fights` : result.done < result.fights ? `Stopped after ${count(result.done)} of ${count(result.fights)}` : `${count(result.fights)} fights${patch ? ' each, same seeds' : ''} in ${num(result.ms / 1000, 1)} s`}
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-[20px] leading-none text-ink">Unit by unit</h2>
        <Segmented size="sm" label="Measure" value={metric} onChange={setMetric} options={METRICS} />
        {patch && (
          <span className="flex gap-3 text-xs text-soft">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-[2px] bg-live-bar" />Live</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-[2px] bg-patch-bar" />Patch</span>
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{METRICS.find((m) => m.value === metric)?.title}.</p>
      <div className="mt-3 grid gap-x-8 gap-y-5 @[46rem]:grid-cols-2">
        {([0, 1] as const).map((side) => (
          <div key={side}>
            <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <span className={cx('size-2.5 rounded-full', side ? 'bg-red' : 'bg-blue')} />
              {side ? 'Red' : 'Blue'}
            </h3>
            <ul className="flex flex-col">
              {result.units.map((f, i) => {
                if (f.side !== side) return null
                const u = units.get(f.unit), a = read(live, i, metric), b = patch ? read(patch, i, metric) : null, d = moved(i)
                return (
                  <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)_4.25rem_2.75rem] items-center gap-x-2.5 border-b border-line py-1.5 last:border-0">
                    {u ? <Portrait set={set} unit={u} size={28} /> : <span />}
                    <div className="min-w-0">
                      <p className="truncate text-[13px] leading-tight font-medium text-ink">{f.name} <span className="text-[11px] font-normal text-muted">{'★'.repeat(f.star)}</span></p>
                      <Bar value={a} max={max} tone="live" />
                      {b !== null && <Bar value={b} max={max} tone="patch" />}
                    </div>
                    <span className="text-right text-[13px] leading-tight text-ink tabular-nums">
                      {show(b ?? a)}
                      {b !== null && <span className="block text-[11px] text-muted">{show(a)}</span>}
                    </span>
                    <span className={cx('text-right text-xs tabular-nums', d === null || !Number.isFinite(d) || Math.abs(d) < 0.5 ? 'text-muted' : 'font-semibold text-ink')}>
                      {d !== null && Number.isFinite(d) && Math.abs(d) >= 0.5 ? `${signed(d, 0)}${metric === 'alive' ? 'pt' : '%'}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
})

function Stat({ label, from, to }: { label: string; from: string; to?: string | null }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}</dt>
      <dd className="text-ink tabular-nums">{from}{to && to !== from ? <> <span className="text-muted">→</span> {to}</> : null}</dd>
    </div>
  )
}

/** Blue wins, draws and red wins as one bar */
function Split({ t }: { t: Tally }) {
  const b = rate(t, 0), d = rate(t, -1), r = rate(t, 1)
  const seg = (share: number, cls: string, title: string) => share > 0 && <span title={title} className={cx('h-full', cls)} style={{ flexGrow: share, flexBasis: 0 }} />
  return (
    <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[4px]" role="img" aria-label={`Blue ${pct(b)}, draws ${pct(d)}, red ${pct(r)}`}>
      {seg(b, 'bg-blue', `Blue wins ${pct(b)}`)}
      {seg(d, 'bg-line-strong', `Draws ${pct(d)}`)}
      {seg(r, 'bg-red', `Red wins ${pct(r)}`)}
      {!t.fights && <span className="h-full flex-1 bg-sunk" />}
    </div>
  )
}

function Bar({ value, max, tone }: { value: number; max: number; tone: 'live' | 'patch' }) {
  return (
    <div className="mt-1 h-1.5">
      <div className={cx('h-full rounded-r-[3px]', tone === 'live' ? 'bg-live-bar' : 'bg-patch-bar')} style={{ width: `${Math.max(0.6, (value / max) * 100)}%` }} />
    </div>
  )
}
