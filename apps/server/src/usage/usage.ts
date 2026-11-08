import type { Usage } from "@viral/contracts"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"
import { dayKey, summarizeUsage } from "./usage-summary.ts"

const Row = Schema.Struct({
  stage: Schema.String,
  status: Schema.String,
  model: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  billing: Schema.NullOr(Schema.Literals(["billed", "subscription"])),
  cost_usd: Schema.NullOr(Schema.Number),
  tts_characters: Schema.NullOr(Schema.Number),
  input_tokens: Schema.NullOr(Schema.Number),
  output_tokens: Schema.NullOr(Schema.Number),
  started_at: Schema.String,
  project_id: Schema.NullOr(Schema.String),
  project_title: Schema.NullOr(Schema.String)
})

const EvalRow = Schema.Struct({
  model: Schema.String,
  provider: Schema.String,
  billing: Schema.NullOr(Schema.Literals(["billed", "subscription"])),
  cost_usd: Schema.Number,
  created_at: Schema.String
})

const PreviewRow = Schema.Struct({
  model: Schema.String,
  characters: Schema.Number,
  created_at: Schema.String
})

const DAY_MS = 86_400_000

// What agents and voices cost over the last few days, from the stage runs' recorded costs, eval runs and voice
// previews.
export class UsageReport extends Context.Service<UsageReport, {
  get(days: number): Effect.Effect<Usage>
}>()("@viral/server/usage/usage/UsageReport") {
  static readonly layer = Layer.effect(
    UsageReport,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const since = SqlSchema.findAll({
        Request: Schema.String,
        Result: Row,
        execute: (from) => sql`
          SELECT s.stage, s.status, s.model, s.provider, s.billing, s.cost_usd, s.tts_characters, s.input_tokens, s.output_tokens,
                 s.started_at, r.project_id, p.title AS project_title
          FROM stage_runs s JOIN runs r ON r.id = s.run_id LEFT JOIN projects p ON p.id = r.project_id
          WHERE s.started_at >= ${from}
        `
      })

      const evalsSince = SqlSchema.findAll({
        Request: Schema.String,
        Result: EvalRow,
        execute: (from) => sql`
          SELECT model, provider, billing, cost_usd, created_at FROM eval_runs
          WHERE created_at >= ${from} AND status <> 'skipped'
        `
      })

      const previewsSince = SqlSchema.findAll({
        Request: Schema.String,
        Result: PreviewRow,
        execute: (from) => sql`SELECT model, characters, created_at FROM voice_previews WHERE created_at >= ${from}`
      })

      const get = Effect.fn("UsageReport.get")(function*(days: number) {
        const period = Math.min(366, Math.max(1, Math.round(days)))
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const today = dayKey(now)
        const from = DateTime.formatIso(DateTime.makeUnsafe(Date.parse(`${today}T00:00:00Z`) - (period - 1) * DAY_MS))
        const rows = yield* since(from).pipe(Effect.orDie)
        const evalRows = yield* evalsSince(from).pipe(Effect.orDie)
        const previewRows = yield* previewsSince(from).pipe(Effect.orDie)
        return summarizeUsage(rows.map((r) => ({
          stage: r.stage,
          status: r.status,
          model: r.model,
          provider: r.provider,
          billing: r.billing,
          costUsd: r.cost_usd,
          ttsCharacters: r.tts_characters,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          startedAt: r.started_at,
          projectId: r.project_id,
          projectTitle: r.project_title
        })), period, today, evalRows.map((r) => ({
          model: r.model,
          provider: r.provider,
          billing: r.billing,
          costUsd: r.cost_usd,
          createdAt: r.created_at
        })), previewRows.map((r) => ({ model: r.model, characters: r.characters, createdAt: r.created_at })))
      })

      return UsageReport.of({ get })
    })
  ).pipe(Layer.provide(DatabaseLive))
}
