// The current TFT set from CommunityDragon's game data, as a Patchlab set. Used by the app's /sets/tft.json route
// (refreshed every few hours) and by scripts/tft.mjs (the offline copy written at install and build time).
// Units, their stats, traits with their numbers, breakpoints and icons come from the data, so they follow every patch.
// When a kit covers the set (sets/tft18-kit.json), the engine plays every ability, item and trait with its scripts: the
// kit says which of the data's variables each trait number is, and brings the ability and item numbers the data leaves
// out (tft.tools' copy, kept up to date with Riot's patch notes). A set no kit covers yet still works: abilities are
// estimated from each description, the unit's cost and its stats, and marked as estimated in the app.

// CDRAGON_URL points it at a mirror (or a stand-in, for tests)
const CDRAGON = (typeof process !== 'undefined' && process.env.CDRAGON_URL) || 'https://raw.communitydragon.org'

const SPECIAL_MODE = /_(TURBO|PAIRS|PVEMODE|MacaoMode|CarouselOfChaos|Evolved|Tutorial|Stage2|CT)\b|Event|Tutorial/i
const COMPONENTS = new Set(['bfsword', 'recurvebow', 'needlesslylargerod', 'tearofthegoddess', 'chainvest', 'negatroncloak', 'giantsbelt', 'sparringgloves', 'spatula', 'fryingpan'].map((s) => `tft_item_${s}`))

