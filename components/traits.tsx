'use client'

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { activeTraits, type ActiveTrait } from '@/engine/prepare.ts'
import type { GameSet, Piece } from '@/engine/types.ts'
import { TraitBadge, tierOf } from './token.tsx'
import { cx, Menu } from './ui.tsx'

const GAP = 6 // gap-1.5
const MORE = 76 + GAP // the "+N more" button (w-[4.75rem])

/** "2 / 4 / 6", the breakpoints reached in ink */
function Steps({ t }: { t: ActiveTrait }) {
  return (
    <span className="text-[11.5px] tabular-nums">
      {t.steps.map((s, i) => (
        <span key={i}>
          {i > 0 && <span className="px-px text-line-strong">/</span>}
          <span className={i <= t.level ? 'font-semibold text-ink' : 'text-muted'}>{s}</span>
        </span>
      ))}
    </span>
  )
}

function useTraits(set: GameSet, pieces: Piece[]) {
  const all = useMemo(() => activeTraits(set, pieces), [set, pieces])
  const byId = useMemo(() => new Map(set.traits.map((t) => [t.id, t])), [set])
  return { all, byId, on: all.filter((t) => t.level >= 0), off: all.filter((t) => t.level < 0) }
}

/** A side's traits, one per line, as in game (beside the board on wide screens) */
export const TraitRail = memo(function TraitRail({ set, pieces, onPick, selected }: { set: GameSet; pieces: Piece[]; onPick: (id: string) => void; selected?: string }) {
  const { byId, on, off } = useTraits(set, pieces)
  const [open, setOpen] = useState(false)
  if (!on.length && !off.length) return <p className="px-1 text-[13px] text-muted">{pieces.length ? 'No traits' : 'Empty side'}</p>
  const shown = open ? [...on, ...off] : on
  return (
    <ul className="flex flex-col gap-0.5">
      {shown.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onPick(t.id)}
            aria-pressed={selected === t.id}
            title={`${t.name}: ${t.count} unit${t.count === 1 ? '' : 's'}, breakpoints at ${t.steps.join(', ')}`}
            className={cx('flex h-8 w-full items-center gap-2 rounded-lg px-1 text-left transition-colors hover:bg-sunk', selected === t.id && 'bg-sunk ring-1 ring-line-strong', t.level < 0 && 'opacity-55')}
          >
            <TraitBadge set={set} trait={byId.get(t.id) ?? t} tier={tierOf(t.level, t.steps.length)} size={24} />
            <span className="w-3.5 shrink-0 text-center text-[13px] font-semibold text-ink tabular-nums">{t.count}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{t.name}</span>
            <span className="shrink-0"><Steps t={t} /></span>
          </button>
        </li>
      ))}
      {off.length > 0 && (
        <li>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-1 h-7 rounded-md px-1.5 text-xs text-muted hover:text-ink">
            {open ? 'Show fewer' : `${off.length} more, not active`}
          </button>
        </li>
      )}
    </ul>
  )
})

/** A side's traits as one line of chips (above and below the board on narrow screens): as many as fit, the rest in a
 *  menu, so the line never wraps and the board keeps its size */
export const TraitChips = memo(function TraitChips({ set, pieces, onPick, selected, label }: { set: GameSet; pieces: Piece[]; onPick: (id: string) => void; selected?: string; label: string }) {
  const { byId, on: active, off } = useTraits(set, pieces)
  // One-unit traits come last: they say the least
  const on = useMemo(() => [...active.filter((t) => t.steps.length > 1), ...active.filter((t) => t.steps.length <= 1)], [active])
  const box = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ n: on.length, end: false })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const room = el.clientWidth + GAP
      const widths = [...el.querySelectorAll<HTMLElement>('[data-chip]')].map((c) => c.offsetWidth + GAP)
      let n = widths.length, used = widths.reduce((a, w) => a + w, 0)
      while (n > 0 && used + (n < widths.length || off.length ? MORE : 0) > room) used -= widths[--n]
      const end = used > room / 2
      setFit((f) => (f.n === n && f.end === end ? f : { n, end }))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    let live = true
    void document.fonts?.ready.then(() => { if (live) measure() }) // the chips' widths change once the font is in
    return () => { live = false; watch.disconnect() }
  }, [on, off.length])
  if (!on.length && !off.length) return <p className="flex h-7 items-center text-[13px] text-muted">{pieces.length ? 'No traits' : 'Empty side'}</p>
  const n = Math.min(fit.n, on.length)
  const rest = [...on.slice(n), ...off]
  const tip = (t: ActiveTrait) => `${t.name}: ${t.count} unit${t.count === 1 ? '' : 's'}, breakpoints at ${t.steps.join(', ')}`
  return (
    <div ref={box} className="flex h-7 min-w-0 items-center gap-1.5">
      <ul className="relative flex min-w-0 items-center gap-1.5 overflow-clip [overflow-clip-margin:4px]">
        {on.map((t, i) => (
          <li key={t.id} data-chip className={i < n ? 'shrink-0' : 'invisible absolute top-0 left-0'} aria-hidden={i < n ? undefined : true}>
            <button
              type="button"
              onClick={() => onPick(t.id)}
              aria-pressed={selected === t.id}
              title={tip(t)}
              className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border bg-panel pr-2.5 pl-0.5 text-[12.5px] whitespace-nowrap text-ink transition-colors', selected === t.id ? 'border-ink' : 'border-line hover:border-line-strong')}
            >
              <TraitBadge set={set} trait={byId.get(t.id) ?? t} tier={tierOf(t.level, t.steps.length)} size={22} />
              <span className="font-semibold tabular-nums">{t.count}</span>
              <span className="font-medium">{t.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <Menu
          label={label}
          align={fit.end ? 'end' : 'start'}
          width="w-64"
          trigger={`+${rest.length} more`}
          triggerClass={cx('inline-flex h-7 w-[4.75rem] shrink-0 items-center justify-center rounded-full text-[12.5px] whitespace-nowrap transition-colors hover:bg-sunk hover:text-ink', rest.some((t) => t.id === selected) ? 'text-ink ring-1 ring-ink' : 'text-muted')}
          items={rest.map((t) => ({
            label: <span className={cx('flex items-baseline gap-1.5', t.level < 0 && 'text-soft')}><span className="font-semibold tabular-nums">{t.count}</span>{t.name}</span>,
            hint: <><Steps t={t} />{t.level < 0 && <span className="ml-1.5">not active</span>}</>,
            icon: <TraitBadge set={set} trait={byId.get(t.id) ?? t} tier={tierOf(t.level, t.steps.length)} size={22} />,
            checked: selected === t.id,
            onSelect: () => onPick(t.id),
          }))}
        />
      )}
    </div>
  )
})
