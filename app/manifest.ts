import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Patchlab',
    short_name: 'Patchlab',
    description: 'A balance sandbox for TFT: run thousands of fights with small tweaks, on the live patch or any other one.',
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
