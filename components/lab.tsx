'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { emptyTally } from '@/engine/batch.ts'
import { applyOverrides, clean } from '@/engine/patch.ts'
import { prepare } from '@/engine/prepare.ts'
import type { GameSet, Star } from '@/engine/types.ts'
import { asComp, loadSaved, metaComps, nameOf, onSide, storeSaved, traitComps, type Comp } from '@/lib/comps.ts'
import { count, short } from '@/lib/format.ts'
import { startRun, type RunHandle } from '@/lib/runner.ts'
import { BUILT_IN, CUSTOM, entryOf, exportSet, isRiot, loadSet, readSet, TFT } from '@/lib/sets.ts'
import { site } from '@/lib/site.ts'
import { boardsOf, change, decodeLink, encodeLink, FIGHTS, fit, loadCustom, loadDoc, pieceAt, sampleSpace, saveCustom, saveDoc, SEED, sideOfCell, withOpponent, type Action, type Doc, type Layer, type Space } from '@/lib/state.ts'
import { SANDBOX } from '@/sets/sandbox.ts'
import { BOARD_H, BOARD_W, Board, type Armed } from './board.tsx'
import { DragProvider, type Payload } from './drag.tsx'
import { Chevron, Download, Eye, GitHub, Layers, LinkIcon, Logo, Mirror, More, Redo, Save, Stop, Swap, Trash, Undo, Upload } from './icons.tsx'
import { Library, type LibraryTab } from './library.tsx'
import { PatchPanel, type Selection } from './patch.tsx'
import { createClock, makeReplay, ReplayBar, ReplayLayer, type ReplayData } from './replay.tsx'
import { Results, Summary, type RunResult } from './results.tsx'
import { Portrait } from './token.tsx'
import { TraitChips, TraitRail } from './traits.tsx'
import { Button, cx, IconButton, Menu, Segmented, Sheet } from './ui.tsx'

interface Toast { text: string; action?: { label: string; run: () => void } }
interface History { past: Doc[]; doc: Doc; future: Doc[] }
type SheetName = 'library' | 'patch' | null

