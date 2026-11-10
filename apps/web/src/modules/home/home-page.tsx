import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { TitleBar } from "../layout/title-bar.tsx"
import type { HomeSearch } from "./home-search.ts"
import { RecentsSkeleton } from "./home-skeleton.tsx"
import { type Overview, overviewAtom } from "./overview.ts"
import { PromptBox } from "./prompt-box.tsx"
import type { FormatHint } from "./prompt-values.ts"
import { Recents } from "./recents.tsx"
import { recentRows } from "./recents-values.ts"
import { ServerState } from "./server-state.tsx"

// Each format card's picture: a frame from one of your shorts made that way; the idea card shows a set found from an
// idea (two of its videos), else any two shorts.
const formatArt = (data: Overview | null): Partial<Record<FormatHint, ReadonlyArray<string>>> => {
  if (data === null) return {}
  const thumbOf = (format: string) => data.shorts.find((s) => s.project.format === format && s.thumb !== null)?.thumb
  const pictures = (src: string | null | undefined) => src === null || src === undefined ? [] : [src]
  const idea = data.setSummaries.find((s) => s.set.research !== null && s.thumbs.length > 1)?.thumbs.slice(0, 2)
    ?? data.shorts.flatMap((s) => s.thumb === null ? [] : [s.thumb]).slice(0, 2)
  return { narrated: pictures(thumbOf("narrated")), "cut-down": pictures(thumbOf("cut-down")), ranking: pictures(thumbOf("ranking")), idea }
}

// Home: "What would you like to create?" One box takes an idea, links or a file; under it the format cards and
// your recent shorts, video sets and videos. ?status=waiting is "Waiting for you": the same list, filtered.
export function HomePage({ search, onSearch }: { readonly search: HomeSearch; readonly onSearch: (next: HomeSearch) => void }) {
  const overview = useAtomValue(overviewAtom)
  const retry = useAtomRefresh(overviewAtom)
  const data = Option.getOrNull(AsyncResult.value(overview))
  const status = search.status ?? null
  return (
    <>
      <TitleBar title={status === "waiting" ? "Waiting for you" : "Home"} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[920px] px-6 pt-[72px] pb-24 max-[720px]:px-4 max-[720px]:pt-8">
          <h1 className="m-0 mb-[22px] text-center text-[26px] font-semibold tracking-[-0.02em]">What would you like to create?</h1>
          <PromptBox start={search.start} art={formatArt(data)} />
          <ServerState result={overview} onRetry={retry} skeleton={<RecentsSkeleton />}>
            {(loaded) => (
              <Recents
                rows={recentRows(loaded)}
                status={status}
                onStatus={(next) => onSearch(next === null ? {} : { status: next })}
              />
            )}
          </ServerState>
        </div>
      </div>
    </>
  )
}
