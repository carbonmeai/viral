import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ApproachName, Run, RunId, SourceSetId, VideoSetMember, VideoSetOverview } from "@viral/contracts"
import { Link, useNavigate } from "@tanstack/react-router"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Input } from "@viral/ui/primitives/input"
import { Menu, MenuItem } from "@viral/ui/primitives/menu"
import { Panel } from "@viral/ui/primitives/panel"
import { Progress } from "@viral/ui/primitives/progress"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Pencil, Play, Replace, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { clock, plural } from "../../lib/format.ts"
import { homeFileUrl } from "../../lib/media-url.ts"
import { madeAsFor, matchesMadeAs } from "../home/made-as.ts"
import { overviewAtom } from "../home/overview.ts"
import { ServerState } from "../home/server-state.tsx"
import { Page } from "../layout/page.tsx"
import { Detail } from "../system/detail.tsx"
import { MakeShortDialog, SET_APPROACHES } from "../videos/make-short-dialog.tsx"
import { emptyProgress, isActive, type RunProgress } from "../videos/run-progress.ts"
import { beatStyle } from "../videos/story-strip.tsx"
import { VideoSkeleton } from "../videos/video-skeleton.tsx"
import { runProgressAtom, startProjectRun } from "../videos/videos-api.ts"
import { runSpend, shortForProposal, stageDetail } from "../videos/video-values.ts"
import { ReplaceDialog, type ReplaceTarget } from "../research/replace-dialog.tsx"
import { researchFacts } from "../research/research-values.ts"
import { ShortlistGate, ShortlistSearching } from "../research/shortlist-view.tsx"
import { SetProposalCard } from "./set-proposal-card.tsx"
import { BLOCKED_MESSAGE, failedOnItsOwn, memberState, plainMemberError, proposalMoment, proposalVideos, setPhase, sourceNames } from "./set-values.ts"
import { createProjectFromSetProposal, deleteVideoSet, renameVideoSet, startSetRun, videoSetOverviewAtom } from "./sets-api.ts"
import { VideoBadge, VideoDot } from "./video-badge.tsx"

export type SetTab = "videos" | "proposals"

// While anything on the page is being read, the page reloads this often, so videos' runs that start later appear.
const POLL_MS = 3000

// A video set's page: its header, then Videos (each video being read, live) and Proposals (the shorts across
// them, each showing which videos it uses).
export function SetPage({ setId, tab, onTab }: { readonly setId: SourceSetId; readonly tab: SetTab | undefined; readonly onTab: (tab: SetTab) => void }) {
  const overview = useAtomValue(videoSetOverviewAtom(setId))
  const refresh = useAtomRefresh(videoSetOverviewAtom(setId))
  const data = AsyncResult.value(overview)
  if (Option.isNone(data)) {
    return <Page title="Video set"><ServerState result={overview} onRetry={refresh} skeleton={<VideoSkeleton />}>{() => null}</ServerState></Page>
  }
  return data.value.run === null
    ? <SetContent data={data.value} progress={emptyProgress} tab={tab} onTab={onTab} refresh={refresh} />
    : <LiveSet data={data.value} runId={data.value.run.id} tab={tab} onTab={onTab} refresh={refresh} />
}