const defaultStar = (cost: number): Star => (cost <= 3 ? 2 : 1)
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
const ASPECT = BOARD_W / BOARD_H
const WIDE = '(min-width: 1024px)'
const isWide = () => typeof matchMedia === 'function' && matchMedia(WIDE).matches
/** Wide screens show the library and the patch beside the board; phones open them as sheets (and skip rendering them) */
const useWide = () => useSyncExternalStore((f) => { const m = matchMedia(WIDE); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, isWide, () => true)

export function Lab() {
  const [sets, setSets] = useState<Record<string, GameSet>>({ [SANDBOX.id]: SANDBOX })
  const [hist, setHist] = useState<History>(() => ({ past: [], doc: { set: TFT, fights: 5000, spaces: {} }, future: [] }))
  const [ready, setReady] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [armed, setArmed] = useState<Armed>(null)
  const [layer, setLayer] = useState<Layer>('patch')
  const [libTab, setLibTab] = useState<LibraryTab>('comps')
  const [sheet, setSheet] = useState<SheetName>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [meta, setMeta] = useState<Comp[] | null | undefined>(undefined)
  const [saved, setSaved] = useState<Comp[]>([])
  const wide = useWide()
  const run = useRef<RunHandle | null>(null)
  const clock = useMemo(() => createClock(), [])
  const fileInput = useRef<HTMLInputElement>(null)
  const arenaBox = useRef<HTMLElement>(null)
  const boardBox = useRef<HTMLDivElement>(null)

  const doc = hist.doc
  const entry = doc.set
  const set = sets[entry] ?? SANDBOX
  const space: Space = doc.spaces[entry] ?? sampleSpace(set)
  const boards = useMemo(() => boardsOf(space), [space])
  const liveSet = useMemo(() => applyOverrides(set, space.live), [set, space.live])
  const patch = useMemo(() => clean(set, space.patch, space.live), [set, space.patch, space.live])
  const hasPatch = Object.keys(patch).length > 0
  const patchSet = useMemo(() => (hasPatch ? applyOverrides(set, space.live, patch) : null), [set, space.live, patch, hasPatch])
  const setupKey = useMemo(() => JSON.stringify([entry, boards, space.live, patch, doc.fights]), [entry, boards, space.live, patch, doc.fights])
  const stale = !!result && result.key !== setupKey
  const onBoard = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of space.pieces) m.set(p.unit, (m.get(p.unit) ?? 0) + 1)
    return m
  }, [space.pieces])
  const patched = useMemo(() => new Set(Object.keys(patch).filter((k) => k.startsWith('u.')).map((k) => k.split('.')[1])), [patch])
  const unitById = useMemo(() => new Map(set.units.map((u) => [u.id, u])), [set])
  // Comps built around traits, for sets MetaForge doesn't cover: a TFT set has the real ones
  const byTrait = useMemo(() => (set.kit ? [] : traitComps(set)), [set])
  const unitWord = entry === TFT ? 'Champions' : 'Units'

  const say = useCallback((text: string, action?: Toast['action']) => setToast({ text, action }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.action ? 5000 : 3200)
    return () => clearTimeout(t)
  }, [toast])

  /* ── The document: every change goes through here, so it can be undone ── */
  const commit = useCallback((next: (d: Doc) => Doc, undoable = true) => {
    setHist((h) => {
      const doc = next(h.doc)
      if (doc === h.doc) return h
      return undoable ? { past: [...h.past.slice(-99), h.doc], doc, future: [] } : { ...h, doc }
    })
  }, [])
  const act = useCallback(
    (a: Action) => commit((d) => {
      const current = d.spaces[d.set] ?? sampleSpace(set)
      const next = change(current, a, set)
      return next === current ? d : { ...d, spaces: { ...d.spaces, [d.set]: next } }
    }),
    [commit, set],
  )
  const undo = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), doc: h.past[h.past.length - 1], future: [h.doc, ...h.future] } : h)), [])
  const redo = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.doc], doc: h.future[0], future: h.future.slice(1) } : h)), [])
  const onValue = useCallback((l: Layer, path: string, value: number | null) => act({ type: 'value', layer: l, path, value }), [act])

  const stopRun = useCallback(() => {
    run.current?.cancel()
    run.current = null
    setResult((r) => (r?.running ? { ...r, running: false } : r))
  }, [])

  /* ── Sets ── */
  /** A space on a set: fitted to it, and the set's sample boards when nothing of it is left */
  const settle = (s: GameSet, from?: Space) => {
    const fitted = fit(from ?? sampleSpace(s), s)
    return fitted.pieces.length || !from ? fitted : { ...fitted, pieces: sampleSpace(s).pieces }
  }
  const openSet = useCallback(
    async (id: string, space?: Space, fights?: number, given?: GameSet) => {
      try {
        const s = given ?? sets[id] ?? (await loadSet(id))
        setSets((all) => ({ ...all, [id]: s }))
        stopRun()
        setResult(null)
        setReplay(null)
        setSelection(null)
        setArmed(null)
        setHist((h) => ({ past: [], future: [], doc: { set: id, fights: fights ?? h.doc.fights, spaces: { ...h.doc.spaces, [id]: settle(s, space ?? h.doc.spaces[id]) } } }))
        return true
      } catch (e) {
        say(e instanceof Error ? e.message : 'That set could not be loaded.')
        return false
      }
    },
    // settle reads nothing from the component
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sets, say, stopRun],
  )

  const adoptCustom = useCallback(
    (json: unknown, announce = true) => {
      try {
        const { set: s, warnings } = readSet(json)
        const mine: GameSet = { ...s, id: CUSTOM }
        setSets((all) => ({ ...all, [CUSTOM]: mine }))
        saveCustom(mine)
        if (announce) say(`Loaded ${mine.name}: ${mine.units.length} units${warnings.length ? `, ${warnings.length} thing${warnings.length > 1 ? 's' : ''} fixed on the way` : ''}.`)
        return mine
      } catch (e) {
        say(e instanceof Error ? e.message : "That file isn't a set Patchlab can read.")
        return null
      }
    },
    [say],
  )

  /* ── First load: a shared link, or what you had last time, or the current TFT set ── */
  const findSet = async (id: string, extra: Record<string, GameSet>): Promise<[string, GameSet] | null> => {
    const e = entryOf(id)
    if (e === SANDBOX.id) return [e, SANDBOX]
    if (extra[e]) return [e, extra[e]]
    const s = await loadSet(e).catch(() => null)
    return s ? [e, s] : null
  }
  /** A link's space on its set: fitted, with a sample opponent when it brings one side only */
  const sharedSpace = (shared: { space: Space }, s: GameSet) => {
    const { space, filled } = withOpponent(fit(shared.space, s), s)
    return { space, note: filled === null ? 'Opened a shared setup.' : `Opened a shared board. ${filled ? 'Red' : 'Blue'} is a sample board to fight it: put any comp there.` }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const stored = loadCustom()
      const extra: Record<string, GameSet> = {}
      if (stored) {
        try { extra[CUSTOM] = { ...readSet(stored).set, id: CUSTOM } } catch { /* a broken save: ignored */ }
      }
      const code = /^#s=(.+)$/.exec(location.hash)?.[1]
      const shared = code ? await decodeLink(code) : null
      if (code) history.replaceState(null, '', location.pathname + location.search)
      if (shared?.custom) {
        try { extra[CUSTOM] = { ...readSet(shared.custom).set, id: CUSTOM }; saveCustom(extra[CUSTOM]) } catch { /* the link's set is broken: fall through */ }
      }
      const saved = loadDoc()
      const want = shared ? shared.set : saved?.set ?? TFT
      let note: string | null = code && !shared ? "That link couldn't be read: it may have been cut short." : null
      let found = await findSet(want, extra)
      if (!found && entryOf(want) !== SANDBOX.id) {
        note = entryOf(want) === TFT ? 'The TFT set couldn’t be loaded right now, so you’re on the sandbox set.' : `The set “${want}” isn’t available any more, so you’re on the sandbox set.`
        found = [SANDBOX.id, SANDBOX]
      }
      if (cancelled || !found) return
      const [e, s] = found
      const spaces = saved?.spaces ?? {}
      let space = settle(s, spaces[e])
      if (shared) ({ space, note } = sharedSpace(shared, s))
      extra[e] = s
      setSets((all) => ({ ...all, ...extra }))
      setHist({ past: [], future: [], doc: { set: e, fights: shared?.fights ?? saved?.fights ?? 5000, spaces: { ...spaces, [e]: space } } })
      if (note) say(note)
      setReady(true)
    })()
    return () => { cancelled = true }
    // Once, on the first visit to the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A link pasted into this tab changes only the hash: open it the same way
  const openSetRef = useRef(openSet)
  useEffect(() => { openSetRef.current = openSet }, [openSet])
  useEffect(() => {
    const onHash = async () => {
      const code = /^#s=(.+)$/.exec(location.hash)?.[1]
      if (!code) return
      history.replaceState(null, '', location.pathname + location.search)
      const shared = await decodeLink(code)
      if (!shared) return say("That link couldn't be read: it may have been cut short.")
      const extra: Record<string, GameSet> = {}
      if (shared.custom) {
        try { extra[CUSTOM] = { ...readSet(shared.custom).set, id: CUSTOM }; saveCustom(extra[CUSTOM]) } catch { /* broken: ignored */ }
      }
      const found = await findSet(shared.set, extra)
      if (!found) return say(`The set “${shared.set}” isn't available right now.`)
      const { space, note } = sharedSpace(shared, found[1])
      if (await openSetRef.current(found[0], space, shared.fights, found[1])) say(note)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // findSet and sharedSpace only read module-level values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say])

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => saveDoc(doc), 250)
    return () => clearTimeout(t)
  }, [doc, ready])

  /* ── Comps: MetaForge's (TFT), yours, and the ones built per trait ── */
  useEffect(() => { setSaved(loadSaved(entry)) }, [entry])
  useEffect(() => {
    if (!ready) return
    if (entry !== TFT) { setMeta(null); return }
    let live = true
    setMeta(undefined)
    metaComps(set).then((c) => { if (live) setMeta(c) })
    return () => { live = false }
  }, [entry, ready, set])

  const putComp = useCallback(
    (comp: Comp, side: 0 | 1) => {
      act({ type: 'side', side, pieces: onSide(comp, side) })
      setSelection(null)
      setArmed(null)
      setSheet(null)
      say(`${comp.name} is on ${side ? 'red' : 'blue'}.`, { label: 'Undo', run: undo })
    },
    [act, say, undo],
  )
  const saveSide = useCallback(
    (side: 0 | 1) => {
      const pieces = (side ? boards.red : boards.blue)
      if (!pieces.length) return say('That side is empty.')
      const comp: Comp = { id: `saved:${Date.now().toString(36)}`, name: nameOf(set, pieces), source: 'saved', pieces: asComp(pieces, side) }
      setSaved((list) => { const next = [comp, ...list].slice(0, 40); storeSaved(entry, next); return next })
      say(`Saved ${comp.name} with your comps.`, { label: 'Show', run: () => { setLibTab('comps'); if (!isWide()) setSheet('library') } })
    },
    [boards, entry, say, set],
  )
  const forget = useCallback((id: string) => setSaved((list) => { const next = list.filter((c) => c.id !== id); storeSaved(entry, next); return next }), [entry])

  /* ── The board ── */
  const place = useCallback(
    (unit: string, cell: number) => {
      const u = set.units.find((x) => x.id === unit)
      if (!u) return
      act({ type: 'place', unit, cell, star: pieceAt(space, cell)?.star ?? defaultStar(u.cost) })
      setSelection({ kind: 'piece', cell })
    },
    [act, set, space],
  )
  const equip = useCallback(
    (cell: number, item: string) => {
      const p = pieceAt(space, cell)
      if (!p) return say('Items go on units: drop it on one.')
      const name = set.units.find((u) => u.id === p.unit)?.name ?? 'That unit'
      if (p.items.length >= 3) return say(`${name} already holds 3 items. Take one off first.`)
      act({ type: 'equip', cell, item })
      setSelection({ kind: 'piece', cell })
    },
    [act, say, set, space],
  )
  const remove = useCallback(
    (cell: number) => {
      const p = pieceAt(space, cell)
      if (!p) return
      act({ type: 'remove', cell })
      setSelection((s) => (s?.kind === 'piece' && s.cell === cell ? null : s))
      say(`Took ${set.units.find((u) => u.id === p.unit)?.name ?? 'the unit'} off the board.`, { label: 'Undo', run: undo })
    },
    [act, say, set, space, undo],
  )
  const onCell = useCallback(
    (cell: number, pointer: string) => {
      if (replay) return
      const p = pieceAt(space, cell)
      if (armed?.kind === 'unit') { place(armed.id, cell); setArmed(null); return }
      if (armed?.kind === 'item') { equip(cell, armed.id); if (p) setArmed(null); return }
      if (p) { setSelection((s) => (s?.kind === 'piece' && s.cell === cell ? null : { kind: 'piece', cell })); return }
      // A finger (or the keyboard) moves the selected unit to the empty hex; a mouse drags it there, and its click lets go
      if (pointer !== 'mouse' && selection?.kind === 'piece' && pieceAt(space, selection.cell)) {
        act({ type: 'move', from: selection.cell, to: cell })
        setSelection({ kind: 'piece', cell })
        return
      }
      setSelection(null)
    },
    [act, armed, equip, place, replay, selection, space],
  )
  const onDrop = useCallback(
    (payload: Payload, cell: number | null, onTheBoard: boolean) => {
      if (replay) return
      if (payload.kind === 'comp') { if (cell !== null) putComp(payload.comp, sideOfCell(cell)) }
      else if (payload.kind === 'unit' && cell !== null) place(payload.unit, cell)
      else if (payload.kind === 'item' && cell !== null) equip(cell, payload.item)
      else if (payload.kind === 'piece') {
        if (cell !== null) { act({ type: 'move', from: payload.cell, to: cell }); setSelection({ kind: 'piece', cell }) }
        else if (!onTheBoard) remove(payload.cell)
      }
      setArmed(null)
    },
    [act, equip, place, putComp, remove, replay],
  )

  /* ── Fights ── */
  const fightable = boards.blue.length > 0 && boards.red.length > 0
  const go = useCallback(() => {
    if (run.current) return stopRun()
    if (!fightable) return say('Put at least one unit on each side first.')
    setReplay(null)
    const units = prepare(liveSet, boards).fighters.map((f) => ({ unit: f.unit, name: f.name, star: f.star, side: f.side }))
    const t0 = performance.now(), fights = doc.fights
    setResult({ key: setupKey, fights, done: 0, ms: 0, running: true, units, paired: { live: emptyTally(units.length), patch: patchSet ? emptyTally(units.length) : null, gained: 0, lost: 0 } })
    let frame = 0
    const handle = startRun({
      live: liveSet, patch: patchSet, boards, seed: SEED, fights,
      onProgress: (done, sofar) => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => setResult((r) => (r && r.running && run.current === handle ? { ...r, done, paired: sofar } : r)))
      },
    })
    run.current = handle
    handle.done
      .then((paired) => {
        cancelAnimationFrame(frame)
        if (run.current !== handle) return
        run.current = null
        setResult((r) => (r ? { ...r, done: fights, paired, running: false, ms: performance.now() - t0 } : r))
      })
      .catch((e: Error) => {
        cancelAnimationFrame(frame)
        if (e.message !== 'cancelled') say(`The run stopped: ${e.message}`)
      })
  }, [boards, doc.fights, fightable, liveSet, patchSet, say, setupKey, stopRun])
  useEffect(() => () => run.current?.cancel(), [])

  const watch = useCallback(
    (which: 'live' | 'patch' = hasPatch ? 'patch' : 'live', index = Math.floor(Math.random() * 100000)) => {
      if (!fightable) return say('Put at least one unit on each side first.')
      const s = which === 'patch' && patchSet ? patchSet : liveSet
      const data = makeReplay(s, boards, SEED, index, patchSet ? which : 'live')
      setSelection(null)
      setArmed(null)
      setReplay(data)
      clock.load(data.duration)
      clock.play()
      boardBox.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    },
    [boards, clock, fightable, hasPatch, liveSet, patchSet, say],
  )
  const closeReplay = useCallback(() => { clock.pause(); setReplay(null) }, [clock])
  // A change to the board or the numbers ends the replay: it no longer shows this setup
  useEffect(() => { closeReplay() }, [setupKey, closeReplay])

  /* ── Links and files ── */
  const share = useCallback(async () => {
    const url = `${location.origin}${location.pathname}#s=${await encodeLink(doc, set.id === CUSTOM ? CUSTOM : set.id, sets[CUSTOM] ?? null)}`
    try {
      await navigator.clipboard.writeText(url)
      say('Link copied. It opens this exact setup, patch included.')
    } catch {
      history.replaceState(null, '', url)
      say('Copy the link from the address bar: it opens this exact setup.')
    }
  }, [doc, say, set.id, sets])
  const download = useCallback(() => {
    const blob = new Blob([exportSet({ ...liveSet, sample: boards })], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${entry === CUSTOM ? 'my-set' : set.id}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, [boards, entry, liveSet, set.id])
  const pickFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const mine = adoptCustom(JSON.parse(await file.text()))
        if (mine) {
          setSets((all) => ({ ...all, [CUSTOM]: mine }))
          setHist((h) => ({ past: [], future: [], doc: { ...h.doc, set: CUSTOM, spaces: { ...h.doc.spaces, [CUSTOM]: sampleSpace(mine) } } }))
          stopRun()
          setResult(null)
          setSelection(null)
        }
      } catch {
        say("That file isn't valid JSON.")
      }
    },
    [adoptCustom, say, stopRun],
  )

  /* ── Keys ── */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { if (typing(e.target)) return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { if (typing(e.target)) return; e.preventDefault(); redo(); return }
      if (mod || e.altKey || typing(e.target) || sheet) return
      if (e.key === 'Escape') { if (replay) closeReplay(); else if (armed) setArmed(null); else setSelection(null); return }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); go(); return }
      if (e.key === 'w' || e.key === 'W') { e.preventDefault(); if (replay) closeReplay(); else watch(); return }
      // Watching: Space plays and pauses, the arrows step a second (a focused button or slider handles its own keys)
      if (replay && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) {
        if (e.key === ' ') { e.preventDefault(); if (clock.state().startsWith('1')) clock.pause(); else clock.play(); return }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); clock.pause(); clock.seek(clock.time() + (e.key === 'ArrowLeft' ? -1 : 1)); return }
      }
      if (selection?.kind === 'piece' && !replay) {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(selection.cell) }
        else if (e.key === '1' || e.key === '2' || e.key === '3') act({ type: 'star', cell: selection.cell, star: Number(e.key) as Star })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [act, armed, clock, closeReplay, go, redo, remove, replay, selection, sheet, undo, watch])

  /* ── Library picks ── */
  // On a phone the library is a sheet: picking something closes it so the board is there to tap
  const pickUnit = useCallback((id: string) => {
    const off = armed?.kind === 'unit' && armed.id === id
    setArmed(off ? null : { kind: 'unit', id })
    setSelection({ kind: 'unit', id })
    if (!off) setSheet(null)
  }, [armed])
  const pickItem = useCallback((id: string) => {
    const off = armed?.kind === 'item' && armed.id === id
    setArmed(off ? null : { kind: 'item', id })
    setSelection({ kind: 'item', id })
    if (!off) setSheet(null)
  }, [armed])
  const pickTrait = useCallback((id: string) => { setArmed(null); setSelection({ kind: 'trait', id }); if (!isWide()) setSheet('patch') }, [])
  const onSelect = useCallback((s: Selection) => setSelection(s), [])

  const selectedTrait = selection?.kind === 'trait' ? selection.id : undefined
  const selectedCell = selection?.kind === 'piece' ? selection.cell : null
  const selectedPiece = selectedCell === null ? undefined : pieceAt(space, selectedCell)
  const selectedUnit = selectedPiece && set.units.find((u) => u.id === selectedPiece.unit)
  const entries = [...BUILT_IN, ...(sets[CUSTOM] ? [{ id: CUSTOM, name: sets[CUSTOM].name, source: 'Your set, imported from a file' }] : [])]
  const changes = Object.keys(patch).length

  const library = (
    <Library
      set={set}
      unitWord={unitWord}
      tab={libTab}
      onTab={setLibTab}
      armed={armed}
      inspecting={selection}
      comps={{ meta, trait: byTrait, saved }}
      onComp={putComp}
      onForget={forget}
      onUnit={pickUnit}
      onItem={pickItem}
      onTrait={pickTrait}
      onBoard={onBoard}
    />
  )
  const panel = <PatchPanel set={set} space={space} selection={selection} layer={layer} onLayer={setLayer} onValue={onValue} onAct={act} onSelect={onSelect} />
  const sideMenu = (side: 0 | 1) => (
    <Menu
      label={`${side ? 'Red' : 'Blue'} side`}
      align="end"
      trigger={<More />}
      triggerClass="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-sunk hover:text-ink"
      items={[
        { label: 'Save as a comp', hint: 'Keep this board in your comps', icon: <Save width={16} height={16} />, onSelect: () => saveSide(side) },
        { label: `Copy to ${side ? 'blue' : 'red'}`, hint: 'The same board on both sides', icon: <Mirror width={16} height={16} />, onSelect: () => act({ type: 'mirror', from: side }) },
        { label: 'Swap the sides', hint: 'Blue plays red’s board and red plays blue’s', icon: <Swap width={16} height={16} />, onSelect: () => act({ type: 'swap' }) },
        'divider',
        { label: `Clear ${side ? 'red' : 'blue'}`, icon: <Trash width={16} height={16} />, onSelect: () => act({ type: 'clear', side }) },
      ]}
    />
  )
  const sideHead = (side: 0 | 1, stacked = false) => {
    const pieces = side ? boards.red : boards.blue
    const name = pieces.length ? nameOf(set, pieces) : 'Empty: drop a comp here'
    const plants = pieces.filter((p) => unitById.get(p.unit)?.plant).length, count = pieces.length - plants
    return (
      <div className={cx('flex min-w-0 gap-x-2', stacked ? 'flex-wrap items-center' : 'items-center')}>
        <span className={cx('size-2.5 shrink-0 rounded-full', side ? 'bg-red' : 'bg-blue')} />
        <span className="shrink-0 text-[13px] font-semibold text-ink">{side ? 'Red' : 'Blue'}</span>
        <span className="shrink-0 text-xs text-muted tabular-nums">{count} unit{count === 1 ? '' : 's'}{plants ? ` · ${plants} plant${plants === 1 ? '' : 's'}` : ''}</span>
        {!stacked && <span className="min-w-0 truncate text-[13px] text-soft" title={name}>{name}</span>}
        <span className="ml-auto shrink-0">{sideMenu(side)}</span>
        {stacked && <span className="w-full truncate text-[13px] text-soft" title={name}>{name}</span>}
      </div>
    )
  }
  // The board as big as the screen allows, with the run bar still in view
  const boardStyle = { '--aspect': ASPECT } as CSSProperties

  return (
    <DragProvider onDrop={onDrop}>
      <div className="flex min-h-dvh flex-col lg:h-dvh">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-paper/92 px-3 backdrop-blur sm:px-4">
          <a href="/" className="flex items-center gap-2 rounded-md pr-1 text-ink" aria-label="Patchlab, home">
            <Logo className="text-accent" />
            <span className="font-display text-[21px] leading-none font-[560] tracking-[-0.015em] max-sm:hidden">Patchlab</span>
          </a>
          <span className="mx-1.5 h-5 w-px bg-line max-sm:hidden" />
          <Menu
            label="Choose a set"
            width="w-80"
            trigger={<><span className={cx('max-w-[10rem] truncate transition-opacity', !ready && 'opacity-0')}>{set.name}</span>{set.version && <span className="font-normal text-muted max-md:hidden">Patch {set.version}</span>}<Chevron width={16} height={16} className="text-muted" /></>}
            triggerClass="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink hover:bg-sunk"
            items={[
              ...entries.map((e) => ({
                label: e.id === TFT && sets[TFT] ? `${sets[TFT].name}${sets[TFT].version ? `, patch ${sets[TFT].version}` : ''}` : e.name,
                hint: e.id === TFT ? 'The live game, updated with every patch' : e.source,
                checked: e.id === entry,
                onSelect: () => void openSet(e.id),
              })),
              'divider' as const,
              { label: 'Import a set', hint: 'A JSON file: your own game, or an exported set', icon: <Upload width={16} height={16} />, onSelect: () => fileInput.current?.click() },
              { label: 'Export this set', hint: 'With your live numbers, to edit or share', icon: <Download width={16} height={16} />, onSelect: download },
            ]}
          />
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = '' }} />
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!hist.past.length}><Undo /></IconButton>
            <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!hist.future.length}><Redo /></IconButton>
            <Button size="sm" onClick={share} className="mx-1"><LinkIcon width={16} height={16} /><span className="max-sm:hidden">Share</span></Button>
            <a href={site.repo} target="_blank" rel="noopener" aria-label="Patchlab on GitHub" title="Patchlab on GitHub" className="inline-flex size-9 items-center justify-center rounded-lg text-soft hover:bg-sunk hover:text-ink max-sm:hidden"><GitHub /></a>
          </div>
        </header>

        <main className={cx('flex-1 transition-opacity duration-200 lg:grid lg:min-h-0 lg:grid-cols-[16rem_minmax(0,1fr)_19.5rem] xl:grid-cols-[18.5rem_minmax(0,1fr)_22rem] min-[112.5rem]:grid-cols-[20.5rem_minmax(0,1fr)_25rem]', !ready && 'opacity-0')}>
          {wide && <aside className="hidden border-r border-line lg:flex lg:min-h-0 lg:flex-col" aria-label="Comps, units, items and traits">{library}</aside>}

          <section ref={arenaBox} className="@container lg:min-h-0 lg:overflow-y-auto lg:[container-type:size]" aria-label="Board and results">
            <div className="mx-auto w-full max-w-[84rem] px-3 pt-3 pb-28 sm:px-5 lg:pt-4 lg:pb-10">
              <div className="grid gap-x-6 beside:grid-cols-[13rem_minmax(0,1fr)] beside:@[62rem]:grid-cols-[14.5rem_minmax(0,1fr)]">
                {/* Each side's traits beside its half of the board, as in game, when the area is wide enough */}
                <aside className="relative hidden beside:block" aria-label="Traits">
                  <div className="absolute inset-0 flex flex-col justify-between gap-3">
                    {([1, 0] as const).map((side) => (
                      <div key={side} className="flex max-h-[calc(50%-0.375rem)] min-h-0 flex-col gap-2">
                        {sideHead(side, true)}
                        <div className="-mx-1 min-h-0 overflow-y-auto px-1">
                          <TraitRail set={set} pieces={side ? boards.red : boards.blue} onPick={pickTrait} selected={selectedTrait} />
                        </div>
                      </div>
                    ))}
                  </div>
                </aside>
                <div className="min-w-0">
                  <div className="mb-2.5 flex flex-col gap-1.5 beside:hidden">
                    {sideHead(1)}
                    <TraitChips set={set} pieces={boards.red} onPick={pickTrait} selected={selectedTrait} label="Red’s other traits" />
                  </div>
                  <div ref={boardBox} className="board-fit mx-auto w-full scroll-mt-4" style={boardStyle}>
                    <Board
                      set={set}
                      space={space}
                      selected={selectedCell}
                      armed={armed}
                      patched={patched}
                      onCell={onCell}
                      onRemove={remove}
                      label={`Board: red's half on top, blue's below. ${armed?.kind === 'unit' ? 'Choose a hex for the unit.' : ''}`}
                      overlay={replay ? <ReplayLayer data={replay} clock={clock} /> : undefined}
                    />
                  </div>
                  <div className="mt-2.5 flex flex-col gap-1.5 beside:hidden">
                    {sideHead(0)}
                    <TraitChips set={set} pieces={boards.blue} onPick={pickTrait} selected={selectedTrait} label="Blue’s other traits" />
                  </div>
                </div>
              </div>

              <div className="relative mt-4 overflow-hidden rounded-2xl border border-line bg-panel p-2">
                {replay ? (
                  <ReplayBar data={replay} clock={clock} hasPatch={!!patchSet} onWhich={(w) => watch(w, replay.index)} onAnother={() => watch(replay.which)} onClose={closeReplay} />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button tone="primary" size="lg" onClick={go} className="min-w-[11.5rem] @max-[34rem]:flex-1" disabled={!fightable && !result?.running} title="Run (R)">
                      {result?.running ? <><Stop width={16} height={16} />Stop</> : <>Run {count(doc.fights)} fights</>}
                    </Button>
                    <Segmented className="@max-[34rem]:order-3" label="Fights per run" value={doc.fights} onChange={(n) => commit((d) => ({ ...d, fights: n }), false)} options={FIGHTS.map((n) => ({ value: n, label: short(n), title: `${count(n)} fights` }))} />
                    <Button tone="quiet" size="lg" className="@max-[34rem]:order-2" onClick={() => watch()} disabled={!fightable} title="Watch one fight (W)" aria-label="Watch one fight"><Eye width={16} height={16} /><span className="@max-[44rem]:hidden">Watch</span></Button>
                    <div className="min-w-[10rem] flex-1 basis-0 px-1.5 @max-[34rem]:order-4 @min-[34rem]:pl-3">
                      {fightable ? <Summary result={result} stale={stale} hasPatch={hasPatch} /> : <p className="text-[13px] text-muted">Put a comp or a unit on each side to fight.</p>}
                    </div>
                  </div>
                )}
                {result?.running && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-sunk"><div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${(result.done / result.fights) * 100}%` }} /></div>}
              </div>

              {result && !replay && <div className="mt-6"><Results set={set} result={result} stale={stale} /></div>}
              <Credits riot={isRiot(entry)} />
            </div>
          </section>

          {wide && (
            <aside className="hidden border-l border-line lg:flex lg:min-h-0 lg:flex-col" aria-label="Patch">
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-8 2xl:px-5">{panel}</div>
            </aside>
          )}
        </main>
      </div>

      {/* Phones and tablets: the board fills the page; the library and the patch open as sheets from this bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        {armed ? (
          <div className="flex h-11 items-center gap-3 rounded-xl bg-accent px-3.5 text-sm font-medium text-accent-ink">
            <span className="min-w-0 flex-1 truncate">{armed.kind === 'unit' ? `Tap a hex for ${set.units.find((u) => u.id === armed.id)?.name ?? 'the unit'}` : `Tap a unit to give it ${set.items.find((i) => i.id === armed.id)?.name ?? 'the item'}`}</span>
            <button type="button" onClick={() => setArmed(null)} className="font-semibold underline underline-offset-2">Cancel</button>
          </div>
        ) : selectedPiece && selectedUnit && !replay ? (
          <div className="flex h-11 items-center gap-2">
            <Portrait set={set} unit={selectedUnit} size={34} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{selectedUnit.name}</span>
            <Segmented size="sm" label="Stars" value={selectedPiece.star} onChange={(st: Star) => selectedCell !== null && act({ type: 'star', cell: selectedCell, star: st })} options={[1, 2, 3].map((n) => ({ value: n as Star, label: `${n}★` }))} />
            <Button size="sm" tone="primary" onClick={() => setSheet('patch')}>Numbers</Button>
            <IconButton label="Take it off the board" size="sm" onClick={() => selectedCell !== null && remove(selectedCell)}><Trash /></IconButton>
          </div>
        ) : (
          <div className="grid h-11 grid-cols-2 gap-2">
            <Button className="h-11" onClick={() => setSheet('library')}><Layers width={17} height={17} />Comps & {unitWord.toLowerCase()}</Button>
            <Button className="h-11" onClick={() => setSheet('patch')}>
              Patch
              {changes > 0 && <span className="rounded-[4px] bg-mark px-1 text-[11px] leading-4 font-semibold text-mark-ink tabular-nums">{changes}</span>}
            </Button>
          </div>
        )}
      </div>
      <Sheet open={sheet === 'library' && !wide} title={`Comps, ${unitWord.toLowerCase()} and items`} onClose={() => setSheet(null)}>
        <div className="flex h-[80dvh] flex-col">{library}</div>
      </Sheet>
      <Sheet open={sheet === 'patch' && !wide} title={selection ? 'Numbers' : 'Patch'} onClose={() => setSheet(null)}>
        <div className="px-4 pt-3 pb-8">{panel}</div>
      </Sheet>

      {/* Toasts: above the phone's bottom bar; on wide screens in the patch panel's corner, clear of the board and the results */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:right-5 lg:bottom-5 lg:left-auto lg:px-0">
        {toast && (
          <div role="status" className="toast pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-line-strong bg-raised px-4 py-2.5 text-sm text-ink shadow-pop lg:max-w-[17rem] xl:max-w-[19.5rem] min-[112.5rem]:max-w-[22.5rem]">
            <span className="text-pretty">{toast.text}</span>
            {toast.action && <button type="button" onClick={() => { toast.action?.run(); setToast(null) }} className="shrink-0 font-semibold text-accent underline underline-offset-2">{toast.action.label}</button>}
          </div>
        )}
      </div>
    </DragProvider>
  )
}

