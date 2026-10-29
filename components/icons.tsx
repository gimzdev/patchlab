import type { SVGProps } from 'react'

// Line icons on a 20px grid, drawn for this app

type P = SVGProps<SVGSVGElement>
const Svg = ({ children, ...p }: P) => (
  <svg viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    {children}
  </svg>
)

export const Logo = (p: P) => (
  <svg viewBox="0 0 32 32" width={26} height={26} aria-hidden {...p}>
    <path d="M13 3.6 21.6 8.6v10L13 23.6 4.4 18.6v-10z" fill="currentColor" />
    <path d="M19 8.4 27.6 13.4v10L19 28.4 10.4 23.4v-10z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
)
export const Undo = (p: P) => <Svg {...p}><path d="M7.5 5 4 8.5 7.5 12" /><path d="M4.5 8.5H12a4 4 0 0 1 0 8H9" /></Svg>
export const Redo = (p: P) => <Svg {...p}><path d="M12.5 5 16 8.5 12.5 12" /><path d="M15.5 8.5H8a4 4 0 0 0 0 8h3" /></Svg>
export const LinkIcon = (p: P) => <Svg {...p}><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1" /><path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" /></Svg>
export const Sun = (p: P) => <Svg {...p}><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" /></Svg>
export const Moon = (p: P) => <Svg {...p}><path d="M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2z" /></Svg>
export const GitHub = (p: P) => (
  <svg viewBox="0 0 16 16" width={17} height={17} fill="currentColor" aria-hidden {...p}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
)
export const Play = (p: P) => <Svg {...p}><path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none" /></Svg>
export const Pause = (p: P) => <Svg {...p}><path d="M7 4.5v11M13 4.5v11" strokeWidth={2.4} /></Svg>
export const Stop = (p: P) => <Svg {...p}><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" /></Svg>
export const Eye = (p: P) => <Svg {...p}><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" /><circle cx="10" cy="10" r="2.4" /></Svg>
export const Close = (p: P) => <Svg {...p}><path d="M5 5l10 10M15 5 5 15" /></Svg>
export const Plus = (p: P) => <Svg {...p}><path d="M10 4.5v11M4.5 10h11" /></Svg>
export const Trash = (p: P) => <Svg {...p}><path d="M4 6h12M8 6V4.5h4V6M5.5 6l.7 9.5h7.6l.7-9.5" /></Svg>
export const Chevron = (p: P) => <Svg {...p}><path d="m6 8 4 4 4-4" /></Svg>
export const Search = (p: P) => <Svg {...p}><circle cx="9" cy="9" r="5" /><path d="m13 13 3.5 3.5" /></Svg>
export const Swap = (p: P) => <Svg {...p}><path d="M6 3.5v13M3.5 6 6 3.5 8.5 6M14 16.5v-13M11.5 14l2.5 2.5 2.5-2.5" /></Svg>
export const Copy = (p: P) => <Svg {...p}><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" /></Svg>
export const Check = (p: P) => <Svg {...p}><path d="m4.5 10.5 3.5 3.5 7.5-8" /></Svg>
export const Download = (p: P) => <Svg {...p}><path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4 16h12" /></Svg>
export const Upload = (p: P) => <Svg {...p}><path d="M10 12.5v-9M6.5 7 10 3.5 13.5 7M4 16h12" /></Svg>
export const Sliders = (p: P) => <Svg {...p}><path d="M4 6h7M15 6h1M4 14h1M9 14h7" /><circle cx="13" cy="6" r="2" /><circle cx="7" cy="14" r="2" /></Svg>
export const Reset = (p: P) => <Svg {...p}><path d="M4.5 9A5.5 5.5 0 1 1 6 13.5" /><path d="M4 4.5V9h4.5" /></Svg>
export const More = (p: P) => <Svg {...p}><circle cx="5" cy="10" r="1.1" fill="currentColor" /><circle cx="10" cy="10" r="1.1" fill="currentColor" /><circle cx="15" cy="10" r="1.1" fill="currentColor" /></Svg>
export const Dice = (p: P) => <Svg {...p}><rect x="3.5" y="3.5" width="13" height="13" rx="3" /><circle cx="7.5" cy="7.5" r=".9" fill="currentColor" /><circle cx="12.5" cy="12.5" r=".9" fill="currentColor" /><circle cx="12.5" cy="7.5" r=".9" fill="currentColor" /><circle cx="7.5" cy="12.5" r=".9" fill="currentColor" /></Svg>
export const Star = (p: P) => (
  <svg viewBox="0 0 10 10" width={9} height={9} aria-hidden {...p}>
    <path d="M5 .6l1.3 2.8 3 .3-2.3 2 .7 3L5 7.2 2.3 8.7l.7-3-2.3-2 3-.3z" fill="currentColor" />
  </svg>
)
export const Back = (p: P) => <Svg {...p}><path d="M12 4.5 6.5 10l5.5 5.5" /></Svg>
export const Forward = (p: P) => <Svg {...p}><path d="M8 4.5 13.5 10 8 15.5" /></Svg>
export const Save = (p: P) => <Svg {...p}><path d="M5.5 3.5h9v13L10 13l-4.5 3.5z" /></Svg>
export const Mirror = (p: P) => <Svg {...p}><path d="M10 3v14" strokeDasharray="1.6 2.2" /><path d="M7.5 6 3.5 14h4z" /><path d="M12.5 6l4 8h-4z" /></Svg>
export const Pencil = (p: P) => <Svg {...p}><path d="M12.5 4.5 15.5 7.5 7 16H4v-3z" /><path d="M11 6l3 3" /></Svg>
export const Layers = (p: P) => <Svg {...p}><path d="M10 3.5 17 7.5l-7 4-7-4z" /><path d="m3 11 7 4 7-4" /></Svg>
export const Hex = (p: P) => <Svg {...p}><path d="M10 2.8 16.3 6.4v7.2L10 17.2 3.7 13.6V6.4z" /></Svg>
