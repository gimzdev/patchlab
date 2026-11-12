'use client'

import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { activeTraits } from '@/engine/prepare.ts'
import type { GameSet, Unit } from '@/engine/types.ts'
import { num } from '@/lib/format.ts'
import { bonusParts } from '@/lib/describe.ts'
import type { Comp } from '@/lib/comps.ts'
import type { Armed } from './board.tsx'
import { useDrag } from './drag.tsx'
import { Close, Search } from './icons.tsx'
import { ItemTile, Portrait, TraitBadge, tierOf } from './token.tsx'
import { cx, Tabs } from './ui.tsx'

export type LibraryTab = 'comps' | 'units' | 'items' | 'traits'

export interface CompLists {
  /** null: MetaForge couldn't be reached (or this set isn't TFT); undefined: still loading */
  meta: Comp[] | null | undefined
  trait: Comp[]
  saved: Comp[]
}

interface Props {
  set: GameSet
  /** "Champions" for TFT, "Units" otherwise */
  unitWord: string
  tab: LibraryTab
  onTab: (t: LibraryTab) => void
  armed: Armed
  inspecting: { kind: string; id?: string } | null
  comps: CompLists
  onComp: (comp: Comp, side: 0 | 1) => void
  onForget: (id: string) => void
  onUnit: (id: string) => void
  onItem: (id: string) => void
  onTrait: (id: string) => void
  /** Units on the board, for the count on each */
  onBoard: Map<string, number>
}