function Credits({ riot }: { riot: boolean }) {
  return (
    <footer className="mt-14 border-t border-line pt-5 text-xs text-muted">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <a href={site.authorUrl} target="_blank" rel="noopener" className="hover:text-ink">Made by {site.author}</a>
        <a href={site.metaforge} target="_blank" rel="noopener" className="hover:text-ink">Part of MetaForge</a>
        <a href={site.repo} target="_blank" rel="noopener" className="hover:text-ink">Source on GitHub</a>
        {riot && <a href="https://www.communitydragon.org" target="_blank" rel="noopener" className="hover:text-ink">Game data: CommunityDragon</a>}
        {riot && <a href="https://tft.tools" target="_blank" rel="noopener" className="hover:text-ink">Ability and item numbers: tft.tools</a>}
      </p>
      <p className="mt-2 max-w-[90ch] text-pretty">
        {riot
          ? 'A simulator, not the game: abilities, items and traits play out as their descriptions say, on the game data’s numbers (for abilities and items, which it leaves out, the ones tft.tools decodes from the game, kept up to date with Riot’s patch notes), but some of what the game does isn’t simulated, so read results as directions. Patchlab isn’t endorsed by Riot Games and doesn’t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.'
          : 'A simulator, not the game: fights follow simple, open rules, so read the results as directions rather than predictions.'}
      </p>
    </footer>
  )
}

