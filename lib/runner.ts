import { mergePaired, runPaired, type Paired } from '@/engine/batch.ts'
import { prepare, type Prepared } from '@/engine/prepare.ts'
import type { Boards, GameSet } from '@/engine/types.ts'
import type { FromWorker, ToWorker } from '@/engine/worker.ts'

// Runs fights on every core: the run is cut into slices handed out to a pool of workers as they free up, and the
// tallies so far are reported as they come in, so the numbers settle in front of you. A slice is sized by the clock
// (about a tenth of a second of fights) and a worker holds one at a time: the first numbers show up after a handful
// of fights, and a stopped run frees its workers in a moment instead of leaving them a queue to finish.

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

/** Fights in a worker's first slice: few, so the first result comes at once */
const FIRST = 8
/** How long a slice should take, in milliseconds: progress stays smooth and a stop is felt right away */
const SLICE_MS = 100
const MAX_SLICE = 400
/** How long the page fights before it lets the browser draw and listen again (when there are no workers) */
const BURST_MS = 12
/** A worker still fighting this long after its run was stopped is let go: a worker can't be interrupted */
const GRACE_MS = 500

/** A worker, and the run it is fighting a slice of (0: free) */
interface Slot { worker: Worker; busy: number }

let pool: Slot[] = []
let runs = 0

/** Workers to use: every core but one, at most 8; fewer on a device that says it is short of memory (each worker
 *  holds its own copy of the set and of the fights' numbers) */
export function poolSize(cores: number = navigator.hardwareConcurrency || 4, memory: number | undefined = (navigator as { deviceMemory?: number }).deviceMemory): number {
  const most = memory === undefined || memory > 4 ? 8 : memory > 2 ? 4 : 2
  return Math.max(1, Math.min(most, Math.floor(cores) - 1))
}

function drop(slot: Slot) {
  slot.worker.onmessage = null
  slot.worker.onerror = null
  slot.worker.terminate()
  pool = pool.filter((s) => s !== slot)
}

/** The pool, ready for a run: workers still on a slice of a stopped run are replaced (the new run would wait behind
 *  it), and the pool is filled back up to its size */
function workers(): Slot[] {
  for (const slot of pool) if (slot.busy) drop(slot)
  try {
    for (let k = pool.length, size = poolSize(); k < size; k++) {
      const slot: Slot = { worker: new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' }), busy: 0 }
      // A worker that breaks before or between runs (its script didn't load) leaves the pool
      slot.worker.onerror = (e) => { e.preventDefault(); drop(slot) }
      pool.push(slot)
    }
  } catch {
    /* no workers here (an old browser, or blocked): the run fights on the page */
  }
  return pool
}

/** Starts the workers ahead of the first run, so it doesn't wait for them */
export function warmUp() {
  if (!pool.length) workers()
}

/** Fights on the page, in bursts short enough that it stays responsive */
function onPage(o: RunOptions, stopped: () => boolean, resolve: (p: Paired) => void, reject: (e: Error) => void) {
  let live: Prepared, patch: Prepared | null
  try {
    live = prepare(o.live, o.boards)
    patch = o.patch ? prepare(o.patch, o.boards) : null
  } catch (e) {
    return reject(e instanceof Error ? e : new Error(String(e)))
  }
  let at = 0, total: Paired | null = null
  const burst = () => {
    if (stopped()) return
    try {
      const until = performance.now() + BURST_MS
      do {
        const n = Math.max(0, Math.min(2, o.fights - at))
        const part = runPaired(live, patch, o.seed, at, n)
        total = total ? mergePaired(total, part) : part
        at += n
      } while (at < o.fights && performance.now() < until)
    } catch (e) {
      return reject(e instanceof Error ? e : new Error(String(e)))
    }
    o.onProgress(Math.min(at, o.fights), total)
    if (at >= o.fights) resolve(total)
    else setTimeout(burst, 0)
  }
  burst()
}

export function startRun(o: RunOptions): RunHandle {
  const run = ++runs
  let cancelled = false, settled = false, stop: (e: Error) => void = () => {}
  let mine: Slot[] = []
  const done = new Promise<Paired>((res, rej) => {
    const resolve = (p: Paired) => { settled = true; res(p) }
    const reject = (e: Error) => { settled = true; rej(e) }
    stop = reject
    const list = o.fights > 0 ? workers() : []
    if (!list.length) return onPage(o, () => cancelled, resolve, reject)
    mine = [...list]
    let next = 0, finished = 0, total: Paired | null = null, id = 0, failed = false
    // Workers that can't be used (their script didn't load, or one broke) are let go, and the run starts over on the
    // page, which fights the same seeds
    const fail = () => {
      if (failed || cancelled || settled) return
      failed = true
      for (const slot of mine) drop(slot)
      mine = []
      onPage(o, () => cancelled, resolve, reject)
    }
    const give = (slot: Slot, count: number) => {
      if (next >= o.fights) return
      count = Math.min(count, o.fights - next)
      const job: ToWorker = { type: 'job', run, id: id++, seed: o.seed, from: next, count }
      next += count
      slot.busy = run
      const sent = performance.now()
      slot.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        if (e.data.run !== run) return
        slot.busy = 0
        if (cancelled || failed || settled) return
        // A fight failed in the worker: it would fail on the page too, so the run ends here and says why
        const part = e.data.result
        if (!part) return reject(new Error(e.data.error || 'a fight failed'))
        total = total ? mergePaired(total, part) : part
        finished += part.live.fights || 0
        // Sides that can't fight answer with no fights: the run is over once every slice is handed out
        const all = finished >= o.fights || (part.live.fights === 0 && next >= o.fights)
        o.onProgress(Math.min(finished, o.fights), total)
        if (all) return resolve(total)
        // The next slice: as many fights as fit the time a slice should take, at the pace of the last one. The first
        // one also paid for the worker's start, so slices grow by steps.
        const pace = (performance.now() - sent) / count
        give(slot, Math.max(4, Math.min(MAX_SLICE, count * 4, Math.round(SLICE_MS / Math.max(0.01, pace)))))
      }
      slot.worker.postMessage(job)
    }
    const setup: ToWorker = { type: 'setup', run, live: o.live, patch: o.patch, boards: o.boards }
    for (const slot of mine) {
      slot.worker.onerror = (e) => { e.preventDefault(); drop(slot); fail() }
      try {
        slot.worker.postMessage(setup)
        give(slot, FIRST)
      } catch {
        return fail()
      }
    }
  })
  return {
    done,
    cancel: () => {
      if (cancelled) return
      cancelled = true
      runs++
      if (!settled) stop(new Error('cancelled'))
      // A worker hears nothing while it fights. Slices are short, so it is free again in a moment; one that isn't
      // (numbers that make a fight endless) is let go rather than left running
      const busy = mine.filter((slot) => slot.busy === run)
      if (busy.length) setTimeout(() => { for (const slot of busy) if (slot.busy === run) drop(slot) }, GRACE_MS)
    },
  }
}
