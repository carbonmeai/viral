import {
  type ArtifactKind,
  GatePayload,
  GateResponse,
  ProjectId,
  type RequestId,
  RequestId as RequestIdSchema,
  type Run,
  RunEvent,
  RunId,
  type RunOwner,
  type RunRequest,
  type RunStatus,
  RunStatus as RunStatusSchema,
  SourceId,
  SourceSetId,
  type StageName,
  StageName as StageNameSchema,
  type StageRun,
  StageRunId,
  type StageRunStatus,
  StageRunStatus as StageRunStatusSchema,
  RequestStatus
} from "@viral/contracts"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"

const Json = Schema.fromJsonString(Schema.Unknown)
const PayloadJson = Schema.fromJsonString(GatePayload)
const ResponseJson = Schema.fromJsonString(GateResponse)
const EventJson = Schema.fromJsonString(RunEvent)
const Iso = Schema.DateTimeUtcFromString

const RunRow = Schema.Struct({
  id: RunId,
  source_id: Schema.NullOr(SourceId),
  set_id: Schema.NullOr(SourceSetId),
  project_id: Schema.NullOr(ProjectId),
  status: RunStatusSchema,
  from_stage: Schema.NullOr(StageNameSchema),
  error: Schema.NullOr(Schema.String),
  started_at: Iso,
  finished_at: Schema.NullOr(Iso)
})
const toRun = (row: typeof RunRow.Type): Run => ({
  id: row.id,
  // the one-owner CHECK guarantees exactly one id is set
  owner: row.source_id !== null
    ? { _tag: "Source", id: row.source_id }
    : row.set_id !== null
    ? { _tag: "Set", id: row.set_id }
    : { _tag: "Project", id: row.project_id! },
  status: row.status,
  fromStage: row.from_stage,
  error: row.error,
  startedAt: row.started_at,
  finishedAt: row.finished_at
})

const StageRunRow = Schema.Struct({
  id: StageRunId,
  run_id: RunId,
  stage: StageNameSchema,
  attempt: Schema.Int,
  status: StageRunStatusSchema,
  model: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  billing: Schema.NullOr(Schema.Literals(["billed", "subscription"])),
  error: Schema.NullOr(Schema.String),
  input_tokens: Schema.NullOr(Schema.Int),
  output_tokens: Schema.NullOr(Schema.Int),
  cost_usd: Schema.NullOr(Schema.Finite),
  cost_basis: Schema.NullOr(Schema.Literals(["reported", "estimate", "unknown"])),
  tts_characters: Schema.NullOr(Schema.Int),
  duration_ms: Schema.NullOr(Schema.Int),
  started_at: Iso,
  finished_at: Schema.NullOr(Iso)
})
const toStageRun = (row: typeof StageRunRow.Type): StageRun => ({
  id: row.id,
  runId: row.run_id,
  stage: row.stage,
  attempt: row.attempt,
  status: row.status,
  model: row.model,
  provider: row.provider,
  billing: row.billing,
  error: row.error,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  costUsd: row.cost_usd,
  costBasis: row.cost_basis,
  ttsCharacters: row.tts_characters,
  durationMs: row.duration_ms,
  startedAt: row.started_at,
  finishedAt: row.finished_at
})

// requests joined with their stage run, so a request knows which stage it gates
const RequestRow = Schema.Struct({
  id: RequestIdSchema,
  run_id: RunId,
  stage_run_id: StageRunId,
  stage: StageNameSchema,
  kind: Schema.Literals(["approval", "input"]),
  title: Schema.String,
  payload: Schema.NullOr(PayloadJson),
  status: RequestStatus,
  response: Schema.NullOr(ResponseJson),
  created_at: Iso,
  answered_at: Schema.NullOr(Iso)
})
const toRequest = (row: typeof RequestRow.Type): RunRequest => ({
  id: row.id,
  runId: row.run_id,
  stageRunId: row.stage_run_id,
  stage: row.stage,
  kind: row.kind,
  title: row.title,
  payload: row.payload,
  status: row.status,
  response: row.response,
  createdAt: row.created_at,
  answeredAt: row.answered_at
})

// What the latest artifact of a kind is, and whether the stage run that made it was approved.
export interface LatestArtifact {
  readonly version: number
  // null for artifacts made outside a run (always treated as approved)
  readonly stageRunStatus: StageRunStatus | null
}

