import { ImageResponse } from 'next/og'
import { PICTURE, PICTURE_MAX, readRun, runPicture } from '@/lib/run-picture.tsx'

// The link picture of a shared run (/opengraph-image-run?s=<code>): its two boards, how often blue won before and after
// the change, and the change. The code says everything, so a picture never changes: kept for a year. The path holds
// "/opengraph-image", which the firewall lets every link-preview bot through (ship.sh --firewall).
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('s') ?? ''
  const run = code.length <= PICTURE_MAX ? readRun(code) : null
  return new ImageResponse(await runPicture(run), { ...PICTURE, headers: { 'Cache-Control': run ? 'public, max-age=31536000, immutable' : 'public, max-age=300' } })
}
