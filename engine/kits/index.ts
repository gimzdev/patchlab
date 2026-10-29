import type { Kit } from '../fight.ts'
import { tft18 } from './tft18.ts'

// The scripts that play a set as its game does, by the set's `kit`. A set without one (the sandbox, sets of your own,
// a TFT set newer than the scripts) fights with each ability's effects list instead.
export const KITS: Record<string, Kit> = { tft18 }
