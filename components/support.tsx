'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { site } from '@/lib/site.ts'
import { Close, Heart } from './icons.tsx'
import { cx } from './ui.tsx'

// A quiet note asking for support on Patreon, under the results once a run is done. "Not now" hides it on this device for
// four months; the header link stays.

const KEY = 'patchlab:support-hidden'
const QUIET = 120 * 864e5

export function SupportNote({ children, className }: { children: ReactNode; className?: string }) {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    try { const at = Number(localStorage.getItem(KEY)); if (at && Date.now() - at < QUIET) setHidden(true) } catch { /* storage blocked: the note stays */ }
  }, [])
  if (hidden) return null
  const hide = () => {
    setHidden(true)
    try { localStorage.setItem(KEY, String(Date.now())) } catch { /* storage blocked: hidden until the next visit */ }
  }
  return (
    <aside aria-label="Support Patchlab" className={cx('flex items-start gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3.5 text-[13px] leading-relaxed text-soft', className)}>
      <Heart width={16} height={16} className="mt-px shrink-0 text-accent" fill="currentColor" />
      <p className="min-w-0 flex-1 text-pretty">
        {children}{' '}
        <a href={site.patreon} target="_blank" rel="noopener" className="font-semibold whitespace-nowrap text-ink underline decoration-accent/50 underline-offset-[3px] hover:decoration-accent">Support on Patreon</a>
      </p>
      <button type="button" onClick={hide} title="Not now" aria-label="Hide this note" className="-mt-1 -mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-sunk hover:text-ink"><Close width={14} height={14} /></button>
    </aside>
  )
}
