import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0f0d0b"/><path d="M13 5.6 20.4 9.9v8.6L13 22.8 5.6 18.5V9.9z" fill="#f1e9d8"/><path d="M19 9.2 26.4 13.5v8.6L19 26.4 11.6 22.1v-8.6z" fill="none" stroke="#e2b86a" stroke-width="2" stroke-linejoin="round"/></svg>`

export default function AppleIcon() {
  return new ImageResponse(<img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`} width={180} height={180} alt="" />, size)
}
