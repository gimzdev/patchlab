import { mergePaired, runPaired, type Paired } from '@/engine/batch.ts'
import { prepare } from '@/engine/prepare.ts'
import type { Boards, GameSet } from '@/engine/types.ts'
import type { FromWorker, ToWorker } from '@/engine/worker.ts'

// Runs fights on every core: the run is cut into slices handed out to a pool of workers as they free up, and the
// tallies so far are reported as they come in, so the numbers settle in front of you.

export interface RunOptions {
  live: GameSet
  patch: GameSet | null
  boards: Boards
  seed: number
  fights: number
  onProgress: (done: number, sofar: Paired) => void
}
export interface RunHandle {
  done: Promise<Paired>
  cancel: () => void
}

let pool: Worker[] | null = null
let runs = 0

function workers(): Worker[] {
  if (pool) return pool
  const size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
  try {
    pool = Array.from({ length: size }, () => new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' }))
  } catch {
    pool = []
  }
  return pool
}

export function startRun(o: RunOptions): RunHandle {
  const run = ++runs
  let cancelled = false, stop: (e: Error) => void = () => {}
  const list = workers()
  const slice = Math.max(25, Math.min(500, Math.ceil(o.fights / Math.max(1, list.length * 6))))
  const done = new Promise<Paired>((resolve, reject) => {
    stop = reject
    // No workers (an old browser, or blocked): fight on the page in short bursts so it stays responsive
    if (!list.length) {
      const live = prepare(o.live, o.boards), patch = o.patch ? prepare(o.patch, o.boards) : null
      let at = 0, total: Paired | null = null
      const burst = () => {
        if (cancelled) return reject(new Error('cancelled'))
        const n = Math.min(slice, o.fights - at)
        const part = runPaired(live, patch, o.seed, at, n)
        total = total ? mergePaired(total, part) : part
        at += n
        o.onProgress(at, total)
        if (at >= o.fights) resolve(total)
        else setTimeout(burst, 0)
      }
      burst()
      return
    }
    let next = 0, finished = 0, total: Paired | null = null, id = 0
    const setup: ToWorker = { type: 'setup', run, live: o.live, patch: o.patch, boards: o.boards }
    const give = (w: Worker) => {
      if (next >= o.fights) return
      const count = Math.min(slice, o.fights - next)
      const job: ToWorker = { type: 'job', run, id: id++, seed: o.seed, from: next, count }
      next += count
      w.postMessage(job)
    }
    for (const w of list) {
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        if (e.data.run !== run || cancelled) return
        total = total ? mergePaired(total, e.data.result) : e.data.result
        finished += e.data.result.live.fights || 0
        const all = finished >= o.fights || (e.data.result.live.fights === 0 && next >= o.fights)
        o.onProgress(Math.min(finished, o.fights), total)
        if (all) resolve(total)
        else give(w)
      }
      w.onerror = (e) => {
        e.preventDefault()
        if (!cancelled) reject(new Error(e.message || 'A simulation worker failed'))
      }
      w.postMessage(setup)
    }
    // Two slices per worker to start with, so none sits idle waiting for its next one
    for (let k = 0; k < 2; k++) for (const w of list) give(w)
  })
  return {
    done,
    cancel: () => {
      if (cancelled) return
      cancelled = true
      runs++
      stop(new Error('cancelled'))
    },
  }
}
