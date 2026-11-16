import { COLS, ROWS } from './types.ts'

// The board is 8 rows of 7 hexes, odd rows shifted half a hex to the right. Cells are numbered row * 7 + col, and
// distances, neighbours and positions are worked out once here so a fight only reads tables.

export const CELLS = ROWS * COLS
export const cell = (row: number, col: number) => row * COLS + col
export const rowOf = (c: number) => Math.floor(c / COLS)
export const colOf = (c: number) => c % COLS

const cube = (c: number) => {
  const row = rowOf(c), col = colOf(c), x = col - (row - (row & 1)) / 2
  return [x, row, -x - row] as const
}

/** Hex steps between two cells */
export const DIST = new Uint8Array(CELLS * CELLS)
for (let a = 0; a < CELLS; a++) {
  const [ax, ay, az] = cube(a)
  for (let b = 0; b < CELLS; b++) {
    const [bx, by, bz] = cube(b)
    DIST[a * CELLS + b] = Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz))
  }
}
export const dist = (a: number, b: number) => DIST[a * CELLS + b]

/** The up to six cells touching each cell */
export const NEIGHBORS: number[][] = []
for (let c = 0; c < CELLS; c++) {
  const row = rowOf(c), col = colOf(c), odd = row & 1
  const steps = odd ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]] : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]]
  NEIGHBORS.push(steps.map(([dr, dc]) => [row + dr, col + dc]).filter(([r, k]) => r >= 0 && r < ROWS && k >= 0 && k < COLS).map(([r, k]) => cell(r, k)))
}

/** Each cell's centre, in hex widths: for lines and cones */
export const CX = new Float64Array(CELLS)
export const CY = new Float64Array(CELLS)
for (let c = 0; c < CELLS; c++) {
  CX[c] = colOf(c) + (rowOf(c) & 1) * 0.5
  CY[c] = rowOf(c) * (Math.sqrt(3) / 2)
}

/** Which half a row belongs to: red owns rows 0 to 3, blue 4 to 7 */
export const sideOfRow = (row: number) => (row >= ROWS / 2 ? 0 : 1)
