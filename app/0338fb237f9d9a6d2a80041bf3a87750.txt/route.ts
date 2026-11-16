// IndexNow (ship.sh in gimz/): search engines read this key before they take the site's new URLs
export const dynamic = 'force-static'
export function GET() {
  return new Response('0338fb237f9d9a6d2a80041bf3a87750', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
