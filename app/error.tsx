'use client'

// If something breaks while drawing the page, this shows instead of a blank screen. A setup saved in this browser
// could be what breaks it, so starting over clears it.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const startOver = () => {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('patchlab:')) localStorage.removeItem(key)
    } catch {
      /* nothing saved, or no access */
    }
    location.replace(location.pathname)
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl text-ink">Something broke</h1>
      <p className="text-sm text-pretty text-soft">Patchlab hit an error while drawing the page. Try again, or start over with the sample boards (this clears the setup saved in this browser).</p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="h-9 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-ink hover:bg-accent/90">Try again</button>
        <button type="button" onClick={startOver} className="h-9 rounded-lg border border-line bg-panel px-3.5 text-sm font-medium text-ink">Start over</button>
      </div>
    </main>
  )
}
