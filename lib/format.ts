// Numbers as the app shows them: grouped thousands, a real minus sign, no trailing zeros

const MINUS = '−'

export const num = (n: number, digits = 0) =>
  Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }).replace('-', MINUS) : '–'

/** A share (0 to 1) as a percentage */
export const pct = (share: number, digits = 1) => `${num(share * 100, digits)}%`

/** With its sign: +8.4, −3.1, 0 */
export const signed = (n: number, digits = 1) => {
  const r = Number(n.toFixed(digits))
  return r > 0 ? `+${num(r, digits)}` : r < 0 ? `${MINUS}${num(-r, digits)}` : '0'
}

/** How much b moved from a, as a percentage of a */
export const change = (from: number, to: number) => (Math.abs(from) < 1e-9 ? (Math.abs(to) < 1e-9 ? 0 : Infinity) : (to - from) / Math.abs(from))

export const count = (n: number) => num(n)

/** 1000 → 1k, 20000 → 20k */
export const short = (n: number) => (n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : num(n))

export const seconds = (s: number) => `${num(s, 1)} s`
