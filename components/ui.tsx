'use client'

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { fromField, round, toField, type FieldMeta } from '@/engine/patch.ts'
import { num } from '@/lib/format.ts'
import { Close } from './icons.tsx'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'plain' | 'quiet'; size?: 'sm' | 'md' | 'lg' }
export function Button({ tone = 'plain', size = 'md', className, ...p }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity] select-none disabled:pointer-events-none disabled:opacity-40',
        // A quiet button has no edge to pad out, so it sits tighter
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : size === 'lg' ? cx('h-11 text-[15px]', tone === 'quiet' ? 'px-3.5' : 'px-5') : 'h-9 px-3.5 text-sm',
        tone === 'primary' && 'bg-accent font-semibold text-accent-ink hover:bg-accent/90',
        tone === 'plain' && 'border border-line bg-panel text-ink hover:border-line-strong hover:bg-sunk',
        tone === 'quiet' && 'text-soft hover:bg-sunk hover:text-ink',
        className,
      )}
      {...p}
    />
  )
}

// Sizes and colours are props, not classes: a class can't override another of the same kind (the stylesheet's order decides)
export function IconButton({ label, className, size = 'md', tone = 'quiet', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md'; tone?: 'quiet' | 'solid' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-30', size === 'sm' ? 'size-8' : 'size-9', tone === 'solid' ? 'bg-accent text-accent-ink hover:bg-accent/90' : 'text-soft hover:bg-sunk hover:text-ink', className)}
      {...p}
    />
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, label, className, size = 'md' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-lg bg-sunk p-0.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md font-medium tabular-nums transition-colors',
            size === 'sm' ? 'h-7 min-w-8 px-2 text-xs' : 'h-8 min-w-9 px-2.5 text-[13px]',
            o.value === value ? 'bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.3),0_0_0_1px_var(--line)]' : 'text-soft hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Tabs that look like the segmented control, full width (the library) */
export function Tabs<T extends string>({ value, tabs, onChange, label, className }: { value: T; tabs: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; className?: string }) {
  const id = useId()
  const keys = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.value === value)
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : -1
    if (j < 0) return
    e.preventDefault()
    onChange(tabs[j].value)
    document.getElementById(`${id}-${tabs[j].value}`)?.focus()
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={keys} className={cx('flex rounded-lg bg-sunk p-0.5', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          id={`${id}-${t.value}`}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}
          className={cx('h-8 flex-1 rounded-md px-2 text-[13px] font-medium transition-colors', t.value === value ? 'bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.3),0_0_0_1px_var(--line)]' : 'text-soft hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** How a field relates to the numbers below it: the set's own, a live correction, a patch, or patch showing live */
export type FieldState = 'base' | 'live' | 'patch' | 'same'

const show = (value: number, meta?: FieldMeta) => {
  const v = toField(value, meta)
  return Number.isInteger(v) ? String(v) : String(round(v))
}

/**
 * A number you can type, step with the arrow keys (Shift for ×10) or clear to go back to the number below. It reads as
 * plain text until hovered or focused; a patched number wears the marker.
 */
export function NumberField({ value, meta, onCommit, state = 'base', label, className }: { value: number; meta?: FieldMeta; onCommit: (v: number | null) => void; state?: FieldState; label: string; className?: string }) {
  const [text, setText] = useState(() => show(value, meta))
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focused) setText(show(value, meta))
  }, [value, meta, focused])

  const clamp = (v: number) => {
    let x = v
    if (meta?.min !== undefined) x = Math.max(meta.pct ? meta.min / 100 : meta.min, x)
    if (meta?.max !== undefined) x = Math.min(meta.pct ? meta.max / 100 : meta.max, x)
    return x
  }
  const commit = () => {
    const t = text.trim().replace(/,/g, '.').replace(/[%×s]$/, '').replace('−', '-')
    if (t === '') { onCommit(null); return }
    const n = Number(t)
    if (!Number.isFinite(n)) { setText(show(value, meta)); return }
    const v = clamp(round(fromField(n, meta) * 1e6) / 1e6)
    if (Math.abs(v - value) > 1e-12) onCommit(v)
    else setText(show(value, meta))
  }
  const step = (dir: number, big: boolean) => {
    const s = (meta?.step ?? 1) * (big ? 10 : 1)
    const current = Number(text.replace(',', '.'))
    const base = Number.isFinite(current) ? current : toField(value, meta)
    const next = round(base + dir * s)
    const v = clamp(fromField(next, meta))
    setText(show(v, meta))
    if (Math.abs(v - value) > 1e-12) onCommit(v)
  }
  const suffix = meta?.pct ? (meta.unit ?? '%') : meta?.unit
  return (
    <span
      className={cx(
        'group relative inline-flex h-8 items-center rounded-md border transition-colors',
        state === 'patch' ? 'border-transparent bg-mark text-mark-ink' : state === 'live' ? 'border-dashed border-line-strong text-ink' : 'border-transparent text-ink hover:border-line-strong hover:bg-panel',
        state === 'same' && 'text-soft',
        'focus-within:!border-accent focus-within:bg-panel focus-within:text-ink',
        className ?? 'w-20',
      )}
    >
      <input
        ref={ref}
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => { setFocused(true); requestAnimationFrame(() => e.target.select()) }}
        onBlur={() => { setFocused(false); commit() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); ref.current?.blur() }
          else if (e.key === 'Escape') { setText(show(value, meta)); requestAnimationFrame(() => ref.current?.blur()) }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey) }
        }}
        className={cx('h-full w-full min-w-0 bg-transparent text-right text-[13px] font-medium tabular-nums outline-none', suffix ? (suffix.length > 2 ? 'pr-10 pl-1' : 'pr-6 pl-1.5') : 'px-2')}
      />
      {suffix && <span className="pointer-events-none absolute right-1.5 text-[11px] opacity-55">{suffix}</span>}
    </span>
  )
}

