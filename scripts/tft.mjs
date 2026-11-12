// The offline copy of the TFT set (sets/tft-snapshot.json).
// Run at install and before every build (npm run build runs it first). The app's /sets/tft.json route serves this copy
// while it is fresh, then the set as it is on CommunityDragon, every few hours, so the app follows each patch. The kit
// (sets/tft18-kit.json) gives Set 18 the ability and item numbers the game data leaves out.
//   node scripts/tft.mjs                 download the current set
//   node scripts/tft.mjs --file en.json [--version 16.21]   build it from a copy of CommunityDragon's en_us.json instead
// If the download fails, the last copy is kept; with no copy at all the app offers the sandbox set until it can fetch.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { convert, fetchCurrent } from '../lib/tft.mjs'

const SNAPSHOT = 'sets/tft-snapshot.json'
const KIT = 'sets/tft18-kit.json'

async function main() {
  const args = process.argv.slice(2)
  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : undefined
  const version = args.includes('--version') ? args[args.indexOf('--version') + 1] : undefined
  const kit = JSON.parse(await readFile(KIT, 'utf8').catch(() => 'null'))
  try {
    const set = file ? { ...convert(JSON.parse(await readFile(file, 'utf8')), version, kit), fetched: Date.now() } : await fetchCurrent(undefined, kit)
    await writeFile(SNAPSHOT, JSON.stringify(set))
    console.log(`  ✔ ${set.name}: ${set.units.length} units, ${set.traits.length} traits, ${set.items.length} items${set.version ? ` (patch ${set.version})` : ''}`)
  } catch (e) {
    const kept = (await readFile(SNAPSHOT, 'utf8').catch(() => 'null')).trim() !== 'null'
    if (!kept) await writeFile(SNAPSHOT, 'null\n')
    console.warn(`  ! Couldn't get the TFT set (${e instanceof Error ? e.message : e}). ${kept ? 'Keeping the copy from last time.' : 'The app offers the sandbox set until it can.'}`)
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) await main()
