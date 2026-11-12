// Riot's balance changes, patch by patch, as numbers Patchlab can fight with. Each change is written as Riot's notes
// write it, with the numbers it moves in Patchlab (before, after); a change Patchlab doesn't play says why.
// /patch/<id> fights MetaForge's meta comps with the numbers before and after the patch (lib/patch-run.ts).
// Units are named by the game's own id (u.@<id>), so a path finds them whatever id the set gives them (two units can
// share a name); items and traits by their ids in Patchlab.
// A new patch: its changes at the top of PATCHES, then MetaForge's news lists it (src/lib/patchlab.ts there).

export interface PatchChange {
  /** Champion, trait or item, as named in game */
  target: string
  what: string
  from: string
  to: string
  /** Patchlab's numbers the change moves: path, [before, after] */
  moves?: Record<string, [number, number]>
  /** Why Patchlab doesn't play it */
  why?: string
}

export interface Patch {
  id: string
  label: string
  /** The TFT set it belongs to */
  set: number
  /** The day it went live (UTC) */
  date: string
  mid?: boolean
  notes: string
  changes: PatchChange[]
}

/** A per-star number: the stars whose value changed (v1 is 1 star) */
const stars = (path: string, before: number[], after: number[]): Record<string, [number, number]> =>
  Object.fromEntries(before.flatMap((b, i) => (b === after[i] ? [] : [[`${path}.v${i + 1}`, [b, after[i]]]])))
/** A per-breakpoint number of a trait: the breakpoints whose value changed (b0 is the first) */
const steps = (path: string, before: number[], after: number[]): Record<string, [number, number]> =>
  Object.fromEntries(before.flatMap((b, i) => (b === after[i] ? [] : [[`${path}.b${i}`, [b, after[i]]]])))

const NOTES = 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates'
const AP_FORM = 'Patchlab plays Nidalee in her AP form.'
const NOT_MODELED = 'Patchlab doesn’t model this part of the trait.'
const ENGINE = 'Patchlab’s engine plays this the way it is now, so the fights before the patch can’t undo it.'

