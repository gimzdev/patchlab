import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { NextConfig } from 'next'

const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }

export default {
  poweredByHeader: false,
  // No AGENTS.md written into the project on every dev start
  agentRules: false,
  // The dev server also works from 127.0.0.1 and from your network's addresses (to try it on a phone)
  allowedDevOrigins: ['127.0.0.1', '192.168.*.*', '10.*.*.*', '*.local'],
  // The newest patch page fights the meta comps while the site builds (lib/patch-run.ts, about 15 seconds), next to the
  // fights that find the opening boards (app/sets/sample.json): room for both
  staticPageGenerationTimeout: 180,
  // Whether the pages' link picture is there when the site is built: app/opengraph-image.jpg, the owner's own, which
  // the installer copies in. A build without it gives the pages a picture the site draws (app/layout.tsx).
  env: { PL_PICTURE: existsSync(join(process.cwd(), 'app', 'opengraph-image.jpg')) ? '1' : '' },
  async headers() {
    return [
      { source: '/(.*)', headers: Object.entries(security).map(([key, value]) => ({ key, value })) },
      // The opening boards are fetched while the page loads (lib/lab-hints.ts) and again by the lab: with ten minutes
      // of freshness the browser uses the first answer for both (without, it asked the server twice)
      { source: '/sets/sample.json', headers: [{ key: 'Cache-Control', value: 'public, max-age=600' }] },
    ]
  },
  async rewrites() { return { beforeFiles: [{ source: '/favicon.ico', destination: '/icon.svg' }] } },
} satisfies NextConfig
