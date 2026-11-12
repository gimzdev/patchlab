import { preconnect, preload } from 'react-dom'

/** What the lab needs first: the current TFT set, fetched while the page loads, and a connection to CommunityDragon's art */
export function labHints() {
  preload('/sets/tft.json', { as: 'fetch', crossOrigin: 'anonymous' })
  preconnect('https://raw.communitydragon.org', { crossOrigin: '' })
}