export const PATCHES: Patch[] = [
  {
    id: '18-6', label: '18.6', set: 18, date: '2026-11-04', notes: `${NOTES}/teamfight-tactics-patch-18-6/`,
    changes: [
      { target: 'Blossom', what: 'AD and AP', from: '12/30/50/55%', to: '12/30/55/65%', moves: { 't.blossom.b2.adPct': [0.5, 0.55], 't.blossom.b2.ap': [50, 55], 't.blossom.b3.adPct': [0.55, 0.65], 't.blossom.b3.ap': [55, 65] } },
      { target: 'Elderwood', what: 'Health bonus at 9', from: '25%', to: '10%', why: NOT_MODELED },
      { target: 'Sprykin', what: 'Ranged BFF AD and AP', from: '15/28/33%', to: '15/30/38%', why: NOT_MODELED },
      { target: 'Kobuko', what: 'Spell healing', from: '285/335/480 AP', to: '300/350/550 AP', moves: stars('u.@da_18_kobuko.$heal', [285, 335, 480], [300, 350, 550]) },
      { target: 'Rek’Sai', what: 'Spell healing', from: '10/14/20 AP', to: '10/16/24 AP', moves: stars('u.@da_18_reksai.$regen', [10, 14, 20], [10, 16, 24]) },
      { target: 'Murkwolf', what: 'Empowered attack damage', from: '65/100/160 AD', to: '65/100/180 AD', moves: stars('u.@da_murkwolf18.$empowered', [0.65, 1, 1.6], [0.65, 1, 1.8]) },
      { target: 'Malphite', what: 'Shield', from: '735/885/2000 AP', to: '750/925/2000 AP', moves: stars('u.@da_18_malphite.$shield', [735, 885, 2000], [750, 925, 2000]) },
      { target: 'Malphite', what: 'Spell damage', from: '40/60/2000 AP', to: '100/150/2000 AP', moves: stars('u.@da_18_malphite.$dmg', [40, 60, 2000], [100, 150, 2000]) },
      { target: 'Nidalee', what: 'Heal (AD form)', from: '300/450/2000 AP', to: '325/550/2000 AP', why: AP_FORM },
      { target: 'Nidalee', what: 'Third cast bonus damage (AD form)', from: '125%', to: '140%', why: AP_FORM },
      { target: 'Nidalee', what: 'Empowered attack damage (AP form)', from: '185/275/2000 AP', to: '195/295/2000 AP', moves: stars('u.@da_nidalee18_ap.$dmg', [185, 275, 2000], [195, 295, 2000]) },
      { target: 'Nidalee', what: 'Third attack damage (AP form)', from: '330/500/3000 AP', to: '350/525/3000 AP', moves: stars('u.@da_nidalee18_ap.$final', [330, 500, 3000], [350, 525, 3000]) },
      { target: 'Sentinel', what: 'Shield, as a share of Health', from: '10%', to: '12%', moves: { 'u.@da_sentinel18.$shieldHp': [0.1, 0.12] } },
    ],
  },
  {
    id: '18-5c', label: '18.5c', set: 18, date: '2026-10-27', mid: true, notes: `${NOTES}/teamfight-tactics-patch-18-5/`,
    changes: [
      { target: 'Kha’Zix', what: 'Base damage', from: '250/345/500 AP', to: '230/310/450 AP', moves: stars('u.@da_18_khazix.$dmg', [250, 345, 500], [230, 310, 450]) },
      { target: 'Kha’Zix', what: 'Isolated damage', from: '280/390/590 AP', to: '250/350/530 AP', moves: stars('u.@da_18_khazix.$isolated', [280, 390, 590], [250, 350, 530]) },
      { target: 'Brambleback', what: 'Armor ignore', from: '25% + 25% AP', to: '30% + 10% AP', moves: { 'u.@da_brambleback18.$ignore': [0.25, 0.3], ...stars('u.@da_brambleback18.$ignoreAp', [0.25, 0.25], [0.1, 0.1]) } },
      { target: 'Hand of Justice', what: 'Omnivamp', from: '15%', to: '12%', moves: { 'i.hand-of-justice.$omnivamp': [0.15, 0.12] } },
      { target: 'Radiant Hand of Justice', what: 'Omnivamp', from: '30%', to: '25%', why: 'Radiant items aren’t in Patchlab.' },
    ],
  },
  {
    id: '18-5b', label: '18.5b', set: 18, date: '2026-10-22', mid: true, notes: `${NOTES}/teamfight-tactics-patch-18-5/`,
    changes: [
      { target: 'Brambleback', what: 'Healing on-hit', from: '5%', to: '4%', moves: { 'u.@da_brambleback18.$alphaHeal': [0.05, 0.04] } },
      { target: 'Elderwood Emblem', what: 'Stats corrected', from: 'its 18.4 nerf reverted by mistake', to: 'the 18.4 nerf back', why: 'Riot’s notes give no numbers for it.' },
    ],
  },
  {
    id: '18-5', label: '18.5', set: 18, date: '2026-10-21', notes: `${NOTES}/teamfight-tactics-patch-18-5/`,
    changes: [
      { target: 'Blackthorn', what: '6-piece enhanced bonus', from: '60%', to: '50%', why: 'Patchlab doesn’t simulate the sacrifice.' },
      { target: 'Blackthorn', what: 'Base AP sacrifice', from: '12% Damage Amp + 2 Mana Regen', to: '10% Damage Amp + 2 Mana Regen', why: 'Patchlab doesn’t simulate the sacrifice.' },
      { target: 'Elderwood', what: 'Summon bonus health at 9', from: '140%', to: '125%', why: NOT_MODELED },
      { target: 'Fae', what: 'Heal at 2/4', from: '2.5/4%', to: '3/5%', moves: steps('t.fae.$heal', [0.025, 0.04], [0.03, 0.05]) },
      { target: 'Fae', what: 'Pixie thresholds 4 to 6', from: '30,000/70,000/110,000', to: '25,000/60,000/100,000', why: 'Patchlab starts every fight with the 7 Pixies attracted.' },
      { target: 'Flora Fatalis', what: 'Max Health healing', from: '8%', to: '7%', moves: { 't.flora-fatalis.$heal.b1': [0.08, 0.07] } },
      { target: 'Rapidfire', what: 'Attack Speed per attack', from: '3/5/8/12%', to: '3/5/7/10%', moves: steps('t.rapidfire.$stack', [0.03, 0.05, 0.08, 0.12], [0.03, 0.05, 0.07, 0.1]) },
      { target: 'Riftbeast', what: 'AD and AP at 7', from: '6%', to: '5%', moves: { 't.riftbeast.$ad': [0.06, 0.05], 't.riftbeast.$ap': [6, 5] } },
      { target: 'Caitlyn', what: 'Empowered attack damage', from: '190/285/470 AD', to: '200/300/490 AD', moves: stars('u.@da_18_caitlyn.$dmgAd', [1.9, 2.85, 4.7], [2, 3, 4.9]) },
      { target: 'Azir', what: 'Ability damage', from: '46/69/110 AP', to: '43/65/105 AP', moves: stars('u.@da_18_azir.$dmg', [46, 69, 110], [43, 65, 105]) },
      { target: 'Kha’Zix', what: 'Damage when not isolated', from: '255/360/515 AP', to: '250/345/500 AP', moves: stars('u.@da_18_khazix.$dmg', [255, 360, 515], [250, 345, 500]) },
      { target: 'Kha’Zix', what: 'Isolated damage', from: '285/410/605 AP', to: '280/390/590 AP', moves: stars('u.@da_18_khazix.$isolated', [285, 410, 605], [280, 390, 590]) },
      { target: 'Mama Beak', what: 'Mana lock ends when the Tiny Beaks start to despawn', from: 'when they finish', to: 'about 1 second sooner', why: ENGINE },
      { target: 'Mama Beak', what: 'Ability attack damage', from: '22/33/52 AD', to: '20/30/50 AD', moves: stars('u.@da_crimsonraptor18.$dmgAd', [0.22, 0.33, 0.52], [0.2, 0.3, 0.5]) },
      { target: 'Master Yi', what: 'Starting Attack Damage (AD form)', from: '60', to: '63', moves: { 'u.@da_18_masteryi_ad.ad': [60, 63] } },
      { target: 'Master Yi', what: 'Ability damage (AP form)', from: '125/190/285 AP', to: '135/200/320 AP', why: 'Patchlab plays Master Yi in his AD form.' },
      { target: 'Tristana', what: 'Mana', from: '0/60', to: '0/50', moves: { 'u.@da_18_tristana.mana': [60, 50] } },
      { target: 'Tristana', what: 'Ability damage per attack', from: '10/15/25 AD', to: '12/18/28 AD', moves: stars('u.@da_18_tristana.$perAttack', [0.1, 0.15, 0.25], [0.12, 0.18, 0.28]) },
      { target: 'Brambleback', what: 'Alpha Mark heal', from: '4%', to: '5%', moves: { 'u.@da_brambleback18.$alphaHeal': [0.04, 0.05] } },
      { target: 'Brambleback', what: 'Armor ignore', from: '20% + 25% AP', to: '25% + 25% AP', moves: { 'u.@da_brambleback18.$ignore': [0.2, 0.25] } },
      { target: 'Malphite', what: 'Shield', from: '700/850 AP', to: '735/885 AP', moves: stars('u.@da_18_malphite.$shield', [700, 850], [735, 885]) },
      { target: 'Morgana', what: 'Initial curse damage', from: '60/90 AP', to: '70/105 AP', moves: stars('u.@da_18_morgana.$dmg', [60, 90], [70, 105]) },
      { target: 'Morgana', what: 'Curse bonus damage', from: '22/33 AP', to: '25/38 AP', moves: stars('u.@da_18_morgana.$curse', [22, 33], [25, 38]) },
      { target: 'Sentinel', what: 'Stun duration', from: '1s', to: '0.5s', why: ENGINE },
      { target: 'Sentinel', what: 'Shield', from: '350/450 AP', to: '375/475 AP', moves: stars('u.@da_sentinel18.$shield', [350, 450], [375, 475]) },
      { target: 'Sett', what: 'Heal', from: '225/275 AP', to: '250/300 AP', moves: stars('u.@da_18_sett.$heal', [225, 275], [250, 300]) },
      { target: 'Sivir', what: 'Ability damage', from: '200/300 AD', to: '220/330 AD', moves: stars('u.@da_18_sivir.$dmgAd', [2, 3], [2.2, 3.3]) },
      { target: 'Sivir', what: 'Bounce damage', from: '20% of initial', to: '18% of initial', moves: stars('u.@da_18_sivir.$bounce', [0.2, 0.2], [0.18, 0.18]) },
      { target: 'Soraka', what: 'Initial star damage', from: '225/335 AP', to: '235/355 AP', moves: stars('u.@da_18_soraka.$dmg', [225, 335], [235, 355]) },
      { target: 'Soraka', what: 'Additional star damage', from: '100/150 AP', to: '110/165 AP', moves: stars('u.@da_18_soraka.$extra', [100, 150], [110, 165]) },
      { target: 'Alune', what: 'Moonshard damage', from: '55/83 AP', to: '58/88 AP', moves: stars('u.@da_18_alune.$dmg', [55, 83], [58, 88]) },
      { target: 'Alune', what: 'Attack Speed', from: '0.8', to: '0.85', moves: { 'u.@da_18_alune.as': [0.8, 0.85] } },
      { target: 'Alune', what: 'Attuned Durability', from: '7%', to: '5%', moves: { 't.attuned.$dur': [0.07, 0.05] } },
      { target: 'Ashe', what: 'Damage over time', from: '9/14 AD', to: '11/16 AD', moves: stars('u.@da_18_ashe.$trailAd', [0.09, 0.14], [0.11, 0.16]) },
      { target: 'Taric', what: 'Resists', from: '65', to: '70', moves: { 'u.@da_taric18.armor': [65, 70], 'u.@da_taric18.mr': [65, 70] } },
      { target: 'Taric', what: 'Damage of his two empowered attacks', from: '100/150 AP', to: '130/200 AP', moves: stars('u.@da_taric18.$dmg', [100, 150], [130, 200]) },
      { target: 'Radiant Adaptive Helm', what: 'Mana Regen', from: '7', to: '6', why: 'Radiant items aren’t in Patchlab.' },
      { target: 'Radiant Adaptive Helm', what: 'AD and AP for holders that aren’t Tanks or Fighters', from: '40', to: '35', why: 'Radiant items aren’t in Patchlab.' },
      { target: 'Radiant Blue Buff', what: 'Base AD and AP', from: '30%', to: '25%', why: 'Radiant items aren’t in Patchlab.' },
    ],
  },
]

export const patchById = (id: string) => PATCHES.find((p) => p.id === id)

/** "November 4, 2026" */
export const patchDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
