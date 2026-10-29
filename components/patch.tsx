'use client'

import { memo, useMemo, useState, type ReactNode } from 'react'
import { baseValue, BONUS_META, metaFor, patchNotes, ROLE_META, RULE_META, toField, valueAt, valuePaths, type Note } from '@/engine/patch.ts'
import { BONUS_KEYS, ROLE_RULE_KEYS, STAT_KEYS, type Bonus, type GameSet, type Rules, type Star, type Values } from '@/engine/types.ts'
import { bonusParts, effectText } from '@/lib/describe.ts'
import { change, num, signed } from '@/lib/format.ts'
import { MAX_ITEMS, pieceAt, type Action, type Layer, type Space } from '@/lib/state.ts'
import { Back, Check, Copy, More, Plus, Reset, Sliders, Trash } from './icons.tsx'
import { ItemTile, Portrait, TraitBadge, tierOf } from './token.tsx'
import { Button, cx, Empty, IconButton, Menu, NumberField, Segmented } from './ui.tsx'

export type Selection = { kind: 'piece'; cell: number } | { kind: 'unit'; id: string } | { kind: 'item'; id: string } | { kind: 'trait'; id: string } | { kind: 'rules' } | null

interface Props {
  set: GameSet
  space: Space
  selection: Selection
  /** Which numbers the fields change: the patch, or live (the game as it is, corrected) */
  layer: Layer
  onLayer: (l: Layer) => void
  onValue: (layer: Layer, path: string, value: number | null) => void
  onAct: (a: Action) => void
  onSelect: (s: Selection) => void
}

/** The right-hand panel: the patch as notes, or the numbers of what's selected */
export const PatchPanel = memo(function PatchPanel(props: Props) {
  return props.selection ? <Editor {...props} /> : <Overview {...props} />
})

/* ── The patch, as notes ──────────────────────────────── */

const shown = (v: number, n: Pick<Note, 'meta'>) => `${num(toField(v, n.meta), 3)}${n.meta?.pct ? (n.meta.unit ? n.meta.unit.replace(/^%\s*/, '% ') : '%') : n.meta?.unit && n.meta.unit !== 'hex' ? ` ${n.meta.unit}` : ''}`

/** What a note's path is about, to open it */
const subject = (path: string): Selection => {
  const [kind, id] = path.split('.')
  return kind === 'u' ? { kind: 'unit', id } : kind === 'i' ? { kind: 'item', id } : kind === 't' ? { kind: 'trait', id } : { kind: 'rules' }
}

function group(notes: Note[]) {
  const out = new Map<string, { sel: Selection; name: string; list: Note[] }>()
  for (const n of notes) {
    const key = n.path.split('.').slice(0, 2).join('.')
    const g = out.get(key) ?? { sel: subject(n.path), name: n.name.replace(/ \(\d+\)$/, ''), list: [] }
    g.list.push(n)
    out.set(key, g)
  }
  return [...out.values()]
}

export function notesText(set: GameSet, space: Space) {
  const lines = group(patchNotes(set, space.live, space.patch)).flatMap((g) => [g.name, ...g.list.map((n) => `- ${n.field}${/\(\d+\)$/.test(n.name) ? ` at ${/\((\d+)\)$/.exec(n.name)?.[1]}` : ''}: ${shown(n.from, n)} ⇒ ${shown(n.to, n)}`), ''])
  return lines.length ? `Patch notes: ${set.name}${set.version ? `, patch ${set.version}` : ''} (made with Patchlab)\n\n${lines.join('\n').trim()}` : ''
}