export interface StageCost {
  readonly model?: string | null
  // who ran it, and whether the cost is real money or a CLI plan's value
  readonly provider?: string | null
  readonly billing?: "billed" | "subscription" | null
  readonly inputTokens?: number | null
  readonly outputTokens?: number | null
  // null = no known price (the tokens still count); never recorded as $0
  readonly costUsd?: number | null
  // reported by the service, estimated from tokens at Viral's prices, or unknown (no price)
  readonly costBasis?: "reported" | "estimate" | "unknown" | null
  readonly ttsCharacters?: number | null
}

const ownerColumns = (owner: RunOwner) => ({
  sourceId: owner._tag === "Source" ? owner.id : null,
  setId: owner._tag === "Set" ? owner.id : null,
  projectId: owner._tag === "Project" ? owner.id : null
})

// The runs and artifacts column that holds an owner's id.
const ownerColumn = (owner: RunOwner) => owner._tag === "Source" ? "source_id" : owner._tag === "Set" ? "set_id" : "project_id"

// Persistence for runs: the runs, stage_runs, requests and run_events tables. All SQL errors are defects:
// the schema is ours and a failing write is a bug, not something a caller can handle.
export class RunStore extends Context.Service<RunStore, {
  createRun(owner: RunOwner, fromStage: StageName | null): Effect.Effect<Run>
  getRun(id: RunId): Effect.Effect<Option.Option<Run>>
  listRuns(owner: RunOwner): Effect.Effect<ReadonlyArray<Run>>
  finishRun(id: RunId, status: RunStatus, error: string | null): Effect.Effect<Run>
  setRunStatus(id: RunId, status: RunStatus): Effect.Effect<void>
  // runs left running or waiting by a previous server process become interrupted
  interruptAbandonedRuns: Effect.Effect<number>
  createStageRun(runId: RunId, stage: StageName, attempt: number, status: StageRunStatus): Effect.Effect<StageRun>
  updateStageRun(id: StageRunId, status: StageRunStatus, error: string | null): Effect.Effect<StageRun>
  recordCost(id: StageRunId, cost: StageCost): Effect.Effect<void>
  recordSession(id: StageRunId, sessionId: string): Effect.Effect<void>
  // the agent's own words for that attempt (its tell_creator call)
  recordReply(id: StageRunId, reply: string): Effect.Effect<void>
  replyOf(id: StageRunId): Effect.Effect<string | null>
  // the agent session of an owner's latest attempt at a stage, so a redo with your note continues that conversation
  latestSession(owner: RunOwner, stage: StageName): Effect.Effect<string | null>
  getStageRun(id: StageRunId): Effect.Effect<Option.Option<StageRun>>
  listStageRuns(runId: RunId): Effect.Effect<ReadonlyArray<StageRun>>
  latestArtifact(owner: RunOwner, kind: ArtifactKind): Effect.Effect<Option.Option<LatestArtifact>>
  // Points the latest artifact of a kind at a stage run, e.g. when a resumed run approves an artifact an
  // interrupted run made.
  linkLatestArtifact(owner: RunOwner, kind: ArtifactKind, stageRunId: StageRunId): Effect.Effect<void>
  createRequest(stageRun: StageRun, title: string, payload: GatePayload | null): Effect.Effect<RunRequest>
  answerRequest(id: RequestId, response: GateResponse): Effect.Effect<Option.Option<RunRequest>>
  cancelPendingRequests(runId: RunId | null): Effect.Effect<void>
  getRequest(id: RequestId): Effect.Effect<Option.Option<RunRequest>>
  listPendingRequests: Effect.Effect<ReadonlyArray<RunRequest>>
  // every request of a run, oldest first
  listRequests(runId: RunId): Effect.Effect<ReadonlyArray<RunRequest>>
  appendEvent(runId: RunId, event: RunEvent): Effect.Effect<number>
  eventsAfter(runId: RunId, seq: number): Effect.Effect<ReadonlyArray<{ readonly seq: number; readonly event: RunEvent }>>
  lastSeq(runId: RunId): Effect.Effect<number>
}>()("@viral/server/runs/run-store/RunStore") {
  static readonly layer = Layer.effect(
    RunStore,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const random = yield* SecureRandom.SecureRandom
      const now = Effect.map(DateTime.now, DateTime.formatIso)

      const runById = SqlSchema.findOneOption({
        Request: RunId,
        Result: RunRow,
        execute: (id) => sql`SELECT * FROM runs WHERE id = ${id}`
      })
      const stageRunById = SqlSchema.findOne({
        Request: StageRunId,
        Result: StageRunRow,
        execute: (id) => sql`SELECT * FROM stage_runs WHERE id = ${id}`
      })
      const requestById = SqlSchema.findOneOption({
        Request: RequestIdSchema,
        Result: RequestRow,
        execute: (id) =>
          sql`SELECT r.*, s.stage FROM requests r JOIN stage_runs s ON s.id = r.stage_run_id WHERE r.id = ${id}`
      })

      const getRun = (id: RunId) => runById(id).pipe(Effect.map(Option.map(toRun)), Effect.orDie)
      const mustGetRun = (id: RunId) => getRun(id).pipe(Effect.map(Option.getOrThrow))

      const createRun = Effect.fn("RunStore.createRun")(function*(owner: RunOwner, fromStage: StageName | null) {
        const id = RunId.make(yield* random.uuidV7())
        const { sourceId, setId, projectId } = ownerColumns(owner)
        yield* sql`
          INSERT INTO runs (id, source_id, set_id, project_id, status, from_stage, started_at)
          VALUES (${id}, ${sourceId}, ${setId}, ${projectId}, 'running', ${fromStage}, ${yield* now})
        `
        return yield* mustGetRun(id)
      }, Effect.orDie)

      const listRuns = Effect.fn("RunStore.listRuns")(function*(owner: RunOwner) {
        const column = ownerColumn(owner)
        const rows = yield* SqlSchema.findAll({
          Request: Schema.String,
          Result: RunRow,
          execute: (id) => sql`SELECT * FROM runs WHERE ${sql(column)} = ${id} ORDER BY started_at DESC`
        })(owner.id)
        return rows.map(toRun)
      }, Effect.orDie)

      const finishRun = Effect.fn("RunStore.finishRun")(function*(id: RunId, status: RunStatus, error: string | null) {
        yield* sql`UPDATE runs SET status = ${status}, error = ${error}, finished_at = ${yield* now} WHERE id = ${id}`
        return yield* mustGetRun(id)
      }, Effect.orDie)

      const setRunStatus = (id: RunId, status: RunStatus) =>
        sql`UPDATE runs SET status = ${status} WHERE id = ${id}`.pipe(Effect.asVoid, Effect.orDie)

      const interruptAbandonedRuns = Effect.gen(function*() {
        const at = yield* now
        const rows = yield* sql`
          UPDATE runs SET status = 'interrupted', finished_at = ${at}
          WHERE status IN ('running', 'waiting') RETURNING id
        `
        yield* sql`
          UPDATE stage_runs SET status = 'cancelled', finished_at = ${at}
          WHERE status IN ('running', 'waiting') AND run_id IN (SELECT id FROM runs WHERE status = 'interrupted')
        `
        return rows.length
      }).pipe(Effect.orDie)

      const createStageRun = Effect.fn("RunStore.createStageRun")(
        function*(runId: RunId, stage: StageName, attempt: number, status: StageRunStatus) {
          const id = StageRunId.make(yield* random.uuidV7())
          const at = yield* now
          const finished = status === "reused" || status === "skipped" ? at : null
          yield* sql`
            INSERT INTO stage_runs (id, run_id, stage, attempt, status, started_at, finished_at)
            VALUES (${id}, ${runId}, ${stage}, ${attempt}, ${status}, ${at}, ${finished})
          `
          return toStageRun(yield* stageRunById(id))
        },
        Effect.orDie
      )

      const updateStageRun = Effect.fn("RunStore.updateStageRun")(
        function*(id: StageRunId, status: StageRunStatus, error: string | null) {
          const done = status !== "running" && status !== "waiting"
          // the time the stage worked: up to its gate when it has one (the first time it waits), so the time
          // spent reviewing it isn't counted
          const timed = done || status === "waiting"
          const at = yield* now
          yield* sql`
            UPDATE stage_runs
            SET status = ${status}, error = ${error}, finished_at = ${done ? at : null},
                duration_ms = CASE WHEN ${timed ? 1 : 0} = 1
                  THEN coalesce(duration_ms, CAST((julianday(${at}) - julianday(started_at)) * 86400000 AS INTEGER))
                  ELSE duration_ms END
            WHERE id = ${id}
          `
          return toStageRun(yield* stageRunById(id))
        },
        Effect.orDie
      )

      const recordCost = (id: StageRunId, cost: StageCost) =>
        sql`
          UPDATE stage_runs SET
            model = coalesce(${cost.model ?? null}, model),
            provider = coalesce(${cost.provider ?? null}, provider),
            billing = coalesce(${cost.billing ?? null}, billing),
            input_tokens = coalesce(input_tokens, 0) + coalesce(${cost.inputTokens ?? null}, 0),
            output_tokens = coalesce(output_tokens, 0) + coalesce(${cost.outputTokens ?? null}, 0),
            cost_usd = CASE WHEN ${cost.costUsd ?? null} IS NULL THEN cost_usd ELSE coalesce(cost_usd, 0) + ${cost.costUsd ?? null} END,
            -- several calls in one stage run (fix rounds): unknown beats estimate beats reported
            cost_basis = CASE
              WHEN ${cost.costBasis ?? null} IS NULL THEN cost_basis
              WHEN cost_basis = 'unknown' OR ${cost.costBasis ?? null} = 'unknown' THEN 'unknown'
              WHEN cost_basis = 'estimate' OR ${cost.costBasis ?? null} = 'estimate' THEN 'estimate'
              ELSE 'reported'
            END,
            tts_characters = coalesce(tts_characters, 0) + coalesce(${cost.ttsCharacters ?? null}, 0)
          WHERE id = ${id}
        `.pipe(Effect.asVoid, Effect.orDie)

      const recordSession = (id: StageRunId, sessionId: string) =>
        sql`UPDATE stage_runs SET agent_session_id = ${sessionId} WHERE id = ${id}`.pipe(Effect.asVoid, Effect.orDie)

      const recordReply = (id: StageRunId, reply: string) =>
        sql`UPDATE stage_runs SET reply = ${reply} WHERE id = ${id}`.pipe(Effect.asVoid, Effect.orDie)

      const replyOf = (id: StageRunId) =>
        sql<{ readonly reply: string | null }>`SELECT reply FROM stage_runs WHERE id = ${id}`.pipe(
          Effect.map((rows) => rows[0]?.reply ?? null),
          Effect.orDie
        )

      const latestSession = (owner: RunOwner, stage: StageName) =>
        sql<{ readonly agent_session_id: string }>`
          SELECT s.agent_session_id FROM stage_runs s JOIN runs r ON r.id = s.run_id
          WHERE r.${sql(ownerColumn(owner))} = ${owner.id} AND s.stage = ${stage} AND s.agent_session_id IS NOT NULL
          ORDER BY s.started_at DESC LIMIT 1
        `.pipe(Effect.map((rows) => rows[0]?.agent_session_id ?? null), Effect.orDie)

      const getStageRun = (id: StageRunId) =>
        SqlSchema.findOneOption({
          Request: StageRunId,
          Result: StageRunRow,
          execute: (req) => sql`SELECT * FROM stage_runs WHERE id = ${req}`
        })(id).pipe(Effect.map(Option.map(toStageRun)), Effect.orDie)

      const listStageRuns = (runId: RunId) =>
        SqlSchema.findAll({
          Request: RunId,
          Result: StageRunRow,
          execute: (id) => sql`SELECT * FROM stage_runs WHERE run_id = ${id} ORDER BY started_at, attempt`
        })(runId).pipe(Effect.map((rows) => rows.map(toStageRun)), Effect.orDie)

      const latestArtifact = (owner: RunOwner, kind: ArtifactKind) => {
        const column = ownerColumn(owner)
        return SqlSchema.findOneOption({
          Request: Schema.String,
          Result: Schema.Struct({ version: Schema.Int, stage_run_status: Schema.NullOr(StageRunStatusSchema) }),
          execute: (id) => sql`
            SELECT a.version, s.status AS stage_run_status
            FROM artifacts a LEFT JOIN stage_runs s ON s.id = a.stage_run_id
            WHERE a.${sql(column)} = ${id} AND a.kind = ${kind}
            ORDER BY a.version DESC LIMIT 1
          `
        })(owner.id).pipe(
          Effect.map(Option.map((row) => ({ version: row.version, stageRunStatus: row.stage_run_status }))),
          Effect.orDie
        )
      }

      const linkLatestArtifact = (owner: RunOwner, kind: ArtifactKind, stageRunId: StageRunId) => {
        const column = ownerColumn(owner)
        return sql`
          UPDATE artifacts SET stage_run_id = ${stageRunId}
          WHERE id = (SELECT id FROM artifacts WHERE ${sql(column)} = ${owner.id} AND kind = ${kind} ORDER BY version DESC LIMIT 1)
        `.pipe(Effect.asVoid, Effect.orDie)
      }

      const createRequest = Effect.fn("RunStore.createRequest")(
        function*(stageRun: StageRun, title: string, payload: GatePayload | null) {
          const id = RequestIdSchema.make(yield* random.uuidV7())
          const encoded = payload === null ? null : yield* Schema.encodeEffect(PayloadJson)(payload)
          yield* sql`
            INSERT INTO requests (id, run_id, stage_run_id, kind, title, payload, status, created_at)
            VALUES (${id}, ${stageRun.runId}, ${stageRun.id}, 'approval', ${title}, ${encoded}, 'pending', ${yield* now})
          `
          return toRequest(Option.getOrThrow(yield* requestById(id)))
        },
        Effect.orDie
      )

      const answerRequest = Effect.fn("RunStore.answerRequest")(function*(id: RequestId, response: GateResponse) {
        const encoded = yield* Schema.encodeEffect(ResponseJson)(response)
        const updated = yield* sql`
          UPDATE requests SET status = 'answered', response = ${encoded}, answered_at = ${yield* now}
          WHERE id = ${id} AND status = 'pending' RETURNING id
        `
        if (updated.length === 0) return Option.none<RunRequest>()
        return Option.map(yield* requestById(id), toRequest)
      }, Effect.orDie)

      const cancelPendingRequests = (runId: RunId | null) =>
        (runId === null
          ? sql`UPDATE requests SET status = 'cancelled' WHERE status = 'pending'`
          : sql`UPDATE requests SET status = 'cancelled' WHERE status = 'pending' AND run_id = ${runId}`).pipe(
            Effect.asVoid,
            Effect.orDie
          )

      const getRequest = (id: RequestId) => requestById(id).pipe(Effect.map(Option.map(toRequest)), Effect.orDie)

      const listPendingRequests = SqlSchema.findAll({
        Request: Schema.Void,
        Result: RequestRow,
        execute: () => sql`
          SELECT r.*, s.stage FROM requests r JOIN stage_runs s ON s.id = r.stage_run_id
          WHERE r.status = 'pending' ORDER BY r.created_at
        `
      })().pipe(Effect.map((rows) => rows.map(toRequest)), Effect.orDie)

      const listRequests = (runId: RunId) =>
        SqlSchema.findAll({
          Request: RunId,
          Result: RequestRow,
          execute: (id) => sql`
            SELECT r.*, s.stage FROM requests r JOIN stage_runs s ON s.id = r.stage_run_id
            WHERE r.run_id = ${id} ORDER BY r.created_at
          `
        })(runId).pipe(Effect.map((rows) => rows.map(toRequest)), Effect.orDie)

      const appendEvent = Effect.fn("RunStore.appendEvent")(function*(runId: RunId, event: RunEvent) {
        const encoded = yield* Schema.encodeEffect(EventJson)(event)
        const [row] = yield* sql<{ readonly seq: number }>`
          INSERT INTO run_events (run_id, event, created_at) VALUES (${runId}, ${encoded}, ${yield* now}) RETURNING seq
        `
        return row!.seq
      }, Effect.orDie)

      const eventsAfter = (runId: RunId, seq: number) =>
        SqlSchema.findAll({
          Request: Schema.Struct({ runId: RunId, seq: Schema.Int }),
          Result: Schema.Struct({ seq: Schema.Int, event: EventJson }),
          execute: (req) => sql`SELECT seq, event FROM run_events WHERE run_id = ${req.runId} AND seq > ${req.seq} ORDER BY seq`
        })({ runId, seq }).pipe(Effect.orDie)

      const lastSeq = (runId: RunId) =>
        SqlSchema.findOne({
          Request: RunId,
          Result: Schema.Struct({ seq: Schema.Int }),
          execute: (id) => sql`SELECT coalesce(max(seq), 0) AS seq FROM run_events WHERE run_id = ${id}`
        })(runId).pipe(Effect.map((row) => row.seq), Effect.orDie)

      return RunStore.of({
        createRun,
        getRun,
        listRuns,
        finishRun,
        setRunStatus,
        interruptAbandonedRuns,
        createStageRun,
        updateStageRun,
        recordCost,
        recordSession,
        recordReply,
        replyOf,
        latestSession,
        getStageRun,
        listStageRuns,
        latestArtifact,
        linkLatestArtifact,
        createRequest,
        answerRequest,
        cancelPendingRequests,
        getRequest,
        listPendingRequests,
        listRequests,
        appendEvent,
        eventsAfter,
        lastSeq
      })
    })
  ).pipe(Layer.provide([DatabaseLive, SecureRandom.layerWebCrypto]))
}
