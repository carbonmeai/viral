import { useAtomValue } from "@effect/atom-react"
import { Page } from "../layout/page.tsx"
import { overviewAtom } from "../home/overview.ts"
import { SkeletonPanel } from "../home/home-skeleton.tsx"
import { ServerState } from "../home/server-state.tsx"
import { WaitingRows } from "./waiting-rows.tsx"

// Every step that needs you, across all your videos.
export function WaitingPage() {
  const overview = useAtomValue(overviewAtom)
  return (
    <Page title="Waiting for you" description="Every step that needs you, across all your videos. Shorts keep running in the background and stop here.">
      <ServerState result={overview} skeleton={<SkeletonPanel rows={4} thumb="tall" title={false} />}>
        {(data) => (
          <div className="flex flex-col gap-[3px] rounded-panel bg-panel px-1.5 pt-1 pb-1.5">
            <WaitingRows
              items={data.waiting}
              showVideo
              thumbs={new Map(data.shorts.map((s) => [s.project.id, s.thumb]))}
              videos={new Map(data.shorts.map((s) => [s.project.id, s.sourceTitle]))}
              now={Date.now()}
            />
          </div>
        )}
      </ServerState>
    </Page>
  )
}

