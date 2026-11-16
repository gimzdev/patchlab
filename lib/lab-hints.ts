import { preconnect, preload } from 'react-dom'

/** What the lab needs first: the current TFT set and its opening boards, fetched while the page loads, and a connection to CommunityDragon's art */
export function labHints() {
  preload('/sets/tft.json', { as: 'fetch', crossOrigin: 'anonymous' })
  preload('/sets/sample.json', { as: 'fetch', crossOrigin: 'anonymous' })
  preconnect('https://raw.communitydragon.org', { crossOrigin: '' })
}
