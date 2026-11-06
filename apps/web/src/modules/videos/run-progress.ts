import type { Run, RunRequest, RunUpdate, StageName, StageRun } from "@viral/contracts"

// A run as it happens: the run, its stage runs, what's waiting, and each stage's live progress.
export interface RunProgress {
  readonly run: Run | null
  readonly stages: ReadonlyArray<StageRun>
  readonly pending: ReadonlyArray<RunRequest>
  // the last progress per stage: a percentage (null when the stage can't tell) and its latest message
  readonly live: Partial<Record<StageName, { readonly pct: number | null; readonly message: string | null }>>
}

export const emptyProgress: RunProgress = { run: null, stages: [], pending: [], live: {} }

const upsert = (stages: ReadonlyArray<StageRun>, next: StageRun) =>
  stages.some((s) => s.id === next.id) ? stages.map((s) => s.id === next.id ? next : s) : [...stages, next]

// Folds a SubscribeRun stream: the snapshot first, then stored events, then live progress.
export const foldRun = (state: RunProgress, update: RunUpdate): RunProgress => {
  switch (update._tag) {
    case "Snapshot":
      return { ...state, run: update.run, stages: update.stageRuns, pending: update.pending }
    case "Progress": {
      const before = state.live[update.stage]
      return {
        ...state,
        live: { ...state.live, [update.stage]: { pct: update.pct ?? before?.pct ?? null, message: update.message ?? before?.message ?? null } }
      }
    }
    case "Event": {
      const event = update.event
      switch (event._tag) {
        case "RunStarted":
        case "RunFinished":
          return { ...state, run: event.run }
        case "StageStarted":
          return { ...state, stages: upsert(state.stages, event.stageRun) }
        case "StageFinished": {
          const live = { ...state.live }
          delete live[event.stageRun.stage]
          return { ...state, stages: upsert(state.stages, event.stageRun), live }
        }
        case "RequestRaised":
          return { ...state, pending: [...state.pending.filter((r) => r.id !== event.request.id), event.request] }
        case "RequestAnswered":
          return { ...state, pending: state.pending.filter((r) => r.id !== event.request.id) }
      }
    }
  }
}

// The latest attempt of each stage, in the order they first ran.
export const latestAttempts = (stages: ReadonlyArray<StageRun>): ReadonlyArray<StageRun> => {
  const byStage = new Map<StageName, StageRun>()
  for (const stage of stages) {
    const seen = byStage.get(stage.stage)
    if (seen === undefined || stage.attempt >= seen.attempt) byStage.set(stage.stage, stage)
  }
  return [...byStage.values()]
}

export const isActive = (run: Run | null) => run !== null && (run.status === "running" || run.status === "waiting")
