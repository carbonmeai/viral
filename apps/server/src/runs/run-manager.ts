import {
  type GatePayload,
  type GateResponse,
  type RequestId,
  RequestNotPending,
  type Run,
  type RunEvent,
  RunNotFound,
  type RunId,
  type RunOwner,
  type RunRequest,
  type RunUpdate,
  type StageName,
  type StageRun
} from "@viral/contracts"
import { Context, Deferred, Effect, Fiber, FiberMap, Layer, Option, PubSub, Ref, Stream } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { RunStore } from "./run-store.ts"
import { findStage, type Prerequisite, type StageContext, type StageDefinition, StageFailure, StageRegistry } from "./stages.ts"

interface Published {
  readonly runId: RunId
  readonly update: RunUpdate
}

const APPROVED = new Set(["succeeded", "reused"])

// A rejection a stage sends back to an earlier one.
type SentBack = { readonly stage: StageName; readonly note: string }

// Runs stages in order for a source, a video set or a short. A run with prerequisites (a video set's) first has each
// of its videos read by that video's own run, two at a time, joining one already going. Each stage's approved artifact is reused; a gated stage
// waits for your answer (approve, reject with a note to re-run, or edit). Every run is a fiber, so
// cancelling it stops the running stage's agent session or child processes. Stage-level events are stored
// with a sequence number and published live, with progress, to subscribers.
export class RunManager extends Context.Service<RunManager, {
  start(owner: RunOwner, from: StageName | null): Effect.Effect<Run, StageFailure>
  cancel(runId: RunId): Effect.Effect<boolean>
  resume(runId: RunId): Effect.Effect<Run, RunNotFound | StageFailure>
  respond(requestId: RequestId, response: GateResponse): Effect.Effect<RunRequest, RequestNotPending>
  subscribe(runId: RunId, afterSeq: number): Stream.Stream<RunUpdate, RunNotFound>
}>()("@viral/server/runs/run-manager/RunManager") {
  static readonly layer = Layer.effect(
    RunManager,
    Effect.gen(function*() {
      const store = yield* RunStore
      const registry = yield* StageRegistry
      const artifacts = yield* Artifacts
      const fibers = yield* FiberMap.make<RunId>()
      const updates = yield* PubSub.unbounded<Published>()
      const answers = new Map<RequestId, Deferred.Deferred<GateResponse>>()
      // runs you cancelled; any other interruption (the server shutting down) leaves a run resumable
      const cancelling = new Set<RunId>()

      // A previous server process may have died mid-run. Its runs are marked interrupted and their open
      // gates cancelled; resuming raises the gate again without re-running the stage.
      const abandoned = yield* store.interruptAbandonedRuns
      yield* store.cancelPendingRequests(null)
      if (abandoned > 0) yield* Effect.logInfo("interrupted runs from a previous session", { count: abandoned })

      const publish = Effect.fn("RunManager.publish")(function*(runId: RunId, event: RunEvent) {
        const seq = yield* store.appendEvent(runId, event)
        yield* PubSub.publish(updates, { runId, update: { _tag: "Event", seq, event } })
      })

      // The waiter is registered before the gate is announced, so an answer that arrives the moment a client
      // sees the gate is never missed.
      const awaitAnswer = (deferred: Deferred.Deferred<GateResponse>, requestId: RequestId) =>
        Deferred.await(deferred).pipe(Effect.ensuring(Effect.sync(() => void answers.delete(requestId))))

      // Runs one stage to approval. Returns the stage to go back to when a rejection is sent elsewhere.
      const runStage: (
        run: Run,
        stage: StageDefinition,
        forced: boolean,
        current: Ref.Ref<StageRun | null>,
        sessions: Map<StageName, string>,
        sentBack: { readonly note: string } | null
      ) => Effect.Effect<Option.Option<SentBack>, StageFailure> = Effect.fn("RunManager.runStage")(function*(
        run: Run,
        stage: StageDefinition,
        forced: boolean,
        current: Ref.Ref<StageRun | null>,
        // agent sessions of this run's stages, so a stage sent back continues its conversation
        sessions: Map<StageName, string>,
        // set when a later stage sent its rejection back here
        sentBack: { readonly note: string } | null
      ) {
          // a stage can run more than once in a run (sent back), so attempts keep counting
          const earlier = (yield* store.listStageRuns(run.id)).filter((s) => s.stage === stage.name).length
          const latest = yield* store.latestArtifact(run.owner, stage.artifact)
          const approved = Option.isSome(latest) &&
            (latest.value.stageRunStatus === null || APPROVED.has(latest.value.stageRunStatus))
          if (approved && !forced) {
            const reused = yield* store.createStageRun(run.id, stage.name, earlier + 1, "reused")
            yield* publish(run.id, { _tag: "StageFinished", stageRun: reused })
            return Option.none<SentBack>()
          }
          // An artifact made but never approved (its run was interrupted at the gate): ask again, don't redo it.
          let produce = forced || stage.gate === null || Option.isNone(latest)
          let note: string | null = sentBack?.note ?? null
          let session: string | null = sentBack === null ? null : sessions.get(stage.name) ?? null

          for (let attempt = earlier + 1;; attempt++) {
            const stageRun = yield* store.createStageRun(run.id, stage.name, attempt, "running")
            yield* Ref.set(current, stageRun)
            yield* publish(run.id, { _tag: "StageStarted", stageRun })
            const ctx: StageContext = {
              owner: run.owner,
              runId: run.id,
              stageRunId: stageRun.id,
              attempt,
              note,
              resumeSession: session,
              recordSession: (id) =>
                Effect.sync(() => {
                  session = id
                  sessions.set(stage.name, id)
                }).pipe(Effect.andThen(store.recordSession(stageRun.id, id))),
              progress: (pct, message) =>
                PubSub.publish(updates, {
                  runId: run.id,
                  update: { _tag: "Progress", stage: stage.name, pct, message: message ?? null }
                }).pipe(Effect.asVoid),
              recordCost: (cost) => store.recordCost(stageRun.id, cost)
            }

            if (produce) yield* stage.run(ctx)
            else yield* store.linkLatestArtifact(run.owner, stage.artifact, stageRun.id)

            if (stage.gate === null) {
              const done = yield* store.updateStageRun(stageRun.id, "succeeded", null)
              yield* publish(run.id, { _tag: "StageFinished", stageRun: done })
              return Option.none()
            }

            const artifact = yield* artifacts.latest(run.owner, stage.artifact)
            const payload = Option.match(artifact, {
              onNone: () => null,
              onSome: (a): GatePayload => stage.gatePayload?.(a) ?? { _tag: "ArtifactGate", artifact: a }
            })
            yield* store.updateStageRun(stageRun.id, "waiting", null)
            yield* store.setRunStatus(run.id, "waiting")
            const request = yield* store.createRequest(stageRun, stage.gate, payload)
            const answer = yield* Deferred.make<GateResponse>()
            answers.set(request.id, answer)
            yield* publish(run.id, { _tag: "RequestRaised", request })
            const response = yield* awaitAnswer(answer, request.id)
            yield* store.setRunStatus(run.id, "running")

            switch (response._tag) {
              case "Approve": {
                if (stage.approved !== undefined) yield* stage.approved(ctx)
                const done = yield* store.updateStageRun(stageRun.id, "succeeded", null)
                yield* publish(run.id, { _tag: "StageFinished", stageRun: done })
                return Option.none()
              }
              case "Edit": {
                if (stage.applyEdit === undefined) {
                  return yield* new StageFailure({ stage: stage.name, code: "not-editable", message: "this stage can't be edited" })
                }
                yield* stage.applyEdit(ctx, response.artifact)
                if (stage.approved !== undefined) yield* stage.approved(ctx)
                const done = yield* store.updateStageRun(stageRun.id, "succeeded", null)
                yield* publish(run.id, { _tag: "StageFinished", stageRun: done })
                return Option.none()
              }
              case "Reject": {
                // your choice of stage first, then the stage's own default; otherwise this stage runs again
                const backTo = response.to !== undefined && response.to !== stage.name ? response.to : stage.rejectTo
                const target = backTo === undefined ? "" : ` (back to ${backTo})`
                const rejected = yield* store.updateStageRun(stageRun.id, "failed", `rejected${target}: ${response.note}`)
                yield* publish(run.id, { _tag: "StageFinished", stageRun: rejected })
                if (backTo !== undefined) return Option.some({ stage: backTo, note: response.note })
                note = response.note
                produce = true
              }
            }
          }
      })

      // A run's stages, or only those up to and including `through` (a video read for a set stops after its ads).
      const stagesUpTo = Effect.fn("RunManager.stagesUpTo")(function*(owner: RunOwner, through: StageName | null) {
        const stages = yield* registry.stagesFor(owner)
        if (through === null) return stages
        const end = Option.getOrElse(findStage(stages, through), () => stages.length - 1)
        return stages.slice(0, end + 1)
      })

      const isApproved = (owner: RunOwner, stage: StageDefinition) =>
        Effect.map(store.latestArtifact(owner, stage.artifact), (latest) =>
          Option.isSome(latest) && (latest.value.stageRunStatus === null || APPROVED.has(latest.value.stageRunStatus)))

      // Gets a prerequisite done: nothing when its stages' work is all approved; otherwise it joins that owner's run
      // already going, or starts one (cancelled with the run that started it), and waits for it to finish.
      const fulfil = Effect.fn("RunManager.fulfil")(function*(need: Prerequisite) {
        const stages = yield* stagesUpTo(need.owner, need.through)
        const done = yield* Effect.forEach(stages, (stage) => isApproved(need.owner, stage))
        if (done.every(Boolean)) return
        const going = (yield* store.listRuns(need.owner)).find((r) => r.status === "running" || r.status === "waiting")
        const joined = going === undefined ? Option.none() : yield* FiberMap.get(fibers, going.id)
        let runId: RunId
        if (Option.isSome(joined)) {
          runId = going!.id
          yield* Fiber.await(joined.value)
        } else {
          const child = yield* store.createRun(need.owner, null)
          runId = child.id
          yield* publish(child.id, { _tag: "RunStarted", run: child })
          const fiber = yield* FiberMap.run(fibers, child.id, execute(child, need.through))
          yield* Fiber.await(fiber).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => cancelling.add(child.id)).pipe(Effect.andThen(FiberMap.remove(fibers, child.id)))
            )
          )
        }
        const finished = yield* store.getRun(runId)
        const ready = (yield* Effect.forEach(stages, (stage) => isApproved(need.owner, stage))).every(Boolean)
        if (!ready) {
          const why = Option.match(finished, { onNone: () => null, onSome: (r) => r.error })
          return yield* new StageFailure({ stage: "videos", code: "video-not-read", message: `${need.label} couldn't be read${why === null ? "" : `: ${why}`}` })
        }
      })

      const execute: (run: Run, through?: StageName | null) => Effect.Effect<void> = Effect.fn("RunManager.execute")(function*(run: Run, through: StageName | null = null) {
        const current = yield* Ref.make<StageRun | null>(null)
        const finish = Effect.fn("RunManager.finish")(function*(status: Run["status"], error: string | null) {
          const stageRun = yield* Ref.get(current)
          if (stageRun !== null && (stageRun.status === "running" || stageRun.status === "waiting")) {
            const latest = (yield* store.listStageRuns(run.id)).find((s) => s.id === stageRun.id)
            if (latest !== undefined && (latest.status === "running" || latest.status === "waiting")) {
              const closed = yield* store.updateStageRun(stageRun.id, status === "failed" ? "failed" : "cancelled", error)
              yield* publish(run.id, { _tag: "StageFinished", stageRun: closed })
            }
          }
          yield* store.cancelPendingRequests(run.id)
          const finished = yield* store.finishRun(run.id, status, error)
          yield* publish(run.id, { _tag: "RunFinished", run: finished })
        })

        yield* Effect.gen(function*() {
          const needs = registry.prerequisites === undefined ? [] : yield* registry.prerequisites(run.owner)
          yield* Effect.forEach(needs, fulfil, { concurrency: 2, discard: true })
          const stages = yield* stagesUpTo(run.owner, through)
          let forcedFrom = run.fromStage === null ? stages.length : Option.getOrElse(findStage(stages, run.fromStage), () => 0)
          const sessions = new Map<StageName, string>()
          const sentBack: { current: { readonly index: number; readonly note: string } | null } = { current: null }
          for (let i = 0; i < stages.length;) {
            const stage = stages[i]!
            const back: Option.Option<SentBack> = yield* runStage(run, stage, i >= forcedFrom, current, sessions, sentBack.current?.index === i ? sentBack.current : null)
            if (Option.isNone(back)) {
              i++
              continue
            }
            // a rejection sent back: that stage runs again with the note, and everything after it follows
            const target = findStage(stages, back.value.stage)
            if (Option.isNone(target) || target.value >= i) {
              return yield* new StageFailure({ stage: stage.name, code: "bad-reject-target", message: `can't go back to ${back.value.stage}` })
            }
            i = target.value
            forcedFrom = i
            sentBack.current = { index: i, note: back.value.note }
          }
          yield* finish("completed", null)
        }).pipe(
          Effect.catchTag("StageFailure", (failure) => finish("failed", `${failure.stage} (${failure.code}): ${failure.message}`)),
          Effect.catchDefect((defect) => finish("failed", `unexpected: ${String(defect)}`)),
          Effect.onInterrupt(() =>
            finish(cancelling.delete(run.id) ? "cancelled" : "interrupted", null)
          )
        )
      })

      const start = Effect.fn("RunManager.start")(function*(owner: RunOwner, from: StageName | null) {
        const stages = yield* registry.stagesFor(owner)
        if (from !== null && Option.isNone(findStage(stages, from))) {
          return yield* new StageFailure({ stage: from, code: "unknown-stage", message: `this run has no ${from} stage` })
        }
        const run = yield* store.createRun(owner, from)
        yield* publish(run.id, { _tag: "RunStarted", run })
        yield* FiberMap.run(fibers, run.id, execute(run))
        return run
      })

      const cancel = Effect.fn("RunManager.cancel")(function*(runId: RunId) {
        if (!(yield* FiberMap.has(fibers, runId))) return false
        cancelling.add(runId)
        yield* FiberMap.remove(fibers, runId)
        return true
      })

      const resume = Effect.fn("RunManager.resume")(function*(runId: RunId) {
        const run = yield* store.getRun(runId)
        if (Option.isNone(run)) return yield* new RunNotFound({ id: runId })
        return yield* start(run.value.owner, null)
      })

      const respond = Effect.fn("RunManager.respond")(function*(requestId: RequestId, response: GateResponse) {
        const answered = yield* store.answerRequest(requestId, response)
        if (Option.isNone(answered)) return yield* new RequestNotPending({ id: requestId })
        yield* publish(answered.value.runId, { _tag: "RequestAnswered", request: answered.value })
        const deferred = answers.get(requestId)
        if (deferred !== undefined) yield* Deferred.succeed(deferred, response)
        return answered.value
      })

      const subscribe = (runId: RunId, afterSeq: number) =>
        Stream.unwrap(Effect.gen(function*() {
          // Subscribe before reading the snapshot, so nothing published in between is lost.
          const live = yield* PubSub.subscribe(updates)
          const run = yield* store.getRun(runId)
          if (Option.isNone(run)) return yield* new RunNotFound({ id: runId })
          const stageRuns = yield* store.listStageRuns(runId)
          const pending = (yield* store.listPendingRequests).filter((r) => r.runId === runId)
          const lastSeq = yield* store.lastSeq(runId)
          const stored = yield* store.eventsAfter(runId, afterSeq)
          const snapshot: RunUpdate = { _tag: "Snapshot", run: run.value, stageRuns, pending, lastSeq }
          const history = Stream.fromIterable<RunUpdate>([
            snapshot,
            ...stored.map(({ seq, event }): RunUpdate => ({ _tag: "Event", seq, event }))
          ])
          const finished = run.value.status !== "running" && run.value.status !== "waiting"
          if (finished) return history
          const following = Stream.fromSubscription(live).pipe(
            Stream.filter((p) => p.runId === runId && (p.update._tag !== "Event" || p.update.seq > lastSeq)),
            Stream.map((p) => p.update),
            Stream.takeUntil((u) => u._tag === "Event" && u.event._tag === "RunFinished")
          )
          return Stream.concat(history, following)
        }))

      return RunManager.of({ start, cancel, resume, respond, subscribe })
    })
  )
}
