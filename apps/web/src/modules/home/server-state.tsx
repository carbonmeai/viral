import { Button } from "@viral/ui/primitives/button"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"
import { serverUrl } from "../../config/server-url.ts"

// Renders the data once it's there; while loading, a quiet line; if the server can't be reached, says so
// with where it looked and a way to try again.
export function ServerState<A, E>({ result, children, onRetry }: {
  readonly result: AsyncResult.AsyncResult<A, E>
  readonly children: (data: A) => ReactNode
  readonly onRetry?: () => void
}) {
  // the latest data, even when the most recent refresh failed: a blip shouldn't blank the page
  const data = AsyncResult.value(result)
  if (Option.isSome(data)) return children(data.value)
  if (AsyncResult.isFailure(result)) {
    return (
      <div className="flex items-center gap-3 rounded-panel bg-panel px-4 py-4">
        <div className="min-w-0">
          <div className="font-medium">Can't reach the Viral server</div>
          <div className="text-xs text-fg-2">Looked for it at {serverUrl}. Start it with `bun run dev:server`, or open the desktop app.</div>
        </div>
        {onRetry === undefined ? null : <Button className="ml-auto" onClick={onRetry}>Try again</Button>}
      </div>
    )
  }
  return <div className="px-1 py-4 text-fg-2">Loading…</div>
}
