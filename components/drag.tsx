'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Comp } from '@/lib/comps.ts'

// Dragging with pointer events, so it works with a mouse, a pen or a finger: a comp, a unit or an item from the
// library onto the board, or a unit on the board to another hex (or off the board to take it off). A press that
// doesn't move is a click. The dragged picture follows the pointer without React: only the hex under it is state.

export type Payload = { kind: 'unit'; unit: string } | { kind: 'piece'; cell: number } | { kind: 'item'; item: string } | { kind: 'comp'; comp: Comp }
export interface DragState {
  payload: Payload
  /** The hex under the pointer */
  over: number | null
  onBoard: boolean
}

interface Ctx {
  drag: DragState | null
  begin: (e: ReactPointerEvent, payload: Payload, preview: ReactNode) => void
}
const DragContext = createContext<Ctx>({ drag: null, begin: () => {} })
export const useDrag = () => useContext(DragContext)

export function DragProvider({ children, onDrop }: { children: ReactNode; onDrop: (payload: Payload, cell: number | null, onBoard: boolean) => void }) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [preview, setPreview] = useState<ReactNode>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const pending = useRef<{ x: number; y: number; id: number; payload: Payload; preview: ReactNode; active: boolean; shown: boolean; over: number | null; onBoard: boolean } | null>(null)
  const dropRef = useRef(onDrop)
  useEffect(() => { dropRef.current = onDrop }, [onDrop])

  const end = useCallback(() => {
    pending.current = null
    setDrag(null)
    setPreview(null)
    document.documentElement.classList.remove('dragging')
  }, [])

  useEffect(() => {
    const locate = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)
      const hex = el?.closest<SVGElement>('[data-cell]')
      return { over: hex ? Number(hex.dataset.cell) : null, onBoard: !!el?.closest('[data-board]') }
    }
    const place = (x: number, y: number) => { if (ghost.current) ghost.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)` }
    const move = (e: PointerEvent) => {
      const p = pending.current
      if (!p || e.pointerId !== p.id) return
      if (!p.active) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return
        p.active = true
        setPreview(p.preview)
        document.documentElement.classList.add('dragging')
      }
      e.preventDefault()
      place(e.clientX, e.clientY)
      const at = locate(e.clientX, e.clientY)
      if (!p.shown || at.over !== p.over || at.onBoard !== p.onBoard) {
        p.shown = true
        p.over = at.over
        p.onBoard = at.onBoard
        setDrag({ payload: p.payload, ...at })
      }
    }
    const up = (e: PointerEvent) => {
      const p = pending.current
      if (!p || e.pointerId !== p.id) return
      if (p.active) {
        const { over, onBoard } = locate(e.clientX, e.clientY)
        // The click that follows a drag isn't a click on whatever it ended over
        const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault() }
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
        dropRef.current(p.payload, over, onBoard)
      }
      end()
    }
    const cancel = () => end()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && pending.current?.active) end() }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', esc)
    }
  }, [end])

  const begin = useCallback((e: ReactPointerEvent, payload: Payload, node: ReactNode) => {
    if (e.button !== 0) return
    // On touch screens the library scrolls: comps, units and items are tapped there, then a hex is tapped
    if (e.pointerType === 'touch' && payload.kind !== 'piece') return
    pending.current = { x: e.clientX, y: e.clientY, id: e.pointerId, payload, preview: node, active: false, shown: false, over: null, onBoard: false }
    if (ghost.current) ghost.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`
  }, [])

  const value = useMemo(() => ({ drag, begin }), [drag, begin])
  return (
    <DragContext.Provider value={value}>
      {children}
      <div ref={ghost} aria-hidden className="pointer-events-none fixed top-0 left-0 z-[60]" style={{ visibility: preview ? 'visible' : 'hidden' }}>
        {preview}
        {drag?.payload.kind === 'piece' && !drag.onBoard && <span className="absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-md border border-line-strong bg-raised px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink">Drop to take off</span>}
      </div>
    </DragContext.Provider>
  )
}
