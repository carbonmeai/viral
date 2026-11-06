import type { AdRange, StageName, StageRun } from "@viral/contracts"
import { Progress } from "@viral/ui/primitives/progress"
import { Check, Loader2, X } from "lucide-react"
import { clock } from "../../lib/format.ts"
import { useDetailed } from "../system/detail.tsx"
import type { RunProgress } from "./run-progress.ts"
import { latestAttempts } from "./run-progress.ts"
import { FrameImage } from "./frame-image.tsx"
import { type FrameView, SOURCE_STAGES, stageDetail, stepState } from "./video-values.ts"

export interface RunStepsProps {
  readonly progress: RunProgress
  readonly ads: ReadonlyArray<AdRange>
  // a few frames to show under "Looked at the whole video"
  readonly sheetThumbs: ReadonlyArray<{ readonly frame: FrameView; readonly src: string }>
}

// The source run, step by step: what's done, what's running (with its live progress and the agent's latest
// message), and what's next. Detailed mode adds each step's model, cost and time.
export function RunSteps({ progress, ads, sheetThumbs }: RunStepsProps) {
  const detailed = useDetailed()
  const latest = new Map<StageName, StageRun>(latestAttempts(progress.stages).map((s) => [s.stage, s]))
  return (
    <div className="flex flex-col gap-[3px]">
      {SOURCE_STAGES.map(({ stage, running, done, sub }) => {
        const run = latest.get(stage)
        const state = stepState(run)
        const live = progress.live[stage]
        const detail = detailed ? stageDetail(run) : null
        return (
          <div key={stage} className="grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 rounded-ctl bg-item px-3 py-2.5">
            <StepIcon state={state} />
            <div className="min-w-0">
              <div className={state === "next" ? "font-medium text-fg-2" : "font-medium"}>{state === "done" ? done : running}</div>
              {state === "running" ? (
                <div className="mt-1.5 grid gap-1.5">
                  <Progress value={live?.pct === null || live?.pct === undefined ? null : live.pct / 100} className="max-w-90" label={running} />
                  {live?.message ? <div className="truncate text-xs text-fg-2">{live.message}</div> : null}
                </div>
              ) : state === "failed" ? (
                <div className="mt-0.5 text-xs text-danger">{run?.error ?? "This step stopped."}</div>
              ) : stage === "ads" && state === "done" && ads.length > 0 ? (
                <div className="mt-0.5 grid gap-0.5 text-xs text-fg-2">
                  {ads.map((a, i) => <span key={i} className="truncate">{clock(a.start)}–{clock(a.end)} · {a.kind} · “{a.evidence}”</span>)}
                </div>
              ) : stage === "contact-sheet" && state === "done" && sheetThumbs.length > 0 ? (
                <div className="mt-1.5 flex gap-1.5">
                  {sheetThumbs.map(({ frame, src }) => <FrameImage key={`${frame.file}-${frame.t}`} frame={frame} src={src} className="w-[72px] rounded-[5px]" />)}
                </div>
              ) : (
                <div className="mt-0.5 text-xs text-fg-2">{sub}</div>
              )}
            </div>
            <span className="text-xs text-fg-2">{detail ?? ""}</span>
          </div>
        )
      })}
    </div>
  )
}

function StepIcon({ state }: { readonly state: ReturnType<typeof stepState> }) {
  const box = "grid size-6 place-items-center rounded-[7px] [&_svg]:size-3.5"
  switch (state) {
    case "done":
      return <span className={`${box} bg-[color-mix(in_srgb,var(--ok-dot)_16%,transparent)] text-ok`}><Check /></span>
    case "running":
    case "waiting":
      return <span className={`${box} bg-lemon-soft text-lemon-fg`}><Loader2 className="animate-spin" /></span>
    case "failed":
      return <span className={`${box} bg-ctl text-danger`}><X /></span>
    case "next":
      return <span className={`${box} bg-ctl`} />
  }
}