/* ── Small helpers ───────────────────────────────────────── */

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'
const round = (n, step = 1) => Math.round(n / step) * step
const r3 = (n) => Math.round(n * 1000) / 1000
const r6 = (n) => Math.round(n * 1e6) / 1e6
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const png = (p) => {
  const t = typeof p === 'string' ? p.trim().replace(/\\/g, '/') : ''
  return !t || /^(none|null)$/i.test(t) ? undefined : t.toLowerCase().replace(/^\/+/, '').replace(/\.(tex|dds)$/, '.png')
}
/** CommunityDragon names some variables by a hash of their name: FNV-1a of the lowercased name */
const hash = (name) => {
  let h = 0x811c9dc5
  for (const ch of name.toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return `{${h.toString(16).padStart(8, '0')}}`
}
const tokens = (desc) => [...String(desc ?? '').matchAll(/@([A-Za-z0-9_]+)(?:\*[0-9.]+)?@/g)].map((m) => m[1])
/** A variable's number in an effect, by its name or the hash CommunityDragon files it under (the game stores them as
 *  floats: 0.30000001192092896 is 0.3) */
function lookup(vars, name) {
  const lower = name.toLowerCase(), hashed = hash(name)
  for (const [k, v] of Object.entries(vars ?? {})) if ((k === hashed || k.toLowerCase() === lower) && typeof v === 'number' && Number.isFinite(v)) return Number(v.toPrecision(5))
  return undefined
}

/** Variables by lowercased name, hashed names resolved through the names the description uses */
function variables(vars, desc) {
  const byHash = new Map(tokens(desc).map((n) => [hash(n), n]))
  const out = {}
  for (const [k, v] of Object.entries(vars ?? {})) {
    const name = /^\{[0-9a-f]{8}\}$/.test(k) ? byHash.get(k) : k
    if (name && typeof v === 'number') out[name.toLowerCase()] = v
  }
  return out
}

const ICON_WORD = { scaleap: 'AP', scalead: 'AD', scalehealth: 'Health', scalearmor: 'Armor', scalemr: 'MR', scaleas: 'Attack Speed', scaledr: 'Durability', scalemanaregen: 'Mana Regen', scalecrit: 'Crit' }
const fmt = (n) => (Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 100) / 100))
/** A description as plain text: values filled in where the data has them, the rest shown as ? */
function plain(desc, values = {}) {
  return String(desc ?? '')
    .replace(/<br\s*\/?>|\\n|\r?\n/gi, ' ')
    .replace(/<rules>.*?<\/rules>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/%i:([a-z]+)%/gi, (_, w) => (ICON_WORD[w.toLowerCase()] ? ` ${ICON_WORD[w.toLowerCase()]}` : ''))
    .replace(/@([A-Za-z0-9_]+)(\*([0-9.]+))?@/g, (_, name, __, mul) => {
      const v = values[name.toLowerCase()]
      return typeof v === 'number' ? fmt(v * (mul ? Number(mul) : 1)) : '?'
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+([.,:;%)])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ── The set ─────────────────────────────────────────────── */

function selectSet(raw) {
  const all = Array.isArray(raw.setData) && raw.setData.length ? raw.setData : Object.values(raw.sets ?? {})
  const standard = all.filter((s) => s.number && !SPECIAL_MODE.test(s.mutator ?? '') && (s.champions ?? []).some((c) => c.cost > 0 && c.traits?.length))
  if (!standard.length) throw new Error('no playable set in the data')
  const newest = Math.max(...standard.map((s) => s.number))
  return standard.filter((s) => s.number === newest).sort((a, b) => Number(a.mutator !== `TFTSet${newest}`) - Number(b.mutator !== `TFTSet${newest}`) || (a.mutator ?? '').length - (b.mutator ?? '').length)[0]
}

/* ── Traits: the breakpoints, with the bonuses the simulator knows how to apply ── */

function traitBonuses(v, desc) {
  const member = {}, team = {}
  const add = (o, k, x) => { if (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) > 1e-9) o[k] = r3((o[k] ?? 0) + x) }
  const share = (x) => (typeof x === 'number' ? (Math.abs(x) > 1.5 ? x / 100 : x) : undefined) // a percentage or a fraction
  // Plain stats go to the trait's units, or to everyone when the description starts with "Your team gains…"
  const wholeTeam = /^(\s|<[^>]+>|\(@MinUnits@\))*(your (team|champions|units)|allies)\b/i.test(desc ?? '')
  const to = wholeTeam ? team : member
  add(to, 'omnivamp', v.omnivamp)
  add(to, 'amp', v.bonusdamagepercentbase ?? v.damageamp ?? v.bonusdamage)
  for (const k of ['adapgain', 'adap']) if (v[k] !== undefined) { add(to, 'adPct', share(v[k])); add(to, 'ap', share(v[k]) * 100) }
  add(to, 'durability', v.durability ?? v.basedurability)
  add(to, 'crit', share(v.critchance))
  add(to, 'hp', v.health)
  add(to, 'hpPct', share(v.bonushealth) ?? share(v.healthincrease))
  add(to, 'asPct', share(v.attackspeedincrease) ?? share(v.attackspeed))
  add(to, 'ap', v.abilitypower !== undefined ? share(v.abilitypower) * 100 : undefined)
  add(to, 'armor', v.resists)
  add(to, 'mr', v.resists)
  add(to, 'shield', v.maxhealthshield ?? v.shieldratio)
  // Named for the trait's own units
  add(member, 'adPct', v.hunterad)
  add(member, 'stackAs', v.asperattack)
  add(member, 'hpPct', v.brawlerhealthpercent)
  // A bonus for the whole team and a bigger one for the trait's own units: the units get the difference on top
  const pair = (teamKey, unitKey, stat, scale = 1) => {
    if (v[teamKey] === undefined && v[unitKey] === undefined) return
    add(team, stat, (v[teamKey] ?? 0) * scale)
    add(member, stat, Math.max(0, (v[unitKey] ?? 0) - (v[teamKey] ?? 0)) * scale)
  }
  pair('teammanaregen', 'invokermanabonus', 'manaRegen')
  pair('teamdurability', 'juggernautdurability', 'durability')
  pair('teamwideap', 'spellweaverap', 'ap', 100)
  pair('nondefenderdefensegain', 'defenderdefensegain', 'armor')
  pair('nondefenderdefensegain', 'defenderdefensegain', 'mr')
  add(team, 'asPct', v.teamas)
  add(team, 'hp', v.brawlerteamhealth)
  if (v.bonusmagicdamage !== undefined) add(team, 'amp', v.bonusmagicdamage)
  return { member, team }
}

function convertTraits(rawTraits, kit) {
  const byName = new Map((rawTraits ?? []).filter((t) => t?.name).map((t) => [t.name.trim().toLowerCase(), t]))
  return (rawTraits ?? [])
    .filter((t) => t?.apiName && t.name)
    .map((t) => {
      const all = (t.effects ?? []).map((e, i) => ({ ...e, minUnits: Number(e.minUnits ?? 1) || 1, i })).sort((a, b) => a.minUnits - b.minUnits || a.i - b.i)
      // A few traits list one unit count twice (Rival: 1, 1, 2): the first of each is the breakpoint
      const effects = all.filter((e, i) => i === 0 || e.minUnits !== all[i - 1].minUnits)
      const k = kit?.traits?.[t.name.trim()]
      if (k) return kitTrait(t, all, effects, k, byName)
      const breakpoints = []
      let mapped = 0, lastMember = {}, lastTeam = {}
      for (const e of effects) {
        const v = variables(e.variables, t.desc)
        const found = traitBonuses(v, t.desc)
        // Some traits only list what changes at a breakpoint: what an earlier one gave is kept
        const member = { ...lastMember, ...found.member }, team = { ...lastTeam, ...found.team }
        lastMember = member
        lastTeam = team
        if (Object.keys(member).length || Object.keys(team).length) mapped++
        const bp = { units: e.minUnits, bonus: member }
        if (Object.keys(team).length) bp.team = team
        breakpoints.push(bp)
      }
      // Descriptions have a <row> per breakpoint: each is filled in with its own breakpoint's numbers
      const [head, ...rows] = String(t.desc ?? '').split(/<row>/i)
      let carried = {}
      const at = all.map((e) => (carried = { ...carried, ...variables(e.variables, t.desc), minunits: e.minUnits }))
      const text = [plain(head, at[0] ?? {}), ...rows.map((r, i) => plain(r, at[Math.min(i, at.length - 1)] ?? {}))].filter(Boolean).join(' ')
      const note = mapped === 0 ? `Not simulated: add its effect as stats if it matters. In the game: ${text}` : `Simplified. In the game: ${text}`
      return { id: slug(t.name), name: t.name.trim(), breakpoints, icon: png(t.icon), note: note.slice(0, 600) }
    })
}

/** A trait as the kit plays it: the game's breakpoints, and at each the numbers the kit's scripts use, read from the
 *  game data where the kit says which variable they are (the kit's own where the data doesn't have them) */
function kitTrait(t, all, effects, k, traits) {
  // The kit's lists follow the game's breakpoints, in order: k.bonus[n], k.team[n] and a value's v[n] are for the nth
  const nth = effects.map((e) => all.indexOf(e))
  const breakpoints = effects.map((e, n) => {
    const i = nth[n], bp = { units: e.minUnits, bonus: { ...(k.bonus?.[i] ?? {}) } }
    if (k.team?.[i] && Object.keys(k.team[i]).length) bp.team = { ...k.team[i] }
    return bp
  })
  const values = k.values && Object.fromEntries(Object.entries(k.values).map(([name, x]) => [name, x.v.length === all.length && all.length > effects.length ? { ...x, v: nth.map((i) => x.v[i]) } : x]))
  if (k.live) readLive(k.live, effects, traits, breakpoints, values)
  // The game's description with its numbers filled in (mended where the data drops a word); the kit's when the data's
  // leaves a number out
  const [head, ...rows] = String(t.desc ?? '').split(/<row>/i)
  let carried = {}
  const at = all.map((e) => (carried = { ...carried, ...variables(e.variables, t.desc), minunits: e.minUnits }))
  let desc = [plain(head, at[0] ?? {}), ...rows.map((r, i) => plain(r, at[Math.min(i, at.length - 1)] ?? {}))].filter(Boolean).join(' ')
  for (const [pattern, to] of k.fix ?? []) desc = desc.replace(new RegExp(pattern, 'g'), to)
  desc = desc.replace(/\s+/g, ' ').trim()
  if (!desc || /(^|[\s(])\?([\s%.,)]|$)/.test(desc)) desc = k.desc || desc
  return {
    id: slug(t.name), name: t.name.trim(), breakpoints, icon: png(t.icon),
    desc: String(desc).slice(0, 900),
    ...(values && Object.keys(values).length ? { values } : {}),
    ...(k.note ? { note: k.note } : {}),
  }
}

/**
 * The game data's numbers in place of the kit's: `live` maps a number ("bonus.hpPct", "team.hp", "values.adap") to its
 * variable, as a name, [name, scale] or [name, scale, name subtracted]; "Trait:name" reads another trait's. A breakpoint
 * that doesn't list a variable keeps the one before it, or the kit's number when none before it has it.
 */
function readLive(live, effects, traits, breakpoints, values) {
  const at = (ref, n) => {
    const [other, name] = ref.includes(':') ? ref.split(':') : [null, ref]
    if (!other) return lookup(effects[n]?.variables, name)
    for (const e of traits.get(other.toLowerCase())?.effects ?? []) { const v = lookup(e.variables, name); if (v !== undefined) return v }
    return undefined
  }
  const number = (spec, n) => {
    const [ref, scale = 1, minus] = Array.isArray(spec) ? spec : [spec]
    const a = at(ref, n), b = minus ? at(minus, n) : 0
    return a === undefined || b === undefined ? undefined : r6((a - b) * scale)
  }
  for (const [path, spec] of Object.entries(live)) {
    const [where, key] = path.split('.')
    if (where === 'values') {
      const x = values?.[key]
      if (!x) continue
      if (x.v.length === 1) {
        // One number for every breakpoint: the first that lists it
        let v
        for (let n = 0; n < effects.length && v === undefined; n++) v = number(spec, n)
        if (v !== undefined) values[key] = { ...x, v: [v] }
      } else if (x.v.length === effects.length) {
        let last
        values[key] = { ...x, v: x.v.map((own, n) => { const v = number(spec, n); if (v !== undefined) last = v; return v ?? last ?? own }) }
      }
    } else if (where === 'bonus' || where === 'team') {
      let last
      breakpoints.forEach((bp, n) => {
        const v = number(spec, n) ?? last
        if (v === undefined) return
        last = v
        if (where === 'bonus') bp.bonus[key] = v
        else bp.team = { ...(bp.team ?? {}), [key]: v }
      })
    }
  }
}

/* ── Abilities: estimated from the description and the unit ── */

const DAMAGE = [250, 320, 400, 510, 660] // magic damage at 1 star, single target, by cost
const AD_SHARE = [290, 320, 360, 400, 460] // physical damage as a % of attack damage
const SHIELD = [230, 290, 360, 450, 580]
const HEAL = [190, 240, 300, 380, 470]

function estimate(c, traitById) {
  const s = c.stats ?? {}, cost = clamp(Math.round(c.cost ?? 1), 1, 5), mana = num(s.mana) ?? 0
  const desc = String(c.ability?.desc ?? '')
  const text = desc.toLowerCase().replace(/<[^>]+>/g, ' ')
  const name = (c.ability?.name ?? '').trim() || 'Ability'
  const about = plain(desc)
  if (!(mana > 0)) return { name, effects: [], estimated: true, desc: about }
  const stars = cost <= 3 ? [1, 1.5, 2.25] : cost === 4 ? [1, 1.5, 2.7] : [1, 1.5, 4]
  const per = (base, mult = stars, step = 5) => mult.map((m) => round(base * m, step))
  // Bigger mana bars cast bigger spells
  const m = clamp(Math.max(mana, 30) / 75, 0.55, 1.7)
  const count = (re) => (desc.match(re) ?? []).length
  const ap = count(/%i:scaleAP%/gi), ad = count(/%i:scaleAD%/gi)
  const physical = /physical damage/.test(text) || (!/magic damage|true damage/.test(text) && ad > ap)
  const trueDamage = !physical && /true damage/.test(text)
  const melee = (num(s.range) ?? 1) <= 2
  const sturdy = melee && ((num(s.hp) ?? 0) >= 600 + cost * 120 || (num(s.armor) ?? 0) >= 45)

  let target = 'target', radius
  if (/\b(all|every|each) enem/.test(text)) target = 'all'
  else if (/lowest health|least health/.test(text)) target = 'lowest'
  else if (/(farthest|furthest)/.test(text)) target = 'farthest'
  else if (/(adjacent|hex radius|radius|within \S+ hex|cone|in a line|nearby enem|enemies hit|explod|wave|blast through|largest group|surrounding|all enemies around|splits)/.test(text)) {
    target = 'splash'
    radius = /within (\d) hex|(\d)[- ]hex/.exec(text)?.slice(1).find(Boolean)
    radius = radius ? clamp(Number(radius), 1, 3) : 1
  }
  const effects = []
  const support = /\b(heal|restore)\w* (an |the )?(all(y|ies)|lowest)/.test(text) || /shield (an |the |nearby )?all(y|ies)/.test(text)
  const deals = /damage/.test(text) && !/^\W*passive/.test(text.trim())
  const spread = target === 'all' ? 0.42 : target === 'splash' ? 0.7 : 1
  const tank = sturdy ? 0.65 : 1
  if (deals || !support) {
    if (physical) effects.push({ kind: 'damage', target, ...(radius ? { radius } : {}), value: per(AD_SHARE[cost - 1] * m * spread * tank, [1, 1, 1.05]), scale: 'ad', type: 'physical' })
    else effects.push({ kind: 'damage', target, ...(radius ? { radius } : {}), value: per(DAMAGE[cost - 1] * m * spread * tank * (trueDamage ? 0.8 : 1)), scale: 'ap', ...(trueDamage ? { type: 'true' } : {}) })
  }
  if (/\bshield/.test(text)) effects.push({ kind: 'shield', target: /shield (an |the |nearby |lowest health )?all(y|ies)|allies .{0,30}shield/.test(text) ? 'ally' : 'self', value: per(SHIELD[cost - 1] * m, [1, 1.25, cost === 5 ? 3 : 1.6]), scale: 'ap', duration: 4 })
  if (/\b(heal|restore)/.test(text)) effects.push({ kind: 'heal', target: /(heal|restore)\w* (an |the )?(all(y|ies)|lowest)/.test(text) ? 'ally' : 'self', value: per(HEAL[cost - 1] * m * (sturdy ? 1 : 0.7), [1, 1.3, cost === 5 ? 3 : 1.7]), scale: 'ap' })
  if (/\bstun|knock(s|ed)? ?up|knockup|taunt/.test(text)) effects.push({ kind: 'stun', target: target === 'all' || target === 'splash' ? target : 'target', ...(target === 'splash' ? { radius } : {}), value: cost <= 2 ? [1, 1.25, 1.5] : cost === 3 ? [1.25, 1.5, 2] : cost === 4 ? [1.5, 1.75, 2.5] : [1.75, 2, 5] })
  if (/gain\w*[^.]{0,40}attack speed|attack speed for the next/.test(text)) effects.push({ kind: 'buff', target: 'self', stat: 'asPct', value: [0.5, 0.6, 0.8], duration: 4 })
  if (/gain\w*[^.]{0,30}durability/.test(text)) effects.push({ kind: 'buff', target: 'self', stat: 'durability', value: [0.2, 0.22, 0.3], duration: 4 })
  if (/gain\w*[^.]{0,20}armor and magic resist/.test(text)) {
    effects.push({ kind: 'buff', target: 'self', stat: 'armor', value: [30, 40, 60], duration: 4 })
    effects.push({ kind: 'buff', target: 'self', stat: 'mr', value: [30, 40, 60], duration: 4 })
  }
  return { name, effects, estimated: true, desc: about.slice(0, 700) }
}

/* ── Items: completed items, their stats mapped ── */

function itemCategory(i) {
  const api = i.apiName.toLowerCase(), name = (i.name ?? '').toLowerCase(), tags = new Set((i.tags ?? []).map((t) => String(t).toLowerCase()))
  if (api.includes('_assist_') || api.includes('armory') || api.startsWith('da_')) return 'special'
  if (tags.has('consumable') || api.includes('consumable')) return 'consumable'
  if (tags.has('component') || COMPONENTS.has(api)) return 'component'
  if ((i.associatedTraits?.length ?? 0) > 0 || /emblem$/.test(name) || api.includes('emblem')) return 'emblem'
  if (api.includes('artifact') || api.includes('_ornn') || name.startsWith('radiant ') || api.includes('radiant') || api.includes('support')) return 'special'
  if (Object.keys(i.effects ?? {}).some((k) => /maxarmysize/i.test(k))) return 'special'
  return (i.composition?.length ?? 0) === 2 ? 'completed' : 'special'
}

const ITEM_KEYS = new Set(['ad', 'ap', 'as', 'critchance', 'armor', 'magicresist', 'health', 'bonuspercenthp', 'manaregen', 'combatstartmana', 'statomnivamp', 'damageamp', 'bonusdamage', 'attackspeedperstack', 'critdamagetogive', 'basedurability', 'empowereddurability', 'shieldsize'])
function itemBonus(effects) {
  const e = Object.fromEntries(Object.entries(effects ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  const b = {}
  const add = (k, x) => { if (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) > 1e-9) b[k] = r3((b[k] ?? 0) + x) }
  add('adPct', e.ad)
  add('ap', e.ap)
  add('asPct', typeof e.as === 'number' ? e.as / 100 : undefined)
  add('crit', typeof e.critchance === 'number' ? e.critchance / 100 : undefined)
  add('armor', e.armor)
  add('mr', e.magicresist)
  add('hp', e.health)
  add('hpPct', e.bonuspercenthp)
  add('manaRegen', e.manaregen)
  add('startMana', e.combatstartmana)
  add('omnivamp', e.statomnivamp)
  add('amp', e.damageamp ?? e.bonusdamage)
  add('stackAs', typeof e.attackspeedperstack === 'number' ? e.attackspeedperstack / 100 : undefined)
  if ('critdamagetogive' in e) b.abilityCrit = 1
  if (typeof e.basedurability === 'number') add('durability', (e.basedurability + (num(e.empowereddurability) ?? e.basedurability)) / 2)
  if (typeof e.shieldsize === 'number') add('shield', e.shieldsize / 100)
  const extra = Object.keys(e).filter((k) => !ITEM_KEYS.has(k) && !/^\{|icd|_notstatbar$/.test(k))
  return { bonus: b, simplified: extra.length > 0, values: e }
}

function convertItems(raw, set) {
  const all = (raw.items ?? []).filter((i) => i?.apiName && i.name)
  const index = new Map(all.map((i) => [i.apiName, i]))
  const pool = set.items?.length ? set.items.map((id) => index.get(id)).filter(Boolean) : all.filter((i) => /^TFT_Item_/i.test(i.apiName))
  const seen = new Set()
  return pool
    .filter((i) => itemCategory(i) === 'completed')
    .filter((i) => { const k = i.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .map((i) => {
      const { bonus, simplified, values } = itemBonus(i.effects)
      const text = plain(i.desc, values)
      return { id: slug(i.name), key: i.apiName.toLowerCase(), name: i.name.trim(), bonus, icon: png(i.icon), ...(simplified && text ? { note: `Only its stats are simulated. In the game: ${text}`.slice(0, 600) } : {}) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Items as the kit lists them, with the game's icons; a completed item keeps the id MetaForge's boards use */
function kitItems(raw, kit, traits, set) {
  const all = (raw.items ?? []).filter((i) => i?.apiName && i.name)
  const byApi = new Map(all.map((i) => [i.apiName.toLowerCase(), i]))
  // The game data has several items by one name (Guinsoo's Rageblade, and a Corrupted copy for another mode; Thief's
  // Gloves and two Academy copies): the one in the set's own item list is the one boards use
  const pool = new Set((set?.items ?? []).map((a) => String(a).toLowerCase()))
  const legacy = new Map()
  for (const i of all) {
    if (!/^TFT_Item_/i.test(i.apiName)) continue
    const name = i.name.trim().toLowerCase(), api = i.apiName.toLowerCase(), had = legacy.get(name)
    if (!had || (pool.has(api) && !pool.has(had))) legacy.set(name, api)
  }
  const traitId = new Map(traits.map((t) => [t.name.toLowerCase(), t.id]))
  const seen = new Set()
  return Object.entries(kit.items)
    .map(([key, k]) => {
      const game = byApi.get(key), name = String(k.name ?? game?.name ?? key).trim(), id = slug(name)
      if (seen.has(id)) return null
      seen.add(id)
      const trait = k.trait ? traitId.get(String(k.trait).toLowerCase()) : undefined
      return {
        id, key: legacy.get(name.toLowerCase()) ?? key, name, bonus: { ...(k.bonus ?? {}) }, icon: png(game?.icon),
        ...(k.desc ? { desc: k.desc } : {}), ...(k.values && Object.keys(k.values).length ? { values: k.values } : {}),
        ...(trait ? { trait } : {}), ...(k.note ? { note: k.note } : {}),
      }
    })
    .filter(Boolean)
    .sort((a, b) => Number(!!a.trait) - Number(!!b.trait) || a.name.localeCompare(b.name))
}

/* ── Units ── */

function convertUnits(set, traits, kit) {
  const byName = new Map(traits.map((t) => [t.name.toLowerCase(), t]))
  const seen = new Set(), ids = new Set()
  const playable = (set.champions ?? []).filter((c) => {
    if (!c?.apiName || seen.has(c.apiName) || !(c.cost > 0) || !c.traits?.length || !c.stats) return false
    seen.add(c.apiName)
    return true
  })
  return playable
    .map((c) => {
      const s = c.stats
      let mana = num(s.mana) ?? 0, start = num(s.initialMana) ?? 0
      // A handful of units count attacks instead of mana (3: every third attack)
      if (mana > 0 && mana < 10) { mana = mana * 10; start = 0 }
      let id = slug(c.name)
      while (ids.has(id)) id += '-2'
      ids.add(id)
      const key = c.apiName.toLowerCase(), k = kit?.units?.[key]
      const stats = k ? kitStats(k, s) : {
        hp: num(s.hp) ?? 600, mana, startMana: Math.min(mana, start), ad: num(s.damage) ?? 50, as: r3(num(s.attackSpeed) ?? 0.7),
        armor: num(s.armor) ?? 30, mr: num(s.magicResist) ?? 30, range: clamp(Math.round(num(s.range) ?? 1), 1, 8),
        crit: r3(num(s.critChance) ?? 0.25), critDmg: r3(num(s.critMultiplier) ?? 1.4),
      }
      return {
        id,
        // The game's id, so a board from MetaForge's team builder (which uses it) opens here
        key,
        name: c.name.trim(),
        cost: Math.round(c.cost),
        traits: c.traits.map((t) => byName.get(String(t).toLowerCase())?.id).filter(Boolean),
        stats,
        ability: k ? { name: k.ability?.name || c.ability?.name || 'Ability', effects: [], desc: k.ability?.desc, values: k.ability?.values ?? {} } : estimate(c),
        icon: png(c.tileIcon) ?? png(c.squareIcon),
        ...(k ? kitRole(k, byName) : {}),
      }
    })
    .concat(kit ? plants(kit, byName) : [])
    .sort((a, b) => Number(!!a.plant) - Number(!!b.plant) || a.cost - b.cost || a.name.localeCompare(b.name))
}

const STAT_FROM = { hp: 'hp', mana: 'mana', startMana: 'initialMana', ad: 'damage', as: 'attackSpeed', armor: 'armor', mr: 'magicResist', range: 'range', crit: 'critChance', critDmg: 'critMultiplier' }
const STAT_DEFAULT = { hp: 600, mana: 0, startMana: 0, ad: 50, as: 0.7, armor: 30, mr: 30, range: 1, crit: 0.25, critDmg: 1.4 }
/** A kit unit's stats: the game data's, which follow every patch, the kit's where the data has none that make sense,
 *  and the few the kit sets itself (a unit that counts attacks fills no mana bar) */
function kitStats(k, game = {}) {
  const out = {}
  for (const [key, from] of Object.entries(STAT_FROM)) {
    const ok = (x) => typeof x === 'number' && Number.isFinite(x) && (x > 0 || key === 'mana' || key === 'startMana')
    out[key] = ok(game[from]) ? game[from] : ok(k.stats?.[key]) ? k.stats[key] : STAT_DEFAULT[key]
  }
  Object.assign(out, k.force ?? {})
  if (k.resource === 'ammo') { out.mana = 0; out.startMana = 0 }
  out.as = r3(out.as)
  out.crit = r3(out.crit)
  out.critDmg = r3(out.critDmg)
  out.range = clamp(Math.round(out.range), 1, 8)
  out.startMana = Math.min(out.mana, out.startMana)
  return out
}
function kitRole(k, byName) {
  const counts = {}
  for (const [t, n] of Object.entries(k.counts ?? {})) { const id = byName.get(t.toLowerCase())?.id; if (id) counts[id] = n }
  return { ...(k.role ? { role: k.role } : {}), ...(k.damage ? { damage: k.damage } : {}), ...(k.resource ? { resource: k.resource } : {}), ...(Object.keys(counts).length ? { counts } : {}) }
}
/** Elderwood's plants: placed on the board by the trait, so they're in the kit but not in the game's champion list */
function plants(kit, byName) {
  // The game data has no art for them: they're drawn with their names
  return Object.entries(kit.units)
    .filter(([, k]) => k.plant)
    .map(([key, k]) => ({
      id: slug(k.name), key, name: k.name, cost: 0, traits: [], plant: true,
      stats: { hp: 300, mana: 0, startMana: 0, ad: 0, as: 0, armor: 30, mr: 30, range: 1, crit: 0.25, critDmg: 1.4, ...k.stats },
      ability: { name: k.ability?.name || 'Passive', effects: [], desc: k.ability?.desc, values: k.ability?.values ?? {} },
      ...kitRole(k, byName),
    }))
}

/* ── Sample boards: two teams built around the set's biggest traits ── */

function sampleBoards(units, traits, items) {
  const ready = units.filter((u) => u.cost >= 1 && u.cost <= 4 && u.stats.mana > 0 && !/\(/.test(u.name))
  const size = new Map(traits.map((t) => [t.id, ready.filter((u) => u.traits.includes(t.id)).length]))
  const ranked = traits.filter((t) => (size.get(t.id) ?? 0) >= 4 && t.breakpoints.length >= 2).sort((a, b) => (size.get(b.id) ?? 0) - (size.get(a.id) ?? 0))
  const used = new Set()
  const team = (trait) => {
    const members = ready.filter((u) => u.traits.includes(trait.id) && !used.has(u.id)).sort((a, b) => b.cost - a.cost).slice(0, 4)
    const picks = [...members]
    const shared = new Map()
    for (const u of picks) for (const t of u.traits) if (t !== trait.id) shared.set(t, (shared.get(t) ?? 0) + 1)
    const second = [...shared.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
    for (const t of second) for (const u of ready) if (picks.length < 6 && u.traits.includes(t) && !picks.includes(u) && !used.has(u.id)) picks.push(u)
    for (const u of [...ready].sort((a, b) => b.cost - a.cost)) if (picks.length < 6 && !picks.includes(u) && !used.has(u.id)) picks.push(u)
    for (const u of picks) used.add(u.id)
    return picks
  }
  if (ranked.length < 2) return undefined
  const blue = team(ranked[0])
  const second = ranked.slice(1).find((t) => ready.filter((u) => u.traits.includes(t.id) && !used.has(u.id)).length >= 3) ?? ranked[1]
  const red = team(second)
  const byName = (n) => items.find((i) => i.name.toLowerCase() === n)?.id
  const place = (picks, front, back) => {
    const melee = picks.filter((u) => u.stats.range <= 2).sort((a, b) => b.stats.hp - a.stats.hp)
    const ranged = picks.filter((u) => u.stats.range > 2).sort((a, b) => b.cost - a.cost)
    const fc = [3, 2, 4, 1, 5, 0, 6], bc = [3, 1, 5, 2, 4, 0, 6]
    const carry = ranged[0] ?? melee[melee.length - 1]
    const tank = melee[0]
    const out = []
    melee.forEach((u, i) => out.push({ unit: u.id, star: u.cost <= 3 ? 2 : 1, items: [], row: i < 7 ? front : front + (front > 3 ? 1 : -1), col: fc[i % 7] }))
    ranged.forEach((u, i) => out.push({ unit: u.id, star: u.cost <= 3 ? 2 : 1, items: [], row: back, col: bc[i % 7] }))
    for (const p of out) {
      if (carry && p.unit === carry.id) {
        const phys = carry.damage ? carry.damage === 'attack' : carry.ability.effects.some((e) => e.type === 'physical')
        p.items = (phys ? ['infinity edge', 'last whisper'] : ['jeweled gauntlet', "rabadon's deathcap"]).map(byName).filter(Boolean)
      } else if (tank && p.unit === tank.id) p.items = ["warmog's armor", 'bramble vest'].map(byName).filter(Boolean)
    }
    return out
  }
  return { blue: place(blue, 4, 7), red: place(red, 3, 0) }
}

/**
 * CommunityDragon's en_us.json (and its version, like "16.21.8298620+…") as a Patchlab set. With a kit for the set
 * (sets/tft18-kit.json), its abilities, items and traits get the kit's numbers and scripts.
 */
export function convert(raw, version, kit) {
  const set = selectSet(raw)
  const scripted = kit && Number(kit.set) === set.number ? kit : null
  const traits = convertTraits(set.traits, scripted)
  const units = convertUnits(set, traits, scripted)
  const used = new Set(units.flatMap((u) => u.traits))
  const kept = traits.filter((t) => used.has(t.id))
  const items = scripted ? kitItems(raw, scripted, kept, set) : convertItems(raw, set)
  const patch = /^(\d+)\.(\d+)/.exec(version ?? '')
  const folder = patch ? `${patch[1]}.${patch[2]}` : 'latest'
  // TFT names its patches by set (18.5) and the game version (16.21) moves on by one each patch, so the kit's pair of
  // them names the patch of any version in the same year
  const anchor = scripted && /^(\d+)\.(\d+)$/.exec(scripted.client ?? ''), named = scripted && /^(\d+)\.(\d+)/.exec(scripted.patch ?? '')
  const tftPatch = patch && anchor && named && patch[1] === anchor[1] && Number(named[2]) + Number(patch[2]) - Number(anchor[2]) > 0
    ? `${named[1]}.${Number(named[2]) + Number(patch[2]) - Number(anchor[2])}`
    : undefined
  const shown = tftPatch ?? (patch ? folder : undefined)
  return {
    // The converter's output format: an older copy of the set is fetched again on the next install
    format: 4,
    id: `tft${set.number}`,
    name: `TFT Set ${set.number}`,
    source: scripted
      ? `Units, stats and trait numbers from the game data${shown ? ` of patch ${shown}` : ''} (CommunityDragon); ability and item numbers from ${scripted.source ?? 'tft.tools'} and Riot's patch notes, as of patch ${scripted.patch}.`
      : `Stats from the game data${shown ? ` of patch ${shown}` : ''} (CommunityDragon). Abilities are estimated.`,
    version: shown,
    iconBase: `${CDRAGON}/${folder}/game/`,
    ...(scripted ? { kit: `tft${set.number}`, kitPatch: scripted.patch, summons: scripted.summons ?? {}, rules: { roles: scripted.roles } } : {}),
    units, traits: kept, items,
    sample: sampleBoards(units, kept, items),
  }
}

/* ── Downloading ── */

async function fetchJson(url, ms = 90000) {
  for (let attempt = 1; ; attempt++) {
    try {
      // Inside Next.js, kept out of its data cache: the game data is ~25 MB, the set made from it is what's cached
      const res = await fetch(url, { signal: AbortSignal.timeout(ms), ...(process.env.NEXT_RUNTIME ? { cache: 'no-store' } : {}), headers: { 'user-agent': 'Patchlab/1.1 (+https://patchlab.metaforge.lol)' } })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.json()
    } catch (e) {
      if (attempt >= 2) throw e
    }
  }
}

/** The set as it is now: the live game data and its version, converted. Throws when the data can't be read. */
export async function fetchCurrent(base = CDRAGON, kit) {
  const [raw, meta] = await Promise.all([
    fetchJson(`${base}/latest/cdragon/tft/en_us.json`),
    fetchJson(`${base}/latest/content-metadata.json`, 20000).catch(() => null),
  ])
  const set = convert(raw, meta?.version, kit)
  if (set.units.length < 10) throw new Error(`only ${set.units.length} units found`)
  return { ...set, fetched: Date.now() }
}
