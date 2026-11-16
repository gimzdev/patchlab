// Types for lib/tft.mjs (plain JavaScript, so scripts/tft.mjs can run it with Node alone)

/** A set as JSON, before lib/sets.ts reads it: rules and anything missing get their defaults there */
export interface TftSetJson {
  format?: number
  id: string
  name: string
  source: string
  /** The patch by its TFT name (18.6), when it can be named */
  version?: string
  /** The game's own version (16.22), and the whole version of the data, which a mid-patch update changes too */
  game?: string
  build?: string
  iconBase: string
  units: unknown[]
  traits: unknown[]
  items: unknown[]
  sample?: unknown
  kit?: string
  /** The patch the kit's ability and item numbers are from, and the day they were last checked against Riot's notes */
  kitPatch?: string
  kitChecked?: string
  summons?: Record<string, string>
  rules?: unknown
  meta?: unknown
  /** When it was downloaded (ms since 1970) */
  fetched?: number
  /** When the site last looked at its sources to make this answer (ms since 1970) */
  checked?: number
}

/** sets/tft18-kit.json: a set's numbers, by unit key, item key and trait name */
export interface Kit {
  set: number
  source?: string
  /** The patch its ability and item numbers are from (like "18.5b"), and that patch's game version (like "16.21") */
  patch?: string
  client?: string
  /** The day its numbers were last checked against Riot's patch notes */
  checked?: string
  units: Record<string, unknown>
  items: Record<string, unknown>
  traits: Record<string, unknown>
  roles?: Record<string, number>
  summons?: Record<string, string>
}

export function convert(raw: unknown, version?: string, kit?: Kit | null): TftSetJson
export function fetchCurrent(base?: string, kit?: Kit | null, ms?: number): Promise<TftSetJson & { fetched: number }>
