import { runPaired, type Paired } from './batch.ts'
import { prepare, type Prepared } from './prepare.ts'
import type { Boards, GameSet } from './types.ts'

// A simulation worker. A run starts with a setup message (the numbers and boards, sent once), then jobs: slices of the
// run, each fought with the live numbers and the patched ones on the same seeds, answered with their tallies.

export type ToWorker =
  | { type: 'setup'; run: number; live: GameSet; patch: GameSet | null; boards: Boards }
  | { type: 'job'; run: number; id: number; seed: number; from: number; count: number }
export interface FromWorker {
  run: number
  id: number
  result: Paired
}

let current: { run: number; live: Prepared; patch: Prepared | null } | null = null

const scope = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; postMessage: (r: FromWorker) => void }
scope.onmessage = ({ data }) => {
  if (data.type === 'setup') {
    current = { run: data.run, live: prepare(data.live, data.boards), patch: data.patch ? prepare(data.patch, data.boards) : null }
    return
  }
  if (!current || current.run !== data.run) return
  const result = runPaired(current.live, current.patch, data.seed, data.from, data.count)
  scope.postMessage({ run: data.run, id: data.id, result })
}
