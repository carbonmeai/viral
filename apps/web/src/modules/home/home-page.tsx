import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Link, useNavigate } from "@tanstack/react-router"
import { Button, buttonVariants } from "@viral/ui/primitives/button"
import { Panel } from "@viral/ui/primitives/panel"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Stat } from "@viral/ui/primitives/stat"
import { Status } from "@viral/ui/primitives/status"
import { Thumb } from "@viral/ui/primitives/thumb"
import { CheckCircle2, Film, Inbox, Play, Plus } from "lucide-react"
import { clock, plural } from "../../lib/format.ts"
import { Page } from "../layout/page.tsx"
import { useDetailed } from "../system/detail.tsx"
import { WaitingRows } from "../waiting/waiting-rows.tsx"
import { homeStats } from "./home-values.ts"
import { type Overview, overviewAtom } from "./overview.ts"
import { HomeSkeleton } from "./home-skeleton.tsx"
import { ServerState } from "./server-state.tsx"

const WAITING_ON_HOME = 3

// Home: what's waiting for you, your videos and the shorts made from them.
export function HomePage() {
  const overview = useAtomValue(overviewAtom)
  const retry = useAtomRefresh(overviewAtom)
  return (
    <Page
      title="Home"
      description="Your videos, the shorts made from them, and what’s waiting for you."
      actions={<Link to="/videos/new" className={buttonVariants({ variant: "primary", size: "md" })}><Plus />New source</Link>}
    >
      <ServerState result={overview} onRetry={retry} skeleton={<HomeSkeleton />}>{(data) => <HomeContent data={data} />}</ServerState>
    </Page>
  )
}

function HomeContent({ data }: { readonly data: Overview }) {
  const navigate = useNavigate()
  const detailed = useDetailed()
  const stats = homeStats(data)
  const published = data.shorts.filter((s) => s.status.label === "Published")
  const thumbs = new Map(data.shorts.map((s) => [s.project.id, s.thumb]))

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-4 gap-2">
        <Stat icon={<Inbox />} label="Waiting for you" value={stats.waiting.value} sub={stats.waiting.sub} />
        <Stat icon={<Film />} label="Videos" value={stats.videos.value} sub={stats.videos.sub} />
        <Stat icon={<Play />} label="Shorts" value={stats.shorts.value} sub={stats.shorts.sub} />
        <Stat icon={<CheckCircle2 />} label="Published" value={published.length} sub={published[0]?.project.title ?? "nothing yet"} />
      </div>

      <Panel
        title="Waiting for you"
        count={data.waiting.length}
        actions={<Link to="/waiting" className={buttonVariants({ variant: "ghost" })}>View all</Link>}
      >
        <WaitingRows items={data.waiting.slice(0, WAITING_ON_HOME)} showVideo thumbs={thumbs} videos={new Map(data.shorts.map((s) => [s.project.id, s.sourceTitle]))} now={Date.now()} />
      </Panel>

      <div className="grid grid-cols-2 items-start gap-2">
        <Panel title="Videos" actions={<Link to="/videos/new" className={buttonVariants({ variant: "ghost" })}><Plus />Add</Link>}>
          {data.videos.length === 0 ? (
            <Row className="grid-cols-[minmax(0,1fr)_auto]">
              <span className="text-fg-2">No videos yet. Add a link or a file to start.</span>
              <Button variant="primary" onClick={() => navigate({ to: "/videos/new" })}>Add a video</Button>
            </Row>
          ) : data.videos.map((video) => (
            <Row
              key={video.source.id}
              className="grid-cols-[minmax(0,1fr)_auto]"
              onOpen={() => navigate({ to: "/videos/$sourceId", params: { sourceId: video.source.id } })}
            >
              <RowTitle
                media={<Thumb shape="wide" width={64} src={video.thumb} fallback={<Film className="size-3.5" />} />}
                title={video.source.title ?? "Untitled video"}
                sub={[
                  detailed ? video.source.channel : null,
                  detailed && video.source.durationS !== null ? clock(video.source.durationS) : null,
                  plural(video.shortCount, "short")
                ].filter((part) => part !== null).join(" · ")}
              />
              <Status tone={video.status.tone}>{video.status.label}</Status>
            </Row>
          ))}
        </Panel>

        <Panel title="Shorts">
          {data.shorts.length === 0 ? (
            <Row className="grid-cols-1"><span className="text-fg-2">No shorts yet. Pick one of a video’s proposals to make one.</span></Row>
          ) : data.shorts.map((short) => (
            <Row
              key={short.project.id}
              className="grid-cols-[minmax(0,1fr)_auto]"
              onOpen={() => navigate({ to: "/shorts/$projectId", params: { projectId: short.project.id } })}
            >
              <RowTitle
                media={<Thumb shape="tall" width={24} src={short.thumb} />}
                title={short.project.title}
                sub={[
                  short.sourceTitle,
                  detailed ? short.project.approach : null,
                  detailed && short.durationS !== null ? `${short.durationS.toFixed(1)}s` : null
                ].filter((part) => part !== null).join(" · ")}
              />
              <Status tone={short.status.tone}>{short.status.label}</Status>
            </Row>
          ))}
        </Panel>
      </div>
    </div>
  )
}
