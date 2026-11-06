import { useAtomValue } from "@effect/atom-react"
import type { ProjectId, Run, StageName } from "@viral/contracts"
import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@viral/ui/primitives/button"
import { Panel } from "@viral/ui/primitives/panel"
import { Row } from "@viral/ui/primitives/row"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Page } from "../layout/page.tsx"
import { emptyProgress, isActive, latestAttempts } from "../videos/run-progress.ts"
import { runProgressAtom } from "../videos/videos-api.ts"
import { stepState } from "../videos/video-values.ts"
import { STEP_NAMES } from "../waiting/waiting.ts"
import { projectAtom, projectRunsAtom } from "./shorts-api.ts"

// The short's steps, in the words the editor will use.
const STEPS: ReadonlyArray<StageName> = ["script", "sections", "voice", "shots", "assemble", "render", "metadata"]
const stepName = (stage: StageName) => STEP_NAMES[stage] ?? (stage === "sections" ? "Sections" : stage === "assemble" ? "Assemble" : stage)

// Until the editor (milestone 3): the short, where its run is, and what it's waiting for, so it's never a dead end.
export function ShortPage({ projectId }: { readonly projectId: ProjectId }) {
  const project = Option.getOrNull(AsyncResult.value(useAtomValue(projectAtom(projectId))))
  const runs = Option.getOrElse(AsyncResult.value(useAtomValue(projectRunsAtom(projectId))), (): ReadonlyArray<Run> => [])
  const latest = [...runs].sort((a, b) => b.startedAt.epochMilliseconds - a.startedAt.epochMilliseconds)[0]
  const title = project === null ? "Short" : `${String(project.number).padStart(2, "0")} · ${project.title}`
  return (
    <Page
      title={title}
      description={project === null ? "The editor arrives in milestone 3" : `${project.approach} · the editor arrives in milestone 3`}
      actions={project === null ? undefined : (
        <Link to="/videos/$sourceId" params={{ sourceId: project.sourceId }} className={buttonVariants({ variant: "ghost" })}>Back to the video</Link>
      )}
    >
      {latest === undefined ? (
        <div className="rounded-panel bg-panel px-4 py-6 text-fg-2">This short hasn't started yet.</div>
      ) : <ShortRun run={latest} />}
    </Page>
  )
}

function ShortRun({ run }: { readonly run: Run }) {
  const progress = Option.getOrElse(AsyncResult.value(useAtomValue(runProgressAtom(run.id))), () => emptyProgress)
  const stages = latestAttempts(progress.stages)
  const steps = STEPS.filter((s) => stages.some((r) => r.stage === s) || s !== "sections")
  const waiting = progress.pending[0]
  return (
    <div className="grid gap-2">
      {waiting === undefined ? null : (
        <Panel title="Waiting for you">
          <Row className="grid-cols-[minmax(0,1fr)_auto]">
            <span className="font-medium">{waiting.title}</span>
            <Status tone="wait">{stepName(waiting.stage)} step</Status>
          </Row>
          <p className="m-0 mt-1 text-xs text-fg-2">
            You'll approve it here in the editor (milestone 3). Until then, answer it from the CLI: bun run cli approve {waiting.id}
          </p>
        </Panel>
      )}
      <Panel title="Steps" actions={isActive(progress.run ?? run) ? "running" : progress.run?.status ?? run.status}>
        {steps.map((stage) => {
          const state = stepState(stages.find((s) => s.stage === stage))
          return (
            <Row key={stage} className="grid-cols-[minmax(0,1fr)_auto]">
              <span className={state === "next" ? "text-fg-2" : "font-medium"}>{stepName(stage)}</span>
              <Status tone={state === "done" ? "ok" : state === "running" ? "run" : state === "waiting" ? "wait" : "neutral"}>
                {state === "done" ? "Done" : state === "running" ? "Running" : state === "waiting" ? "Waiting for you" : state === "failed" ? "Stopped" : "Next"}
              </Status>
            </Row>
          )
        })}
      </Panel>
    </div>
  )
}
