import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { RunId, SourceId, SourceOverview } from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@viral/ui/primitives/button"
import { Panel } from "@viral/ui/primitives/panel"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Stat } from "@viral/ui/primitives/stat"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowRight, AudioLines, DollarSign, Images, Pencil, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { clock, plural } from "../../lib/format.ts"
import { artifactFileUrl } from "../../lib/media-url.ts"
import { ServerState } from "../home/server-state.tsx"
import { Detail } from "../system/detail.tsx"
import { overviewAtom } from "../home/overview.ts"
import { Page } from "../layout/page.tsx"
import { WaitingRows } from "../waiting/waiting-rows.tsx"
import { scopeWaiting } from "../waiting/waiting.ts"
import { FramesGrid } from "./frames-grid.tsx"
import { ProposalCard } from "./proposal-cards.tsx"
import { emptyProgress, isActive, type RunProgress } from "./run-progress.ts"
import { RunSteps } from "./run-steps.tsx"
import { StoryBeats } from "./story-beats.tsx"
import { StoryStrip } from "./story-strip.tsx"
import { TranscriptList } from "./transcript-list.tsx"
import { VideoDetails } from "./video-details.tsx"
import { MakeShortDialog } from "./make-short-dialog.tsx"
import { VideoSkeleton } from "./video-skeleton.tsx"
import { createProjectFromProposal, runProgressAtom, sourceOverviewAtom, startProjectRun } from "./videos-api.ts"
import { firstSentence, type FrameView, framesOf, nearestStill, proposalStillTime, runSpend, shortForProposal } from "./video-values.ts"

export type VideoTab = "progress" | "proposals" | "story" | "transcript" | "frames"

// A video's page: its header, then tabs for the run's progress, the three proposals, the story, the
// transcript and the frames, then what's waiting on this video.
export function VideoPage({ sourceId, tab, onTab }: { readonly sourceId: SourceId; readonly tab: VideoTab | undefined; readonly onTab: (tab: VideoTab) => void }) {
  const overview = useAtomValue(sourceOverviewAtom(sourceId))
  const refresh = useAtomRefresh(sourceOverviewAtom(sourceId))
  const data = AsyncResult.value(overview)
  // until the first answer: the same page frame, with loading or "can't reach the server"
  if (Option.isNone(data)) {
    return <Page title="Video"><ServerState result={overview} onRetry={refresh} skeleton={<VideoSkeleton />}>{() => null}</ServerState></Page>
  }
  return data.value.run === null
    ? <VideoContent data={data.value} progress={emptyProgress} tab={tab} onTab={onTab} refresh={refresh} />
    : <LiveVideo data={data.value} runId={data.value.run.id} tab={tab} onTab={onTab} refresh={refresh} />
}

// Follows the source run live; each finished step reloads the page's data (the story, the ads, the frames).
function LiveVideo({ data, runId, tab, onTab, refresh }: {
  readonly data: SourceOverview
  readonly runId: RunId
  readonly tab: VideoTab | undefined
  readonly onTab: (tab: VideoTab) => void
  readonly refresh: () => void
}) {
  const result = useAtomValue(runProgressAtom(runId))
  const progress = Option.getOrElse(AsyncResult.value(result), () => emptyProgress)
  const finished = progress.stages.filter((s) => s.status !== "running" && s.status !== "waiting").length
  const status = progress.run?.status
  useEffect(() => {
    if (finished > 0) refresh()
  }, [finished, status, refresh])
  return <VideoContent data={data} progress={progress} tab={tab} onTab={onTab} refresh={refresh} />
}

