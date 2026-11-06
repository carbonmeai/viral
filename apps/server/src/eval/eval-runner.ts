import { RunId, SourceId, StageRunId } from "@viral/contracts"
import { Cause, Clock, Effect, Exit, Option } from "effect"
import { type AgentProviderName, AgentSession } from "../agent-session/agent-session.ts"
import type { StageContext } from "../runs/stages.ts"
import type { EvalStage, EvalStageName } from "./eval-stages.ts"

// A model to evaluate, as typed on the command line:
//   claude-cli         the stage's own model on your Claude CLI (the baseline)
//   claude-cli:opus    a CLI model alias or id
//   openai/gpt-6-luna  any AI Gateway model id
export interface EvalModel {
  readonly label: string
  readonly provider: AgentProviderName
  // null = the stage's own default (CLI only)
  readonly model: string | null
}

export const parseModel = (spec: string): EvalModel | null => {
  const trimmed = spec.trim()
  if (trimmed === "claude-cli") return { label: "claude-cli", provider: "claude-cli", model: null }
  if (trimmed.startsWith("claude-cli:")) return { label: trimmed, provider: "claude-cli", model: trimmed.slice("claude-cli:".length) || null }
  if (/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) return { label: trimmed, provider: "ai-gateway", model: trimmed }
  return null
}

export interface EvalRunResult {
  readonly stage: EvalStageName
  readonly model: string
  readonly provider: AgentProviderName
  readonly run: number
  // passed: the server's checks accepted it (after up to 2 fix rounds); failed: an error or still wrong; skipped:
  // the budget would have run out
  readonly status: "passed" | "failed" | "skipped"
  readonly error: string | null
  readonly costUsd: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly seconds: number
  // the model the provider reported (the CLI's real model id for an alias)
  readonly reportedModel: string | null
  readonly firstTryPass: boolean | null
  readonly firstTryProblems: ReadonlyArray<string>
  readonly fixRounds: number
  readonly result: unknown
}

// A cautious guess at one run's cost before any run of that stage and model has been seen, so the budget stops
// a run before it would overspend. After the first run, the most expensive one seen is used instead.
const ESTIMATE_USD: Record<EvalStageName, { readonly cli: number; readonly gateway: number }> = {
  ads: { cli: 0.15, gateway: 0.1 },
  story: { cli: 0.6, gateway: 0.25 },
  script: { cli: 0.45, gateway: 0.15 },
  metadata: { cli: 0.08, gateway: 0.03 }
}

export interface EvalInput {
  readonly stages: ReadonlyArray<EvalStage>
  readonly models: ReadonlyArray<EvalModel>
  readonly runs: number
  readonly budgetUsd: number
  readonly onResult: (result: EvalRunResult, spentUsd: number) => Effect.Effect<void>
  readonly onProgress?: (stage: EvalStageName, model: string, message: string) => Effect.Effect<void>
}

// Runs every stage on every model `runs` times, round by round (so a budget stop still leaves every model
// compared on the earlier rounds), with no gates and nothing saved to a library.
export const runEval = Effect.fn("runEval")(function*(input: EvalInput) {
  const agent = yield* AgentSession
  const results: Array<EvalRunResult> = []
  const worst = new Map<string, number>()
  let spent = 0

  for (let run = 1; run <= input.runs; run++) {
    for (const stage of input.stages) {
      for (const model of input.models) {
        const key = `${stage.name}|${model.label}`
        const estimate = worst.get(key) ?? ESTIMATE_USD[stage.name][model.provider === "claude-cli" ? "cli" : "gateway"]
        const base = { stage: stage.name, model: model.label, provider: model.provider, run }
        if (spent + estimate > input.budgetUsd) {
          const skipped: EvalRunResult = {
            ...base,
            status: "skipped",
            error: `would pass the $${input.budgetUsd.toFixed(2)} budget ($${spent.toFixed(2)} spent, about $${estimate.toFixed(2)} more)`,
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            seconds: 0,
            reportedModel: null,
            firstTryPass: null,
            firstTryProblems: [],
            fixRounds: 0,
            result: null
          }
          results.push(skipped)
          yield* input.onResult(skipped, spent)
          continue
        }

        const checks: Array<ReadonlyArray<string>> = []
        let costUsd = 0
        let inputTokens = 0
        let outputTokens = 0
        let reportedModel: string | null = null
        const ctx: StageContext = {
          owner: { _tag: "Source", id: SourceId.make("eval") },
          runId: RunId.make("eval"),
          stageRunId: StageRunId.make(`eval-${stage.name}-${run}`),
          attempt: 1,
          note: null,
          resumeSession: null,
          recordSession: () => Effect.void,
          progress: (_pct, message) => message === undefined || input.onProgress === undefined ? Effect.void : input.onProgress(stage.name, model.label, message),
          recordCost: (cost) =>
            Effect.sync(() => {
              costUsd += cost.costUsd ?? 0
              inputTokens += cost.inputTokens ?? 0
              outputTokens += cost.outputTokens ?? 0
              reportedModel = cost.model ?? reportedModel
            })
        }
        const route = { provider: model.provider, model: model.model ?? (model.provider === "claude-cli" ? stage.defaultModel : null) }

        const started = yield* Clock.currentTimeMillis
        const exit = yield* Effect.exit(stage.run(agent, ctx, route, (problems) => void checks.push(problems)))
        const seconds = ((yield* Clock.currentTimeMillis) - started) / 1000
        spent += costUsd
        worst.set(key, Math.max(worst.get(key) ?? 0, costUsd))

        const first = checks[0]
        const result: EvalRunResult = {
          ...base,
          status: Exit.isSuccess(exit) ? "passed" : "failed",
          error: Exit.isSuccess(exit)
            ? null
            : Option.match(Cause.findErrorOption(exit.cause), { onNone: () => Cause.pretty(exit.cause), onSome: (e) => `${e.code}: ${e.message}` }),
          costUsd,
          inputTokens,
          outputTokens,
          seconds,
          reportedModel,
          firstTryPass: first === undefined ? null : first.length === 0,
          firstTryProblems: first ?? [],
          fixRounds: Math.max(0, checks.length - 1),
          result: Exit.isSuccess(exit) ? exit.value : null
        }
        results.push(result)
        yield* input.onResult(result, spent)
      }
    }
  }
  return { results, spentUsd: spent }
})