function Overview({ set, space, onAct, onSelect }: Props) {
  const patch = useMemo(() => group(patchNotes(set, space.live, space.patch)), [set, space.live, space.patch])
  const live = useMemo(() => group(patchNotes(set, {}, space.live)), [set, space.live])
  const count = patch.reduce((s, g) => s + g.list.length, 0)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notesText(set, space))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* no clipboard (an insecure page): nothing to do */
    }
  }
  return (
    <div className="flex flex-col">
      <div className="flex h-9 items-center gap-2">
        <h2 className="text-[22px] leading-none text-ink">Patch</h2>
        {count > 0 && <span className="rounded-md bg-mark px-1.5 text-xs leading-5 font-semibold text-mark-ink tabular-nums">{count}</span>}
        <div className="ml-auto flex items-center gap-1">
          {count > 0 && <Button size="sm" onClick={copy}>{copied ? <Check width={16} height={16} /> : <Copy width={16} height={16} />}{copied ? 'Copied' : 'Copy notes'}</Button>}
          {(count > 0 || live.length > 0) && (
            <Menu
              label="Patch actions"
              align="end"
              trigger={<More />}
              triggerClass="inline-flex size-8 items-center justify-center rounded-lg text-soft hover:bg-sunk hover:text-ink"
              items={[
                { label: 'Clear the patch', hint: 'Every number back to live', disabled: !count, onSelect: () => onAct({ type: 'reset', layer: 'patch' }) },
                { label: 'Reset live corrections', hint: 'Back to the game data', disabled: !live.length, onSelect: () => onAct({ type: 'reset', layer: 'live' }) },
              ]}
            />
          )}
        </div>
      </div>

      {!count ? (
        <div className="mt-3 rounded-xl border border-dashed border-line-strong px-4 py-4">
          <p className="text-sm font-medium text-ink">Nothing changed yet</p>
          <ol className="mt-3 flex flex-col gap-3">
            {[
              ['Set up the fight', 'Drag a comp onto each side, or a unit onto any hex.'],
              ['Change a number', 'Pick a unit on the board, an item or a trait, and type a new value. It lands here as a patch note.'],
              ['Run', 'Thousands of fights with the live numbers and with yours, on the same seeds: see what moved.'],
            ].map(([title, text], k) => (
              <li key={k} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
                <span className="mt-px inline-flex size-5 items-center justify-center rounded-full bg-sunk text-[11px] font-semibold text-soft tabular-nums">{k + 1}</span>
                <span className="text-[13px] text-pretty text-soft"><span className="font-medium text-ink">{title}.</span> {text}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <Groups set={set} groups={patch} onSelect={onSelect} marked />
      )}

      {live.length > 0 && (
        <section className="mt-6">
          <h3 className="eyebrow text-soft">Live corrections</h3>
          <p className="mt-0.5 mb-2 text-xs text-pretty text-muted">Numbers you set as the game’s own: both runs use them, so they’re not part of the patch.</p>
          <Groups set={set} groups={live} onSelect={onSelect} />
        </section>
      )}

      <button type="button" onClick={() => onSelect({ kind: 'rules' })} className="mt-6 flex w-full items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-line-strong">
        <Sliders className="text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">Game rules</span>
          <span className="block truncate text-xs text-muted">Stars, mana, movement, overtime</span>
        </span>
      </button>
      <p className="mt-4 text-xs text-muted">Keys: R runs · W watches a fight, Space pauses it · 1 2 3 set stars · Delete takes off · Ctrl+Z undoes</p>
    </div>
  )
}

function Groups({ set, groups, onSelect, marked }: { set: GameSet; groups: ReturnType<typeof group>; onSelect: (s: Selection) => void; marked?: boolean }) {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {groups.map((g) => (
        <li key={`${g.sel?.kind}:${g.name}`} className="rounded-xl border border-line bg-panel">
          <button type="button" onClick={() => onSelect(g.sel)} className="flex w-full items-center gap-2.5 rounded-t-xl px-3 pt-2.5 pb-1.5 text-left hover:bg-sunk/60">
            <SubjectIcon set={set} sel={g.sel} size={24} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{g.name}</span>
          </button>
          <ul className="px-3 pb-2.5">
            {g.list.map((n) => {
              const d = n.meta?.pct ? (n.to - n.from) * 100 : change(n.from, n.to) * 100
              return (
                <li key={n.path} className="flex items-baseline gap-2 py-0.5 text-[13px]">
                  <span className="min-w-0 flex-1 text-pretty text-soft">{n.field}{/\(\d+\)$/.test(n.name) && <span className="text-muted"> at {/\((\d+)\)$/.exec(n.name)?.[1]}</span>}</span>
                  <span className="shrink-0 text-muted tabular-nums">{shown(n.from, n)}</span>
                  <span aria-label="becomes" className="shrink-0 text-muted">→</span>
                  <span className={cx('shrink-0 font-semibold tabular-nums', marked ? 'rounded-[3px] bg-mark px-1 text-mark-ink' : 'text-ink')}>{shown(n.to, n)}</span>
                  {Number.isFinite(d) && Math.abs(d) >= 0.5 && <span className="w-11 shrink-0 text-right text-xs text-muted tabular-nums">{signed(d, 0)}{n.meta?.pct ? 'pt' : '%'}</span>}
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function SubjectIcon({ set, sel, size }: { set: GameSet; sel: Selection; size: number }) {
  if (sel?.kind === 'unit') { const u = set.units.find((x) => x.id === sel.id); return u ? <Portrait set={set} unit={u} size={size} /> : null }
  if (sel?.kind === 'item') { const i = set.items.find((x) => x.id === sel.id); return i ? <ItemTile set={set} item={i} size={size} /> : null }
  if (sel?.kind === 'trait') { const t = set.traits.find((x) => x.id === sel.id); return t ? <TraitBadge set={set} trait={t} tier="gold" size={size} /> : null }
  return <span className="inline-flex shrink-0 items-center justify-center rounded-md bg-sunk text-soft" style={{ width: size, height: size }}><Sliders width={15} height={15} /></span>
}

/* ── The numbers of one thing ─────────────────────────── */

function Editor({ set, space, selection, layer, onLayer, onValue, onAct, onSelect }: Props) {
  const count = Object.keys(space.patch).length
  const back = (
    <button type="button" onClick={() => onSelect(null)} className="-ml-1.5 inline-flex h-8 items-center gap-1 rounded-lg pr-2.5 pl-1 text-[13px] font-medium text-soft hover:bg-sunk hover:text-ink">
      <Back width={16} height={16} />
      Patch
      {count > 0 && <span className="ml-0.5 rounded-[4px] bg-mark px-1 text-[11px] leading-4 font-semibold text-mark-ink tabular-nums">{count}</span>}
    </button>
  )
  const row = (path: string, label: string) => <Row key={path} set={set} space={space} layer={layer} path={path} label={label} onValue={onValue} />
  const numbersHead = (title: string, extra?: ReactNode, name = false) => (
    <div className="mt-6 mb-1 flex items-center gap-2">
      <h3 className={cx('min-w-0 truncate', name ? 'font-display text-[17px] font-[560] tracking-[-0.01em] text-ink' : 'eyebrow text-soft')}>{title}</h3>
      {extra}
      <Segmented size="sm" className="ml-auto" label="Numbers to change" value={layer} onChange={onLayer} options={[{ value: 'patch' as Layer, label: 'Patch', title: 'Change the numbers your patch tries' }, { value: 'live' as Layer, label: 'Live', title: 'Correct the game’s own numbers (both runs use them)' }]} />
    </div>
  )
  const liveNote = layer === 'live' && <p className="mb-2 rounded-lg bg-sunk px-3 py-2 text-xs text-pretty text-soft">Live is the game as it is. Correct a number the data gets wrong here: both runs use it, and it isn’t part of the patch.</p>

  if (selection?.kind === 'rules') {
    return (
      <div>
        {back}
        <Title icon={<span className="inline-flex size-11 items-center justify-center rounded-xl bg-sunk text-soft"><Sliders /></span>} title="Game rules" sub="How every fight in this set works" />
        {numbersHead('Rules')}
        {liveNote}
        {(Object.keys(RULE_META) as (keyof Rules)[]).flatMap((k) => {
          const v = set.rules[k]
          if (k === 'manaPerAttack' && set.rules.roles && set.kit) return []
          if (Array.isArray(v)) return v.map((_, i) => row(`r.${k}.v${i + 1}`, k === 'manaFromDamage' ? `${RULE_META[k].label}${set.rules.roles && set.kit ? ' (tanks)' : ''}, ${i ? 'after' : 'before'} resists` : `${RULE_META[k].label} ${i + 1}★`))
          return [row(`r.${k}`, RULE_META[k].label)]
        })}
        {set.rules.roles && set.kit && (
          <>
            <h3 className="eyebrow mt-6 mb-1 text-soft">Roles</h3>
            <p className="mb-2 text-xs text-pretty text-muted">How each role fills its mana and the rule of its own.</p>
            {ROLE_RULE_KEYS.map((k) => row(`r.roles.${k}`, ROLE_META[k].label))}
          </>
        )}
        <p className="mt-4 text-[13px] text-pretty text-muted">Overtime makes long fights end: past its start, every hit deals more each second, until the time limit calls a draw.</p>
      </div>
    )
  }

  if (selection?.kind === 'item') {
    const item = set.items.find((i) => i.id === selection.id)
    if (!item) return <div>{back}<Empty title="That item isn't in this set" /></div>
    return (
      <div>
        {back}
        <Title icon={<ItemTile set={set} item={item} size={44} />} title={item.name} sub={bonusParts(item.bonus).join(', ') || (item.desc ? undefined : 'No simulated stats yet')} />
        {item.desc && <p className="-mt-1 mb-3 text-[13px] text-pretty text-soft">{item.desc}</p>}
        {item.note && <Note>{item.note}</Note>}
        {numbersHead('Stats')}
        {liveNote}
        <BonusRows set={set} space={space} layer={layer} prefix={`i.${item.id}`} bonus={item.bonus} onValue={onValue} />
        {item.values && Object.keys(item.values).length > 0 && (
          <>
            <h3 className="eyebrow mt-6 mb-1 text-soft">Effect</h3>
            <ValueRows set={set} space={space} layer={layer} prefix={`i.${item.id}`} values={item.values} onValue={onValue} onReset={(prefix) => onAct({ type: 'reset', layer, prefix })} />
          </>
        )}
        <Source set={set} kind="item" />
      </div>
    )
  }

  if (selection?.kind === 'trait') {
    const trait = set.traits.find((t) => t.id === selection.id)
    if (!trait) return <div>{back}<Empty title="That trait isn't in this set" /></div>
    const members = set.units.filter((u) => u.traits.includes(trait.id))
    return (
      <div>
        {back}
        <Title icon={<TraitBadge set={set} trait={trait} tier={tierOf(trait.breakpoints.length - 1, trait.breakpoints.length)} size={44} />} title={trait.name} sub={trait.breakpoints.length ? `At ${trait.breakpoints.map((b) => b.units).join(', ')}` : 'No breakpoints'} />
        <div className="-mt-1 mb-3 flex flex-wrap gap-1">
          {members.map((u) => (
            <button key={u.id} type="button" onClick={() => onSelect({ kind: 'unit', id: u.id })} title={u.name} className="rounded-[24%] transition-transform hover:-translate-y-px">
              <Portrait set={set} unit={u} size={28} />
            </button>
          ))}
        </div>
        {trait.desc && <p className="-mt-1 mb-3 text-[13px] text-pretty text-soft">{trait.desc}</p>}
        {trait.note && <Note>{trait.note}</Note>}
        {numbersHead('Breakpoints')}
        {liveNote}
        {!trait.breakpoints.length && <p className="text-sm text-muted">No breakpoints.</p>}
        {single(trait.values) && (
          <section className="mt-3 rounded-xl border border-line bg-panel px-3 pt-2.5 pb-2">
            <h4 className="mb-1 text-[13px] font-semibold text-ink">At every breakpoint</h4>
            <ValueRows set={set} space={space} layer={layer} prefix={`t.${trait.id}`} values={single(trait.values)!} onValue={onValue} onReset={(prefix) => onAct({ type: 'reset', layer, prefix })} />
          </section>
        )}
        {trait.breakpoints.map((bp, b) => (
          <section key={b} className="mt-3 rounded-xl border border-line bg-panel px-3 pt-2.5 pb-2">
            <h4 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <TraitBadge set={set} trait={trait} tier={tierOf(b, trait.breakpoints.length)} size={18} />
              At {bp.units}
            </h4>
            {row(`t.${trait.id}.b${b}.units`, 'Units needed')}
            {Object.entries(trait.values ?? {}).filter(([, v]) => v.v.length > 1).map(([name, v]) => <Row key={name} set={set} space={space} layer={layer} path={`t.${trait.id}.$${name}.b${Math.min(b, v.v.length - 1)}`} label={v.label} onValue={onValue} />)}
            <BonusRows set={set} space={space} layer={layer} prefix={`t.${trait.id}.b${b}`} bonus={bp.bonus} onValue={onValue} title={`For ${trait.name} units`} />
            <BonusRows set={set} space={space} layer={layer} prefix={`t.${trait.id}.t${b}`} bonus={bp.team ?? {}} onValue={onValue} title="For the whole team" />
          </section>
        ))}
        <Source set={set} kind="trait" />
      </div>
    )
  }

  const piece = selection?.kind === 'piece' ? pieceAt(space, selection.cell) : undefined
  const unitId = selection?.kind === 'piece' ? piece?.unit : selection?.kind === 'unit' ? selection.id : undefined
  const unit = set.units.find((u) => u.id === unitId)
  if (!unit) return <div>{back}<Empty title="Nothing selected" /></div>
  const traitById = new Map(set.traits.map((t) => [t.id, t]))
  const cell = selection?.kind === 'piece' ? selection.cell : null
  const scripted = !!set.kit && !!unit.ability.values && Object.keys(unit.ability.values).length > 0

  return (
    <div>
      <div className="flex items-center">
        {back}
        {piece && cell !== null && <IconButton label="Take it off the board" size="sm" className="ml-auto" onClick={() => onAct({ type: 'remove', cell })}><Trash /></IconButton>}
      </div>
      <Title
        icon={<Portrait set={set} unit={unit} size={48} />}
        title={unit.name}
        sub={
          <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
            <span className="mr-1 inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: `var(--c${Math.min(5, Math.max(1, unit.cost))})` }} />{unit.plant ? 'Plant' : `${unit.cost} cost`}{unit.role ? ` · ${ROLE_WORD[unit.role]}` : ''}</span>
            {unit.traits.map((t) => {
              const tr = traitById.get(t)
              return (
                <button key={t} type="button" onClick={() => onSelect({ kind: 'trait', id: t })} className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-soft hover:bg-sunk hover:text-ink">
                  {tr && <TraitBadge set={set} trait={tr} tier="off" size={15} />}
                  {tr?.name ?? t}
                </button>
              )
            })}
          </span>
        }
      />

      {piece && cell !== null ? (
        <div className="grid grid-cols-[3.5rem_1fr] items-center gap-x-3 gap-y-2.5 rounded-xl border border-line bg-panel px-3 py-2.5">
          <span className="text-[13px] text-soft">Stars</span>
          <Segmented className="justify-self-start" label="Stars" value={piece.star} onChange={(s: Star) => onAct({ type: 'star', cell, star: s })} options={[1, 2, 3].map((s) => ({ value: s as Star, label: `${s}★`, title: `${s} star${s > 1 ? 's' : ''} (${s})` }))} />
          <span className="self-start pt-1.5 text-[13px] text-soft">Items</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {piece.items.map((id, slot) => {
              const it = set.items.find((i) => i.id === id)
              return (
                <span key={slot} className="group relative">
                  <button type="button" onClick={() => it && onSelect({ kind: 'item', id: it.id })} title={it?.name ?? id} className="block rounded-[22%]">
                    {it && <ItemTile set={set} item={it} size={32} />}
                  </button>
                  <button type="button" aria-label={`Take ${it?.name ?? id} off`} title="Take it off" onClick={() => onAct({ type: 'unequip', cell, slot })} className="absolute -top-1.5 -right-1.5 inline-flex size-4 items-center justify-center rounded-full bg-raised text-[10px] leading-none text-ink opacity-0 ring-2 ring-panel transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100">×</button>
                </span>
              )
            })}
            {piece.items.length < MAX_ITEMS && set.items.length > 0 && (
              <Menu
                label="Give an item"
                width="w-72"
                trigger={<Plus width={16} height={16} />}
                triggerClass="inline-flex size-8 items-center justify-center rounded-[22%] border border-dashed border-line-strong text-soft hover:border-ink hover:text-ink"
                items={[...set.items].sort((a, b) => a.name.localeCompare(b.name)).map((it) => ({ label: it.name, hint: bonusParts(it.bonus).join(', ') || undefined, icon: <ItemTile set={set} item={it} size={22} />, onSelect: () => onAct({ type: 'equip', cell, item: it.id }) }))}
              />
            )}
            {!piece.items.length && <span className="text-xs text-muted">{set.items.length ? 'None yet' : 'This set has no items'}</span>}
          </div>
        </div>
      ) : (
        <p className="rounded-xl bg-sunk px-3 py-2 text-[13px] text-soft">Not on the board: drag it onto a hex, or tap a hex to place it.</p>
      )}

      {/* What the unit does comes first: the numbers a patch touches most */}
      {numbersHead(unit.ability.name || 'Ability', unit.ability.estimated && <span className="shrink-0 rounded-md bg-sunk px-1.5 py-0.5 text-[11px] font-medium text-soft" title="The game data doesn't include this ability's numbers">Estimated</span>, true)}
      {liveNote}
      {unit.ability.estimated && <p className="mb-2 text-xs text-pretty text-muted">The game data leaves out ability numbers, so these come from the description and the unit’s cost. Correct them in Live.</p>}
      {unit.ability.desc && <p className="mb-3 text-[13px] text-pretty text-soft"><Described text={unit.ability.desc} /></p>}
      {scripted ? (
        <>
          <ValueRows set={set} space={space} layer={layer} prefix={`u.${unit.id}`} values={unit.ability.values!} onValue={onValue} onReset={(prefix) => onAct({ type: 'reset', layer, prefix })} />
          <Source set={set} kind="ability" />
        </>
      ) : !unit.ability.effects.length ? (
        <p className="text-[13px] text-muted">{unit.stats.mana > 0 ? 'No effects: casting does nothing.' : 'This unit never casts (its mana is 0).'}</p>
      ) : null}
      {!scripted && unit.ability.effects.map((e, k) => (
        <div key={k} className="mt-3 rounded-xl border border-line bg-panel px-3 pt-2.5 pb-2">
          <p className="mb-1.5 text-[13px] text-pretty text-ink">{effectText(e)}</p>
          <StarRow set={set} space={space} layer={layer} prefix={`u.${unit.id}.e${k}`} onValue={onValue} onReset={(prefix) => onAct({ type: 'reset', layer, prefix })} />
          {e.target === 'splash' && row(`u.${unit.id}.e${k}.radius`, 'Radius, in hexes')}
          {(e.kind === 'shield' || e.kind === 'buff') && row(`u.${unit.id}.e${k}.duration`, 'Duration')}
        </div>
      ))}

      <h3 className="eyebrow mt-6 mb-1 text-soft">Stats</h3>
      {STAT_KEYS.map((k) => row(`u.${unit.id}.${k}`, metaFor(set, `u.${unit.id}.${k}`)?.label ?? k))}
    </div>
  )
}

const patchNumber = (p: string) => { const m = /^(\d+)\.(\d+)/.exec(p); return m ? Number(m[1]) * 1000 + Number(m[2]) : 0 }
/** Where a panel's numbers come from. Traits' come with the game data, every patch; abilities' and items' don't (the
 *  data leaves them out), so they can fall behind the game */
function Source({ set, kind }: { set: GameSet; kind: 'ability' | 'item' | 'trait' }) {
  if (!set.kit) return null
  if (kind === 'trait') return set.version ? <p className="mt-3 text-xs text-pretty text-muted">Numbers from the game data of patch {set.version}: they follow every patch.</p> : null
  if (!set.kitPatch) return null
  const what = kind === 'ability' ? 'Ability' : 'Item'
  return set.version && patchNumber(set.version) > patchNumber(set.kitPatch)
    ? <p className="mt-3 text-xs text-pretty text-soft">{what} numbers from patch {set.kitPatch}, and the game is on {set.version}: some may have changed. Correct them in Live.</p>
    : <p className="mt-3 text-xs text-pretty text-muted">{what} numbers from tft.tools and Riot’s patch notes, patch {set.kitPatch}.</p>
}

function Title({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: ReactNode }) {
  return (
    <div className="mt-2 mb-4 flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <h2 className="text-[23px] leading-tight text-balance text-ink">{title}</h2>
        {sub && <div className="mt-0.5 text-[13px] text-pretty text-muted">{sub}</div>}
      </div>
    </div>
  )
}

/** What the game's version does that the simulator leaves out: three lines, the rest on demand */
function Note({ children }: { children: ReactNode }) {
  const text = String(children)
  const [open, setOpen] = useState(false)
  const long = text.length > 200
  return (
    <div className="mb-3 rounded-lg bg-sunk px-3 py-2 text-[13px] text-pretty text-soft">
      <p className={cx(long && !open && 'line-clamp-3')}><Described text={text} /></p>
      {long && <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-xs font-medium text-ink hover:underline">{open ? 'Less' : 'More'}</button>}
    </div>
  )
}

/** The game's own words, its numbers the data leaves out shown as X */
function Described({ text }: { text: string }) {
  const parts = text.split(/(?<=^|[\s(])\?(?=[\s%.,)]|$)/)
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span title="Not in the game data" className="mx-px rounded-[3px] bg-sunk px-1 text-[0.92em] font-medium text-muted">X</span>}
          {p}
        </span>
      ))}
    </>
  )
}

/** One number. In the patch: the patched value over live; in live: the corrected value over the game data. */
function Row({ set, space, layer, path, label, onValue }: { set: GameSet; space: Space; layer: Layer; path: string; label: string; onValue: Props['onValue'] }) {
  const meta = metaFor(set, path)
  const below = layer === 'patch' ? valueAt(set, path, space.live) : baseValue(set, path)
  const value = layer === 'patch' ? valueAt(set, path, space.live, space.patch) : valueAt(set, path, space.live)
  const changed = path in space[layer]
  const delta = changed ? (meta?.pct ? (value - below) * 100 : change(below, value) * 100) : null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem_1.75rem] items-center gap-x-1.5 py-px">
      <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-soft">
        <span className="line-clamp-2 leading-snug" title={label}>{label}</span>
        {delta !== null && Number.isFinite(delta) && Math.abs(delta) >= 0.5 && <span className="shrink-0 text-[11px] text-muted tabular-nums">{signed(delta, 0)}{meta?.pct ? 'pt' : '%'}</span>}
      </span>
      <span className="text-right text-xs text-muted tabular-nums">{changed ? `${num(toField(below, meta), 3)} →` : ''}</span>
      <NumberField value={value} meta={meta} state={changed ? layer : layer === 'patch' ? 'same' : 'base'} onCommit={(v) => onValue(layer, path, v)} label={`${label}, ${layer}`} className="w-full" />
      {changed ? (
        <button type="button" onClick={() => onValue(layer, path, null)} title={`Back to ${num(toField(below, meta), 3)}`} aria-label={`Undo the change to ${label}`} className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-sunk hover:text-ink">
          <Reset width={15} height={15} />
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}

const ROLE_WORD: Record<string, string> = { tank: 'Tank', fighter: 'Fighter', assassin: 'Assassin', caster: 'Caster', marksman: 'Marksman', specialist: 'Specialist' }

/** A trait's values that are the same at every breakpoint */
const single = (values?: Values) => {
  const out = Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => v.v.length <= 1))
  return Object.keys(out).length ? (out as Values) : null
}

/** A script's numbers: the ones that change with stars first, a field per star under one heading, then the rest */
function ValueRows({ set, space, layer, prefix, values, onValue, onReset }: { set: GameSet; space: Space; layer: Layer; prefix: string; values: Values; onValue: Props['onValue']; onReset: (prefix: string) => void }) {
  const list = Object.entries(values), starred = list.filter(([, v]) => v.v.length > 1), flat = list.filter(([, v]) => v.v.length <= 1)
  return (
    <div className="flex flex-col">
      {starred.length > 0 && (
        <div className="mb-1 rounded-xl border border-line bg-panel px-3 pt-2 pb-2">
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_1.75rem] gap-x-1.5">
            {[1, 2, 3].map((s) => <span key={s} className="pr-2 text-right text-[11px] text-muted">{s}★</span>)}
          </div>
          {starred.map(([name, v]) => (
            <div key={name} className="mt-1.5">
              <p className="text-[13px] leading-snug text-pretty text-soft">{v.label}</p>
              <StarRow set={set} space={space} layer={layer} prefix={`${prefix}.$${name}`} onValue={onValue} onReset={onReset} head={false} />
            </div>
          ))}
        </div>
      )}
      {flat.map(([name, v]) => <Row key={name} set={set} space={space} layer={layer} path={valuePaths(prefix, name, v)[0]} label={v.label} onValue={onValue} />)}
    </div>
  )
}

/** An effect's value at 1, 2 and 3 stars */
function StarRow({ set, space, layer, prefix, onValue, onReset, head = true }: { set: GameSet; space: Space; layer: Layer; prefix: string; onValue: Props['onValue']; onReset: (prefix: string) => void; head?: boolean }) {
  const stars = [1, 2, 3]
  const touched = stars.some((s) => `${prefix}.v${s}` in space[layer])
  return (
    <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_1.75rem] items-center gap-x-1.5 gap-y-0.5">
      {head && stars.map((s) => <span key={s} className="pr-2 text-right text-[11px] text-muted">{s}★</span>)}
      {head && <span />}
      {stars.map((s) => {
        const path = `${prefix}.v${s}`, meta = metaFor(set, path)
        const value = layer === 'live' ? valueAt(set, path, space.live) : valueAt(set, path, space.live, space.patch)
        const changed = path in space[layer]
        return <NumberField key={s} value={value} meta={meta} state={changed ? layer : layer === 'patch' ? 'same' : 'base'} onCommit={(v) => onValue(layer, path, v)} label={`${meta?.label ?? 'Value'} at ${s} star${s > 1 ? 's' : ''}, ${layer}`} className="w-full" />
      })}
      {touched ? (
        <button type="button" title="Undo these changes" aria-label="Undo the changes to this effect" onClick={() => onReset(prefix)} className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-sunk hover:text-ink">
          <Reset width={15} height={15} />
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}

/** An item's or a breakpoint's bonuses, plus any stat you add */
function BonusRows({ set, space, layer, prefix, bonus, onValue, title }: { set: GameSet; space: Space; layer: Layer; prefix: string; bonus: Bonus; onValue: Props['onValue']; title?: string }) {
  const [added, setAdded] = useState<string[]>([])
  const keys = useMemo(() => {
    const touched = Object.keys({ ...space.live, ...space.patch }).filter((p) => p.startsWith(`${prefix}.`)).map((p) => p.slice(prefix.length + 1))
    return BONUS_KEYS.filter((k) => (bonus[k] ?? 0) !== 0 || touched.includes(k) || added.includes(k))
  }, [bonus, space.live, space.patch, prefix, added])
  const free = BONUS_KEYS.filter((k) => !keys.includes(k))
  const add = keys.length ? 'Add a stat' : title ? `Add a stat ${title.replace(/^For /, 'for ')}` : 'None. Add a stat'
  return (
    <div>
      {title && keys.length > 0 && <p className="mt-2 text-xs text-muted">{title}</p>}
      {keys.map((k) => <Row key={k} set={set} space={space} layer={layer} path={`${prefix}.${k}`} label={BONUS_META[k].label} onValue={onValue} />)}
      {free.length > 0 && (
        // The words are laid out as text and the list sits invisibly over them, so they never get cut short
        <label className="relative mt-0.5 inline-flex h-7 max-w-full items-center gap-1 rounded-md pr-1.5 pl-0.5 text-[13px] text-muted focus-within:text-ink focus-within:ring-2 focus-within:ring-accent hover:text-ink">
          <Plus width={15} height={15} className="shrink-0" />
          <span className="truncate">{add}</span>
          <select aria-label={add} value="" onChange={(e) => { const k = e.target.value; if (k) setAdded((a) => [...a, k]) }} className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0">
            <option value="">{add}</option>
            {free.map((k) => <option key={k} value={k}>{BONUS_META[k].label}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