function VideoContent({ data, progress, tab, onTab, refresh }: {
  readonly data: SourceOverview
  readonly progress: RunProgress
  readonly tab: VideoTab | undefined
  readonly onTab: (tab: VideoTab) => void
  readonly refresh: () => void
}) {
  const navigate = useNavigate()
  const home = Option.getOrNull(AsyncResult.value(useAtomValue(overviewAtom)))
  const [editing, setEditing] = useState(false)
  const [making, setMaking] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const create = useAtomSet(createProjectFromProposal, { mode: "promise" })
  const start = useAtomSet(startProjectRun, { mode: "promise" })

  const { source, story } = data
  const owner = { _tag: "Source", id: source.id } as const
  const run = progress.run ?? data.run
  const running = isActive(run)
  const length = source.durationS ?? data.transcript?.lines.at(-1)?.end ?? 0
  const frames = data.contactSheet === null ? [] : framesOf(data.contactSheet.set)
  const srcOf = (frame: FrameView) => artifactFileUrl(serverUrl, owner, "contact-sheet", data.contactSheet?.version ?? 1, frame.file)
  const current: VideoTab = tab ?? (running || story === null ? "progress" : "proposals")
  const waiting = scopeWaiting(home?.waiting ?? [], source.id)
  const thumbs = new Map((home?.shorts ?? []).map((s) => [s.project.id, s.thumb]))
  const statusOf = new Map((home?.shorts ?? []).map((s) => [s.project.id, s.status]))

  // the proposal whose "Make this short" dialog is open
  const [asking, setAsking] = useState<number | null>(null)
  const make = (index: number, brief: string | null) => {
    setMaking(index)
    setError(null)
    create({ payload: { sourceId: source.id, proposal: index, brief } })
      .then((project) => start({ payload: { projectId: project.id, from: null } }).then(() => project))
      .then((project) => navigate({ to: "/shorts/$projectId", params: { projectId: project.id } }))
      .catch(() => setError("Couldn't make that short. Is the server running?"))
      .finally(() => {
        setMaking(null)
        setAsking(null)
      })
  }

  const sub = [
    source.channel,
    source.durationS === null ? null : clock(source.durationS),
    running ? "reading the video. You can close this window; it keeps going." : story === null ? null : firstSentence(story.summary)
  ].filter((part) => part !== null).join(" · ")

  return (
    <Page
      title={source.title ?? "Untitled video"}
      description={sub}
      actions={
        <>
          {running
            ? <Status tone="run">Reading the video</Status>
            : story !== null ? <Status tone="ok">Story mapped</Status>
            : run?.status === "failed" ? <Status tone="neutral">Stopped</Status> : null}
          <Button variant="ghost" onClick={() => setEditing((e) => !e)}><Pencil />Details</Button>
          {current === "progress" && story !== null ? (
            <Button variant="primary" size="md" onClick={() => onTab("proposals")}>See the proposals<ArrowRight /></Button>
          ) : null}
        </>
      }
    >
      {editing ? <VideoDetails source={source} onDone={() => (setEditing(false), refresh())} /> : null}

      <Segmented
        label="Video"
        className="mb-3"
        value={current}
        onChange={onTab}
        options={[
          ...(run === null ? [] : [{ value: "progress" as const, label: "Progress" }]),
          { value: "proposals" as const, label: <>Proposals <span className="text-fg-3">{story?.proposals.length ?? 0}</span></> },
          { value: "story" as const, label: <>Story <span className="text-fg-3">{story?.beats.length ?? 0}</span></> },
          { value: "transcript" as const, label: "Transcript" },
          { value: "frames" as const, label: <>Frames <span className="text-fg-3">{frames.length}</span></> }
        ]}
      />

      <div className="grid gap-2">
        {current === "progress" ? (
          <div className="grid grid-cols-4 gap-2">
            <Stat
              icon={<AudioLines />}
              label="Transcript"
              value={data.transcript === null ? "—" : `${data.transcript.words.toLocaleString()} words`}
              sub={data.transcript?.provider === "grok" ? "Grok" : data.transcript?.provider === "whisper-local" ? "Whisper on this Mac" : "not yet"}
            />
            <Stat
              icon={<Images />}
              label="Frames"
              value={frames.length === 0 ? "—" : frames.length}
              sub={data.contactSheet === null ? "not yet" : `one every ${data.contactSheet.set.every} seconds`}
            />
            <Stat
              icon={<TriangleAlert />}
              label="Kept out"
              value={plural(data.ads.length, "range")}
              sub={data.ads.length === 0 ? "nothing to keep out" : [...new Set(data.ads.map((a) => a.kind))].join(", ")}
            />
            <Detail>
              <Stat icon={<DollarSign />} label="So far" value={`$${runSpend(progress.stages.length > 0 ? progress.stages : data.stages).total.toFixed(2)}`} sub={runSpend(progress.stages.length > 0 ? progress.stages : data.stages).split || "nothing spent yet"} />
            </Detail>
          </div>
        ) : null}

        {current === "progress" ? (
          <Panel title="Steps" count={5}>
            <RunSteps
              progress={progress.run === null ? { ...progress, run: data.run, stages: data.stages } : progress}
              ads={data.ads}
              sheetThumbs={frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 8)) === 0).slice(0, 8).map((frame) => ({ frame, src: srcOf(frame) }))}
            />
          </Panel>
        ) : null}

        {current === "proposals" ? (
          story === null ? (
            <div className="rounded-panel bg-panel px-4 py-6 text-fg-2">The proposals appear once the story is mapped.</div>
          ) : (
            <>
              <Panel title={`The story, across ${Math.round(length / 60)} minutes`} actions={data.ads.length > 0 ? "hatched: kept out of every short" : undefined}>
                <StoryStrip beats={story.beats} ads={data.ads} length={length} />
              </Panel>
              <div className="grid grid-cols-3 gap-2">
                {story.proposals.map((proposal, i) => {
                  const short = shortForProposal(data.shorts, i, proposal.title)
                  const frame = nearestStill(frames, proposalStillTime(story.beats, i, length))
                  const thumb = short === null ? null : thumbs.get(short.project.id) ?? null
                  const still = frame !== null ? { frame, src: srcOf(frame) } : thumb !== null ? { thumb } : null
                  return (
                    <ProposalCard
                      key={i}
                      proposal={proposal}
                      index={i}
                      still={still}
                      made={short === null ? null : { short, status: statusOf.get(short.project.id) ?? null }}
                      busy={making === i}
                      onMake={() => setAsking(i)}
                      onOpen={() => short !== null && navigate({ to: "/shorts/$projectId", params: { projectId: short.project.id } })}
                    />
                  )
                })}
              </div>
              {error === null ? null : <div className="text-xs text-danger">{error}</div>}
            </>
          )
        ) : null}

        {current === "story" ? (
          story === null
            ? <div className="rounded-panel bg-panel px-4 py-6 text-fg-2">The story is mapped after the video is read.</div>
            : <StoryBeats summary={story.summary} beats={story.beats} />
        ) : null}

        {current === "transcript" ? (
          <TranscriptList lines={data.transcript?.lines ?? []} keptOut={(t) => data.ads.some((a) => t >= a.start && t < a.end)} />
        ) : null}

        {current === "frames" ? <FramesGrid frames={frames} srcOf={srcOf} /> : null}

        <Panel title="Waiting on this video" count={waiting.length}>
          <WaitingRows items={waiting} showVideo={false} thumbs={thumbs} now={Date.now()} />
        </Panel>
      </div>
      <MakeShortDialog
        title={asking === null ? "" : story?.proposals[asking]?.title ?? "this short"}
        open={asking !== null}
        busy={making !== null}
        onCancel={() => setAsking(null)}
        onMake={(brief) => {
          if (asking !== null) make(asking, brief)
        }}
      />
    </Page>
  )
}