// Follows the set run live; each change reloads the page's data, and so does a timer while videos are read.
function LiveSet({ data, runId, tab, onTab, refresh }: {
  readonly data: VideoSetOverview
  readonly runId: RunId
  readonly tab: SetTab | undefined
  readonly onTab: (tab: SetTab) => void
  readonly refresh: () => void
}) {
  const result = useAtomValue(runProgressAtom(runId))
  const progress = Option.getOrElse(AsyncResult.value(result), () => emptyProgress)
  const finished = progress.stages.filter((s) => s.status !== "running" && s.status !== "waiting").length
  const status = progress.run?.status
  useEffect(() => {
    refresh()
  }, [finished, status, refresh])
  const reading = isActive(progress.run ?? data.run) || data.members.some((m) => isActive(m.run))
  useEffect(() => {
    if (!reading) return
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [reading, refresh])
  return <SetContent data={data} progress={progress} tab={tab} onTab={onTab} refresh={refresh} />
}

function SetContent({ data, progress, tab, onTab, refresh }: {
  readonly data: VideoSetOverview
  readonly progress: RunProgress
  readonly tab: SetTab | undefined
  readonly onTab: (tab: SetTab) => void
  readonly refresh: () => void
}) {
  const navigate = useNavigate()
  const home = Option.getOrNull(AsyncResult.value(useAtomValue(overviewAtom)))
  const create = useAtomSet(createProjectFromSetProposal, { mode: "promise" })
  const startShort = useAtomSet(startProjectRun, { mode: "promise" })
  const startRun = useAtomSet(startSetRun, { mode: "promise" })
  const remove = useAtomSet(deleteVideoSet, { mode: "promise" })
  // the format card picked on Home before this set started, if any: its suggestion gets a lemon outline
  const madeAs = madeAsFor(data.set.id)
  const [asking, setAsking] = useState<number | null>(null)
  const [making, setMaking] = useState<number | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { set, story, members } = data
  const run = progress.run ?? data.run
  const stages = progress.stages.length > 0 ? progress.stages : data.stages
  const phase = setPhase(run, stages, story !== null)
  // a set found from an idea: its page is the shortlist until you approve one (and again while a replacement waits)
  const gate = progress.pending.find((r) => r.payload?._tag === "ShortlistGate") ?? null
  const research = set.research
  const researchPhase = research === null
    ? null
    : gate !== null ? "shortlist" as const
    : members.length > 0 ? null
    : isActive(run) ? "searching" as const : "stopped" as const
  const [replacing, setReplacing] = useState<ReplaceTarget | null>(null)
  const current: SetTab = tab ?? (phase === "proposed" ? "proposals" : "videos")
  const titles = members.map((m) => m.source.title ?? "Untitled video")
  const names = sourceNames(members.map((m) => m.source))
  const thumbOf = new Map((home?.videos ?? []).map((v) => [v.source.id, v.thumb]))
  const statusOf = new Map((home?.shorts ?? []).map((s) => [s.project.id, s.status]))
  const read = members.filter((m) => m.ready).length

  const make = (index: number, brief: string | null, approach: ApproachName | null) => {
    setMaking(index)
    setError(null)
    create({ payload: { setId: set.id, proposal: index, brief, ...(approach === null ? {} : { approach }) } })
      .then((project) => startShort({ payload: { projectId: project.id, from: null } }).then(() => project))
      .then((project) => navigate({ to: "/shorts/$projectId", params: { projectId: project.id } }))
      .catch(() => setError("Couldn't make that short. Is the server running?"))
      .finally(() => {
        setMaking(null)
        setAsking(null)
      })
  }
  const runAgain = (from: "set-story" | null) => {
    setError(null)
    startRun({ payload: { setId: set.id, from } }).then(refresh).catch(() => setError("Couldn't start the set. Is the server running?"))
  }
  const deleteSet = () => {
    setError(null)
    setConfirmingDelete(false)
    remove({ payload: { id: set.id } })
      .then(() => navigate({ to: "/" }))
      .catch(() => setError(data.shorts.length > 0 ? `Delete its ${plural(data.shorts.length, "short")} first.` : "Couldn't delete the set."))
  }

  if (research !== null && researchPhase !== null) {
    const searching = progress.live.research?.message ?? null
    const shortlist = gate?.payload?._tag === "ShortlistGate" ? gate.payload.shortlist : null
    return (
      <Page
        title={set.title}
        description={`${researchPhase === "shortlist" ? "Shortlist ready" : researchPhase === "searching" ? "Searching" : "Stopped"} · ${researchFacts(research)}`}
        actions={
          <>
            {researchPhase === "searching" ? <Status tone="run">Searching YouTube</Status>
              : researchPhase === "shortlist" ? <Status tone="wait">Waiting for you</Status>
              : <Status tone="neutral">Stopped</Status>}
            {researchPhase === "stopped" ? <Button variant="primary" size="md" onClick={() => runAgain(null)}><Play />Search again</Button> : null}
            <Menu label={`More for ${set.title}`}>
              <MenuItem onClick={() => setRenaming(true)}><Pencil />Rename</MenuItem>
              <MenuItem tone="danger" onClick={() => setConfirmingDelete(true)}><Trash2 />Delete set</MenuItem>
            </Menu>
          </>
        }
      >
        <div className="grid gap-2">
          {error === null ? null : <div className="text-xs text-danger">{error}</div>}
          {researchPhase === "stopped" ? (
            <div className="rounded-panel bg-panel px-4 py-3.5 text-fg-1">
              The search stopped before its shortlist{run?.error ? <span className="text-fg-2">: {run.error}</span> : "."}
            </div>
          ) : null}
          {researchPhase === "shortlist" && gate !== null && shortlist !== null
            ? <ShortlistGate setId={set.id} research={research} request={gate} shortlist={shortlist} onAnswered={refresh} />
            : <ShortlistSearching research={research} message={searching} />}
        </div>
        <Dialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          title={`Delete “${set.title}”?`}
          description="The search and its shortlist go. Nothing was downloaded."
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>Keep</Button>
              <Button variant="primary" onClick={deleteSet}>Delete</Button>
            </>
          }
        />
        <RenameDialog open={renaming} setId={set.id} title={set.title} onDone={() => (setRenaming(false), refresh())} />
      </Page>
    )
  }

  // what "Replace this video" says about a member, or null when it doesn't need replacing
  const replaceWhy = (member: VideoSetMember): string | null => {
    if (research === null) return null
    if (member.missing !== null) return `The story step found something missing: ${member.missing}.`
    const state = memberState(member, member.run, member.stages)
    if (state._tag !== "failed" || !failedOnItsOwn(member.run)) return null
    const plain = plainMemberError(state.error)
    return plain === BLOCKED_MESSAGE ? "YouTube blocked the download." : `It couldn't be read: ${plain}`
  }

  const sub = [
    plural(members.length, "video"),
    phase === "reading" ? `reading them (${read} of ${members.length} read). You can close this window; it keeps going.`
      : phase === "proposing" ? "suggesting shorts across them"
      : story === null ? null : story.summary.split(/(?<=[.!?])\s+/)[0]
  ].filter((part) => part !== null).join(" · ")

  return (
    <Page
      title={set.title}
      description={sub}
      actions={
        <>
          {phase === "reading" ? <Status tone="run">Reading the videos</Status>
            : phase === "proposing" ? <Status tone="run">Suggesting shorts</Status>
            : phase === "proposed" ? <Status tone="ok">{plural(story?.proposals.length ?? 0, "proposal")}</Status>
            : phase === "stopped" ? <Status tone="neutral">Stopped</Status> : null}
          {phase === "stopped" || phase === "new" ? <Button variant="primary" size="md" onClick={() => runAgain(null)}><Play />{phase === "new" ? "Start" : "Try again"}</Button> : null}
          <Menu label={`More for ${set.title}`}>
            <MenuItem onClick={() => setRenaming(true)}><Pencil />Rename</MenuItem>
            {phase === "proposed" ? <MenuItem onClick={() => runAgain("set-story")}><Play />Suggest again</MenuItem> : null}
            <MenuItem tone="danger" onClick={() => setConfirmingDelete(true)}><Trash2 />Delete set</MenuItem>
          </Menu>
        </>
      }
    >
      <Segmented
        label="Video set"
        className="mb-3"
        value={current}
        onChange={onTab}
        options={[
          { value: "videos" as const, label: <>Videos <span className="text-fg-3">{members.length}</span></> },
          { value: "proposals" as const, label: <>Proposals <span className="text-fg-3">{story?.proposals.length ?? 0}</span></> }
        ]}
      />

      <div className="grid gap-2">
        {error === null ? null : <div className="text-xs text-danger">{error}</div>}

        {current === "videos" ? (
          <>
            <Panel title={research === null ? "The brief" : "The idea"}>
              <p className="m-0 leading-relaxed text-fg-1">{set.brief}</p>
              {research === null ? null : <p className="m-0 mt-1 text-xs text-fg-2">Found on YouTube: footage not yours, rights not confirmed. Each channel is kept for the credits.</p>}
            </Panel>
            <Panel title="Videos" count={`${read} of ${members.length} read`}>
              {members.map((member) => {
                const why = replaceWhy(member)
                const pick = data.shortlist?.picks.find((p) => p.sourceId === member.source.id) ?? null
                return (
                  <MemberRow
                    key={member.source.id}
                    member={member}
                    thumb={thumbOf.get(member.source.id) ?? (pick?.thumbnail === null || pick === null ? null : homeFileUrl(serverUrl, pick.thumbnail))}
                    onReplace={why === null ? null : () => setReplacing({ sourceId: member.source.id, title: member.source.title ?? "this video", why })}
                  />
                )
              })}
              <ProposeRow phase={phase} progress={progress} stages={stages} />
            </Panel>
          </>
        ) : null}

        {current === "proposals" ? (
          story === null ? (
            <div className="rounded-panel bg-panel px-4 py-6 text-fg-2">
              {phase === "stopped" ? "The set stopped before its proposals. Try again from the top." : "The proposals appear once every video is read and the story across them is mapped."}
            </div>
          ) : (
            <>
              <Panel title={`The story across ${plural(members.length, "video")}`}>
                <p className="m-0 mb-2 leading-relaxed text-fg-1">{story.summary}</p>
                {story.videos.map((v) => (
                  <div key={v.source} className="flex min-w-0 items-start gap-2.5 rounded-ctl bg-item px-3 py-2">
                    <VideoDot index={v.source} className="mt-[7px]" />
                    <span className="min-w-0 text-fg-1">
                      <span className="font-medium text-fg">{titles[v.source] ?? "Untitled video"}</span>
                      <span className="text-fg-2"> · {v.summary}</span>
                    </span>
                  </div>
                ))}
              </Panel>
              <div className="grid grid-cols-3 gap-2">
                {story.proposals.map((proposal, i) => {
                  const short = shortForProposal(data.shorts, i, proposal.title)
                  const at = proposalMoment(story, i)
                  const shown = at?.source ?? proposalVideos(proposal.sources)[0]
                  const sourceId = shown === undefined ? null : members[shown]?.source.id ?? null
                  const still = sourceId === null ? null : thumbOf.get(sourceId) ?? null
                  return (
                    <SetProposalCard
                      key={i}
                      proposal={proposal}
                      index={i}
                      titles={titles}
                      moment={at === null || sourceId === null ? null : { sourceId, t: at.t }}
                      still={still}
                      made={short === null ? null : { short, status: statusOf.get(short.project.id) ?? null }}
                      busy={making === i}
                      hinted={matchesMadeAs(madeAs, proposal.approach)}
                      onMake={() => setAsking(i)}
                      onOpen={() => short !== null && navigate({ to: "/shorts/$projectId", params: { projectId: short.project.id } })}
                    />
                  )
                })}
              </div>
              <Detail>
                <Panel title="Beats" count={story.beats.length}>
                  {story.beats.map((beat, i) => (
                    <div key={i} className="grid grid-cols-[auto_90px_minmax(0,1fr)_auto] items-start gap-3 rounded-ctl bg-item px-3 py-2.5">
                      <VideoBadge index={beat.source} name={names[beat.source]} title={titles[beat.source]} className="mt-px" />
                      <span className="w-fit rounded-chip px-2 py-0.5 text-xs font-medium" style={beatStyle(beat.beat)}>{beat.beat}</span>
                      <div className="min-w-0">
                        <div>{beat.summary}</div>
                        {beat.quotes.map((q, j) => <div key={j} className="mt-1 text-xs text-fg-2">“{q.text}” · {clock(q.start)}</div>)}
                      </div>
                      <span className="text-xs text-fg-2 tabular-nums">{clock(beat.start)}–{clock(beat.end)}</span>
                    </div>
                  ))}
                </Panel>
              </Detail>
            </>
          )
        ) : null}
      </div>

      <MakeShortDialog
        title={asking === null ? "" : story?.proposals[asking]?.title ?? "this short"}
        open={asking !== null}
        busy={making !== null}
        initialBrief={set.brief}
        description="The set's brief comes along. Change it for this short if you like; every step reads it first."
        approaches={SET_APPROACHES}
        initialApproach={story?.proposals[asking ?? -1]?.approach === "ranking" ? "ranking" : null}
        onCancel={() => setAsking(null)}
        onMake={(brief, approach) => {
          if (asking !== null) make(asking, brief, approach)
        }}
      />
      <Dialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${set.title}”?`}
        description={data.shorts.length > 0
          ? `Shorts were made from this set. Delete its ${plural(data.shorts.length, "short")} first.`
          : "The set's story and proposals go. Its videos stay in your library."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>Keep</Button>
            <Button variant="primary" disabled={data.shorts.length > 0} onClick={deleteSet}>Delete</Button>
          </>
        }
      />
      <RenameDialog open={renaming} setId={set.id} title={set.title} onDone={() => (setRenaming(false), refresh())} />
      <ReplaceDialog setId={set.id} target={replacing} shortlist={data.shortlist} onClose={() => setReplacing(null)} onDone={() => (setReplacing(null), refresh())} />
    </Page>
  )
}

// One of the set's videos: its badge, still and title (opening its own page), and how far it has been read, live.
// `onReplace`: "Replace this video", for a research set's video that couldn't be downloaded or lacks its moments.
function MemberRow({ member, thumb, onReplace }: { readonly member: VideoSetMember; readonly thumb: string | null; readonly onReplace: (() => void) | null }) {
  return member.run !== null && isActive(member.run)
    ? <LiveMemberRow member={member} thumb={thumb} runId={member.run.id} />
    : <MemberLine member={member} thumb={thumb} run={member.run} progress={null} onReplace={onReplace} />
}

function LiveMemberRow({ member, thumb, runId }: { readonly member: VideoSetMember; readonly thumb: string | null; readonly runId: RunId }) {
  const progress = Option.getOrElse(AsyncResult.value(useAtomValue(runProgressAtom(runId))), () => emptyProgress)
  return <MemberLine member={member} thumb={thumb} run={progress.run ?? member.run} progress={progress} onReplace={null} />
}

function MemberLine({ member, thumb, run, progress, onReplace }: {
  readonly member: VideoSetMember
  readonly thumb: string | null
  readonly run: Run | null
  readonly progress: RunProgress | null
  readonly onReplace: (() => void) | null
}) {
  const stages = progress !== null && progress.stages.length > 0 ? progress.stages : member.stages
  const state = memberState(member, run, stages)
  const live = progress === null ? null : Object.values(progress.live).at(-1) ?? null
  const { source } = member
  const facts = [
    source.channel,
    source.durationS === null ? null : clock(source.durationS),
    member.words === null ? null : `${member.words.toLocaleString()} words`,
    member.ready ? member.ads.length === 0 ? "nothing kept out" : `${plural(member.ads.length, "range")} kept out` : null
  ].filter((p) => p !== null).join(" · ")
  return (
    <div className="grid grid-cols-[auto_72px_minmax(0,1fr)_auto] items-center gap-3 rounded-ctl bg-item px-3 py-2">
      <VideoDot index={member.position} className="size-2.5" />
      {thumb === null ? <span className="aspect-video w-[72px] rounded-[5px] bg-ctl-active" /> : <img src={thumb} alt="" className="aspect-video w-[72px] rounded-[5px] object-cover" loading="lazy" />}
      <div className="min-w-0">
        <Link to="/videos/$sourceId" params={{ sourceId: source.id }} className="block truncate font-medium hover:underline">{source.title ?? "Untitled video"}</Link>
        {state._tag === "reading" ? (
          <div className="mt-1.5 grid max-w-90 gap-1">
            <Progress value={live?.pct === null || live?.pct === undefined ? null : live.pct / 100} label={state.step} />
            <div className="truncate text-xs text-fg-2">{state.step} · step {Math.min(state.done + 1, state.of)} of {state.of}{live?.message ? ` · ${live.message}` : ""}</div>
          </div>
        ) : state._tag === "failed" ? (
          <div className="mt-0.5 truncate text-xs text-danger" title={state.error}>{plainMemberError(state.error)}</div>
        ) : (
          <div className="mt-0.5 truncate text-xs text-fg-2">{facts || (state._tag === "waiting" ? "Waits its turn" : "")}</div>
        )}
        {member.missing === null ? null : <div className="mt-0.5 truncate text-xs text-wait">Missing: {member.missing}</div>}
      </div>
      {onReplace !== null ? <Button onClick={onReplace}><Replace />Replace this video</Button>
        : state._tag === "ready" ? <Status tone="ok">Read</Status>
        : state._tag === "reading" ? <Status tone="run">Reading</Status>
        : state._tag === "failed" ? <Status tone="neutral">Stopped</Status>
        : <Status tone="neutral">Waiting</Status>}
    </div>
  )
}

// The last step, once the videos are read: the story across them and three proposals.
function ProposeRow({ phase, progress, stages }: { readonly phase: ReturnType<typeof setPhase>; readonly progress: RunProgress; readonly stages: RunProgress["stages"] }) {
  const step = stages.findLast((s) => s.stage === "set-story")
  const live = progress.live["set-story"]
  const spend = runSpend(stages)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-ctl bg-item px-3 py-2.5">
      <div className="min-w-0">
        <div className={phase === "proposing" || phase === "proposed" ? "font-medium" : "font-medium text-fg-2"}>
          {phase === "proposed" ? "Suggested 3 shorts across the videos" : "Suggest shorts across the videos"}
        </div>
        {phase === "proposing" ? (
          <div className="mt-1.5 grid max-w-90 gap-1">
            <Progress value={null} label="Suggesting shorts" />
            {live?.message ? <div className="truncate text-xs text-fg-2">{live.message}</div> : null}
          </div>
        ) : (
          <div className="mt-0.5 text-xs text-fg-2">
            {step?.status === "failed" ? <span className="text-danger">{step.error ?? "This step stopped."}</span> : "Once every video is read: the story across them, and three shorts that use them together"}
          </div>
        )}
      </div>
      <Detail><span className="text-xs text-fg-2">{stageDetail(step) ?? (spend.total > 0 ? `$${spend.total.toFixed(2)}` : "")}</span></Detail>
    </div>
  )
}

function RenameDialog({ open, setId, title, onDone }: { readonly open: boolean; readonly setId: SourceSetId; readonly title: string; readonly onDone: () => void }) {
  const rename = useAtomSet(renameVideoSet, { mode: "promise" })
  const [text, setText] = useState(title)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setText(title)
  }, [open, title])
  const save = () => {
    setBusy(true)
    rename({ payload: { id: setId, title: text } }).then(onDone).catch(onDone).finally(() => setBusy(false))
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDone()
      }}
      title="Rename the set"
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={busy || text.trim() === ""} onClick={save}>Save</Button>
        </>
      }
    >
      <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() !== "" && save()} aria-label="Name" />
    </Dialog>
  )
}
