import type { AgentProvider, ModelEval } from "@viral/contracts"
import { Context, Effect, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import type { EvalRunResult } from "./eval-runner.ts"

// Which runs count as real money: the gateway always, the Claude CLI only with an API key (otherwise its reported
// cost is a plan's value).
export const evalBilling = (provider: AgentProvider, cliBilled: boolean) =>
  provider === "ai-gateway" || cliBilled ? "billed" as const : "subscription" as const

const SummaryRow = Schema.Struct({
  model: Schema.String,
  provider: Schema.Literals(["claude-cli", "ai-gateway"]),
  runs: Schema.Int,
  passed: Schema.Int,
  first_try_passed: Schema.Int,
  avg_cost_usd: Schema.Number,
  stages: Schema.String,
  last_run_at: Schema.String
})

// Every eval run's result and spend, in your library's database (eval_runs), so Settings › Usage counts evals
// and Settings › Agents shows how each model did. Recording the same run again replaces it.
export class EvalRecords extends Context.Service<EvalRecords, {
  record(evalId: string, result: EvalRunResult, billing: "billed" | "subscription", createdAt: string): Effect.Effect<void>
  readonly byModel: Effect.Effect<ReadonlyArray<ModelEval>>
}>()("@viral/server/eval/eval-records/EvalRecords") {
  static readonly layer = Layer.effect(
    EvalRecords,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const random = yield* SecureRandom.SecureRandom

      const record = Effect.fn("EvalRecords.record")(
        function*(evalId: string, r: EvalRunResult, billing: "billed" | "subscription", createdAt: string) {
          const id = yield* random.uuidV7()
          yield* sql`
            INSERT INTO eval_runs (id, eval_id, stage, provider, model, reported_model, run, status, first_try_pass, fix_rounds,
                                   input_tokens, output_tokens, cost_usd, billing, duration_ms, created_at)
            VALUES (${id}, ${evalId}, ${r.stage}, ${r.provider}, ${r.model}, ${r.reportedModel}, ${r.run}, ${r.status},
                    ${r.firstTryPass === null ? null : r.firstTryPass ? 1 : 0}, ${r.fixRounds}, ${r.inputTokens}, ${r.outputTokens},
                    ${r.costUsd}, ${billing}, ${Math.round(r.seconds * 1000)}, ${createdAt})
            ON CONFLICT (eval_id, stage, model, run) DO UPDATE SET
              provider = excluded.provider, reported_model = excluded.reported_model, status = excluded.status,
              first_try_pass = excluded.first_try_pass, fix_rounds = excluded.fix_rounds, input_tokens = excluded.input_tokens,
              output_tokens = excluded.output_tokens, cost_usd = excluded.cost_usd, billing = excluded.billing,
              duration_ms = excluded.duration_ms, created_at = excluded.created_at
          `
        },
        Effect.orDie
      )

      const summary = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SummaryRow,
        execute: () => sql`
          SELECT model, provider, count(*) AS runs,
                 sum(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed,
                 sum(CASE WHEN first_try_pass = 1 THEN 1 ELSE 0 END) AS first_try_passed,
                 avg(cost_usd) AS avg_cost_usd,
                 group_concat(DISTINCT stage) AS stages,
                 max(created_at) AS last_run_at
          FROM eval_runs WHERE status <> 'skipped'
          GROUP BY model, provider ORDER BY avg_cost_usd
        `
      })

      const byModel = summary().pipe(
        Effect.map((rows) =>
          rows.map((r): ModelEval => ({
            model: r.model,
            provider: r.provider,
            runs: r.runs,
            passed: r.passed,
            firstTryPassed: r.first_try_passed,
            avgCostUsd: Math.round(r.avg_cost_usd * 1e6) / 1e6,
            stages: r.stages.split(",").sort(),
            lastRunAt: r.last_run_at
          }))
        ),
        Effect.orDie,
        Effect.withSpan("EvalRecords.byModel")
      )

      return EvalRecords.of({ record, byModel })
    })
  ).pipe(Layer.provide(SecureRandom.layerWebCrypto))
}