export interface MenuItem {
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  checked?: boolean
  danger?: boolean
}
export type MenuEntry = MenuItem | 'divider'

/** A button that opens a list of actions */
export function Menu({ trigger, triggerClass, items, label, align = 'start', className, width = 'min-w-60' }: { trigger: ReactNode; triggerClass: string; items: MenuEntry[]; label: string; align?: 'start' | 'end'; className?: string; width?: string }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()
  // Opens upward when there's more room above (near the bottom of the screen, or above the phone's bottom bar)
  const toggle = () => {
    const r = box.current?.getBoundingClientRect()
    if (r && !open) setUp(innerHeight - r.bottom < 320 && r.top > innerHeight - r.bottom)
    setOpen((o) => !o)
  }
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); box.current?.querySelector<HTMLButtonElement>('button')?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc, true)
    requestAnimationFrame(() => box.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not([disabled])')?.focus())
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true) }
  }, [open])
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const all = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not([disabled])') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
  }
  return (
    <div ref={box} className={cx('relative', className)}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} title={label} aria-label={typeof trigger === 'string' ? undefined : label} onClick={toggle} className={triggerClass}>
        {trigger}
      </button>
      {open && (
        <div id={id} role="menu" aria-label={label} onKeyDown={keys} className={cx('absolute z-50 max-h-[min(60dvh,32rem)] overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-pop', up ? 'bottom-full mb-1.5' : 'top-full mt-1.5', width, align === 'end' ? 'right-0' : 'left-0')}>
          {items.map((it, i) =>
            it === 'divider' ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onSelect() }}
                className={cx('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-sunk focus-visible:bg-sunk disabled:opacity-40', it.danger ? 'text-red' : 'text-ink')}
              >
                {it.icon && <span className="mt-px shrink-0 text-soft">{it.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">{it.label}{it.checked && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-accent" />}</span>
                  {it.hint && <span className="block text-xs text-muted">{it.hint}</span>}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** A panel that slides up over the page on phones and tablets */
export function Sheet({ open, title, onClose, children, actions }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!open) return
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    document.documentElement.classList.add('sheet-open')
    return () => { document.removeEventListener('keydown', esc); document.documentElement.classList.remove('sheet-open') }
  }, [open, onClose])
  if (!mounted || !open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <button type="button" aria-label="Close" onClick={onClose} className="sheet-scrim absolute inset-0 bg-[rgb(8_10_14/0.42)]" />
      <div className="sheet-panel absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-line bg-paper shadow-pop">
        <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</div>
          {actions}
          <IconButton label="Close" onClick={onClose}><Close /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-6 text-sm">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-[36ch] text-pretty text-soft">{children}</div>}
    </div>
  )
}

export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`
