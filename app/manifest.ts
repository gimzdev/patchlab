import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Patchlab',
    short_name: 'Patchlab',
    description: 'A balance sandbox for TFT and auto-battlers: put two comps on the board, change a number, run thousands of fights, see what moves.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f0d0b',
    theme_color: '#0f0d0b',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
