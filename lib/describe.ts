import { BONUS_META, toField } from '@/engine/patch.ts'
import type { Bonus, Effect } from '@/engine/types.ts'
import { num } from './format.ts'

// Numbers in words, for lists and headings

/** "+35% attack damage", "+150 health" */
export function bonusParts(b: Bonus): string[] {
  return (Object.entries(b) as [keyof Bonus, number][])
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .map(([k, v]) => {
      const meta = BONUS_META[k]
      if (!meta) return ''
      if (k === 'abilityCrit') return 'abilities can crit'
      if (k === 'shield') return `a ${num(toField(v, meta))}% health shield at the start`
      if (k === 'manaRegen') return `${v > 0 ? '+' : ''}${num(v, 1)} mana a second`
      const sign = v > 0 ? '+' : '−'
      return `${sign}${num(Math.abs(toField(v, meta)), 1)}${meta.pct ? '%' : ''} ${meta.label.replace(/ %$/, '').toLowerCase()}`
    })
    .filter(Boolean)
}

const WHO: Record<Effect['target'], string> = {
  target: 'the target',
  splash: 'the target and enemies near it',
  farthest: 'the farthest enemy',
  lowest: 'the enemy with the least health',
  all: 'every enemy',
  self: 'itself',
  ally: 'the ally with the least health',
  team: 'every ally',
}

/** "Magic damage to the target and enemies within 1 hex, scaling with ability power" */
export function effectText(e: Effect): string {
  const who = e.target === 'splash' ? `the target and enemies within ${num(e.radius ?? 1)} hex${(e.radius ?? 1) === 1 ? '' : 'es'}` : WHO[e.target]
  const scale = e.scale === 'ap' ? ', scaling with ability power' : e.scale === 'ad' ? ', as a share of attack damage' : e.scale === 'hp' ? ', as a share of max health' : ''
  const lasting = e.duration ? ` for ${num(e.duration, 2)} s` : ''
  switch (e.kind) {
    case 'damage':
      return `${e.type === 'physical' ? 'Physical' : e.type === 'true' ? 'True' : 'Magic'} damage to ${who}${scale}`
    case 'heal':
      return `Heals ${who}${scale}`
    case 'shield':
      return `Shields ${who}${lasting || ' for 4 s'}${scale}`
    case 'stun':
      return `Stuns ${who}, in seconds`
    case 'buff':
      return `${BONUS_META[e.stat ?? 'asPct']?.label ?? 'Stat'} for ${who}${lasting || ' for the rest of the fight'}`
  }
}
