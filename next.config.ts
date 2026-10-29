import type { NextConfig } from 'next'

const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }

export default {
  poweredByHeader: false,
  // No AGENTS.md written into the project on every dev start
  agentRules: false,
  // The dev server also works from 127.0.0.1 and from your network's addresses (to try it on a phone)
  allowedDevOrigins: ['127.0.0.1', '192.168.*.*', '10.*.*.*', '*.local'],
  async headers() {
    return [
      { source: '/(.*)', headers: Object.entries(security).map(([key, value]) => ({ key, value })) },
      // The TFT set changes with each patch (app/sets/tft.json): browsers check again after 10 minutes
      { source: '/sets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=600, stale-while-revalidate=86400' }] },
    ]
  },
  async rewrites() { return { beforeFiles: [{ source: '/favicon.ico', destination: '/icon.svg' }] } },
} satisfies NextConfig