/** Everything to put on the board: whole comps, units and items; and the traits, to look at */
export const Library = memo(function Library({ set, unitWord, tab, onTab, armed, inspecting, comps, onComp, onForget, onUnit, onItem, onTrait, onBoard }: Props) {
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim().toLowerCase())
  const { begin } = useDrag()
  // Each tab keeps its own place in the list
  const list = useRef<HTMLDivElement>(null)
  const scrolls = useRef<Partial<Record<LibraryTab, number>>>({})
  const listed = useRef(tab)
  useLayoutEffect(() => {
    if (listed.current === tab || !list.current) return
    listed.current = tab
    list.current.scrollTop = scrolls.current[tab] ?? 0
  }, [tab])
  const traitName = useMemo(() => new Map(set.traits.map((t) => [t.id, t.name])), [set])
  const unitById = useMemo(() => new Map(set.units.map((u) => [u.id, u])), [set])
  const matchUnit = (u: Unit) => !q || u.name.toLowerCase().includes(q) || u.traits.some((t) => traitName.get(t)?.toLowerCase().includes(q))
  const matchComp = (c: Comp) => !q || c.name.toLowerCase().includes(q) || c.pieces.some((p) => { const u = unitById.get(p.unit); return !!u && matchUnit(u) })

  const units = useMemo(() => {
    const groups = new Map<number, Unit[]>()
    // Plants (cost 0) come last, under their own heading
    for (const u of [...set.units].filter(matchUnit).sort((a, b) => Number(!!a.plant) - Number(!!b.plant) || a.cost - b.cost || a.name.localeCompare(b.name))) groups.set(u.plant ? -1 : u.cost, [...(groups.get(u.plant ? -1 : u.cost) ?? []), u])
    return [...groups.entries()]
    // matchUnit reads q and traitName
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, q, traitName])
  // Emblems after the other items
  const items = useMemo(() => set.items.filter((i) => !q || i.name.toLowerCase().includes(q)).sort((a, b) => Number(!!a.trait) - Number(!!b.trait) || a.name.localeCompare(b.name)), [set, q])
  const members = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of set.units) for (const t of u.traits) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }, [set])
  const traits = useMemo(() => set.traits.filter((t) => !q || t.name.toLowerCase().includes(q)).sort((a, b) => (b.breakpoints.length > 1 ? 1 : 0) - (a.breakpoints.length > 1 ? 1 : 0) || a.name.localeCompare(b.name)), [set, q])

  const word = tab === 'comps' ? `comps, ${unitWord.toLowerCase()}, traits` : tab === 'units' ? `${unitWord.toLowerCase()} or traits` : tab
  const card = (c: Comp) => <CompCard key={c.id} set={set} comp={c} onComp={onComp} onForget={c.source === 'saved' ? onForget : undefined} />
  const meta = comps.meta?.filter(matchComp) ?? [], saved = comps.saved.filter(matchComp), trait = comps.trait.filter(matchComp)

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2.5 px-3 pt-3 pb-2.5">
        <Tabs label="Library" value={tab} onChange={onTab} tabs={[{ value: 'comps', label: 'Comps' }, { value: 'units', label: unitWord }, { value: 'items', label: 'Items' }, { value: 'traits', label: 'Traits' }]} />
        <label className="relative block">
          <span className="sr-only">Search {word}</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" width={16} height={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${word}`}
            className="h-9 w-full rounded-lg border border-line bg-panel pr-2 pl-8 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
          />
        </label>
      </div>

      <div ref={list} onScroll={(e) => { scrolls.current[listed.current] = e.currentTarget.scrollTop }} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {tab === 'comps' && (
          <div className="flex flex-col gap-5 pt-1">
            <p className="-mb-2 px-0.5 text-xs text-pretty text-muted max-lg:hidden">Drag a comp onto a side of the board, or send it to blue or red.</p>
            {comps.meta !== null && (
              <Group title="Meta comps" hint={comps.meta === undefined ? 'Loading from MetaForge…' : `From MetaForge’s ranked games${set.meta?.patch ? `, patch ${set.meta.patch}` : ''}`}>
                {comps.meta === undefined ? <Skeleton /> : meta.length ? meta.map(card) : <p className="text-[13px] text-muted">{q ? 'None match.' : 'None for this set yet.'}</p>}
              </Group>
            )}
            {(saved.length > 0 || !q) && (
              <Group title="Your comps" hint={comps.saved.length ? undefined : 'Save a side from its menu (⋯) to keep it here'}>
                {saved.map(card)}
              </Group>
            )}
            {!set.kit && (
              <Group title="By trait" hint="Built around each trait, at level 8">
                {trait.length ? trait.map(card) : <p className="text-[13px] text-muted">{q ? 'None match.' : 'This set has no trait ladders.'}</p>}
              </Group>
            )}
          </div>
        )}

        {tab === 'units' && (
          <>
            {!units.length && <p className="px-1 py-6 text-sm text-muted">Nothing matches “{query}”.</p>}
            {units.map(([cost, list]) => (
              <section key={cost} className="mb-3">
                <h3 className="eyebrow flex items-center gap-2 px-1 pt-1 pb-1.5 text-muted">
                  <span className="size-2 rounded-full" style={{ background: `var(--c${Math.min(5, Math.max(1, cost))})` }} />
                  {cost < 0 ? 'Elderwood plants' : `${cost} cost`}
                </h3>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.1rem,1fr))] gap-1">
                  {list.map((u) => {
                    const isArmed = armed?.kind === 'unit' && armed.id === u.id, count = onBoard.get(u.id) ?? 0
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => onUnit(u.id)}
                          onPointerDown={(e) => begin(e, { kind: 'unit', unit: u.id }, <Portrait set={set} unit={u} size={52} className="shadow-pop" />)}
                          aria-pressed={isArmed}
                          title={`${u.name}: ${u.traits.map((t) => traitName.get(t) ?? t).join(', ')}`}
                          className={cx(
                            'flex w-full cursor-grab flex-col items-center gap-1 rounded-lg px-0.5 pt-1.5 pb-1 transition-colors active:cursor-grabbing',
                            isArmed ? 'bg-accent text-accent-ink' : inspecting?.kind === 'unit' && inspecting.id === u.id ? 'bg-sunk' : 'hover:bg-sunk',
                          )}
                        >
                          <Portrait set={set} unit={u} size={46}>
                            {count > 0 && <span className="absolute -top-1 -right-1 inline-flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-ink ring-2 ring-paper tabular-nums" title={`${count} on the board`}>{count}</span>}
                          </Portrait>
                          <span className="w-full truncate text-center text-[11.5px] leading-tight font-medium">{u.name}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </>
        )}

        {tab === 'items' && (
          <ul className="flex flex-col gap-0.5 pt-1">
            {!items.length && <li className="px-1 py-6 text-sm text-muted">{set.items.length ? `Nothing matches “${query}”.` : 'This set has no items.'}</li>}
            {items.map((it, k) => {
              const isArmed = armed?.kind === 'item' && armed.id === it.id
              const stats = bonusParts(it.bonus).join(', ')
              const first = !!it.trait && !items[k - 1]?.trait
              return (
                <li key={it.id}>
                  {first && <h3 className="eyebrow px-1 pt-3 pb-1.5 text-muted">Emblems</h3>}
                  <button
                    type="button"
                    onClick={() => onItem(it.id)}
                    onPointerDown={(e) => begin(e, { kind: 'item', item: it.id }, <ItemTile set={set} item={it} size={40} className="shadow-pop" />)}
                    aria-pressed={isArmed}
                    className={cx('flex w-full cursor-grab items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors', isArmed ? 'bg-accent text-accent-ink' : inspecting?.kind === 'item' && inspecting.id === it.id ? 'bg-sunk' : 'hover:bg-sunk')}
                  >
                    <ItemTile set={set} item={it} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{it.name}</span>
                      <span className={cx('block truncate text-xs', isArmed ? 'text-accent-ink/70' : 'text-muted')}>{isArmed ? 'Now pick a unit for it' : [it.trait ? traitName.get(it.trait) : '', stats].filter(Boolean).join(' · ') || 'Its effect isn’t simulated'}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {tab === 'traits' && (
          <ul className="flex flex-col gap-0.5 pt-1">
            {!traits.length && <li className="px-1 py-6 text-sm text-muted">Nothing matches “{query}”.</li>}
            {traits.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onTrait(t.id)}
                  className={cx('flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors', inspecting?.kind === 'trait' && inspecting.id === t.id ? 'bg-sunk' : 'hover:bg-sunk')}
                >
                  <TraitBadge set={set} trait={t} tier="off" size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                    <span className="block truncate text-xs text-muted tabular-nums">
                      {t.breakpoints.length ? t.breakpoints.map((b) => b.units).join(' · ') : 'No breakpoints'}
                      {members.get(t.id) ? ` · ${members.get(t.id)} ${members.get(t.id) === 1 ? unitWord.toLowerCase().replace(/s$/, '') : unitWord.toLowerCase()}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
})

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="eyebrow px-0.5 text-soft">{title}</h3>
      {hint && <p className="mt-0.5 px-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </section>
  )
}

function Skeleton() {
  return (
    <>
      {[0, 1, 2].map((k) => <div key={k} className="h-[5.5rem] animate-pulse rounded-xl bg-sunk" />)}
    </>
  )
}

/** A comp: drag it onto a side, or send it to blue or red */
const CompCard = memo(function CompCard({ set, comp, onComp, onForget }: { set: GameSet; comp: Comp; onComp: (c: Comp, side: 0 | 1) => void; onForget?: (id: string) => void }) {
  const { begin } = useDrag()
  const units = useMemo(() => new Map(set.units.map((u) => [u.id, u])), [set])
  const traits = useMemo(() => activeTraits(set, comp.pieces).filter((t) => t.level >= 0 && t.steps.length > 1).slice(0, 5), [set, comp])
  const byId = useMemo(() => new Map(set.traits.map((t) => [t.id, t])), [set])
  // Cheapest first, plants last
  const pieces = useMemo(() => [...comp.pieces].sort((a, b) => Number(!!units.get(a.unit)?.plant) - Number(!!units.get(b.unit)?.plant) || (units.get(a.unit)?.cost ?? 0) - (units.get(b.unit)?.cost ?? 0)), [comp, units])
  const preview = (
    <div className="flex max-w-64 flex-wrap gap-1 rounded-xl border border-line bg-panel p-2 shadow-pop">
      {pieces.slice(0, 10).map((p, i) => { const u = units.get(p.unit); return u ? <Portrait key={i} set={set} unit={u} size={26} /> : null })}
    </div>
  )
  const side = (s: 0 | 1) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onComp(comp, s) }}
      className={cx('inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-md px-1.5 text-xs font-semibold transition-colors', s ? 'text-red hover:bg-red/10' : 'text-blue hover:bg-blue/10')}
      title={`Put it on ${s ? 'red' : 'blue'}`}
    >
      <span className={cx('size-2 rounded-full', s ? 'bg-red' : 'bg-blue')} />
      <span className="@max-[17rem]:sr-only">{s ? 'Red' : 'Blue'}</span>
    </button>
  )
  return (
    <div
      onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button')) begin(e, { kind: 'comp', comp }, preview) }}
      className="group cursor-grab rounded-xl border border-line bg-panel p-2.5 transition-colors hover:border-line-strong active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        {comp.meta?.grade && <span className={cx('grade inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] text-[11px] font-bold', `grade-${comp.meta.grade}`)}>{comp.meta.grade}</span>}
        {/* Names like "Draven & Elder Dragon" get a second line rather than losing their end */}
        <p className="line-clamp-2 min-w-0 flex-1 pt-px text-[13.5px] leading-[18px] font-semibold text-pretty text-ink" title={comp.name}>{comp.name}</p>
        <div className="-mt-1 -mr-1 flex shrink-0 items-center">
          {side(0)}
          {side(1)}
          {onForget && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onForget(comp.id) }} aria-label={`Forget ${comp.name}`} title="Forget this comp" className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-sunk hover:text-ink">
              <Close width={14} height={14} />
            </button>
          )}
        </div>
      </div>
      {comp.meta ? (
        <p className="mt-0.5 truncate text-[11.5px] text-muted tabular-nums" title={`${num(comp.meta.games)} ranked games`}>Avg place {num(comp.meta.avg, 2)} · Top 4 {num(comp.meta.top4 * 100, 0)}% · {comp.meta.games >= 1000 ? `${num(comp.meta.games / 1000, 1)}k` : num(comp.meta.games)} games</p>
      ) : (
        <p className="mt-1 flex items-center gap-x-2 overflow-hidden [mask-image:linear-gradient(90deg,#000_85%,transparent)]">
          {traits.map((t) => (
            <span key={t.id} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] whitespace-nowrap text-soft tabular-nums">
              <TraitBadge set={set} trait={byId.get(t.id) ?? t} tier={tierOf(t.level, t.steps.length)} size={16} />
              {t.count} {t.name}
            </span>
          ))}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {pieces.map((p, i) => { const u = units.get(p.unit); return u ? <Portrait key={i} set={set} unit={u} size={27} /> : null })}
      </div>
    </div>
  )
})
