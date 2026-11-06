import { RunId, SourceId, StageRunId } from "@viral/contracts"
import { Cause, Clock, Effect, Exit, Option } from "effect"
import { type AgentProviderName, AgentSession } from "../agent-session/agent-session.ts"
import type { StageContext } from "../runs/stages.ts"
import type { EvalStage, EvalStageName } from "./eval-stages.ts"

// A model to evaluate, as typed on the command line (provider:model):
//   claude-cli                   the stage's own model on your Claude CLI (the baseline)
//   claude-cli:opus              a CLI model alias or id
//   codex | codex:gpt-6-astra    Codex's default model, or one from its catalog
//   opencode:anthropic/claude-haiku-5.5   an OpenCode provider/model
//   gateway:openai/gpt-6-luna    an AI Gateway model id (or the bare id, openai/gpt-6-luna)
export interface EvalModel {
  readonly label: string
  readonly provider: AgentProviderName
  // null = the stage's own default (Claude CLI) or the CLI's default (Codex)
  readonly model: string | null
}

const GATEWAY_ID = /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/

export const parseModel = (spec: string): EvalModel | null => {
  const trimmed = spec.trim()
  const colon = trimmed.indexOf(":")
  const [provider, model] = colon === -1 ? [trimmed, ""] : [trimmed.slice(0, colon), trimmed.slice(colon + 1)]
  switch (provider) {
    case "claude-cli":
    case "codex":
      return { label: model === "" ? provider : trimmed, provider, model: model === "" ? null : model }
    case "opencode":
      return model.includes("/") ? { label: trimmed, provider: "opencode", model } : null
    case "gateway":
      return GATEWAY_ID.test(model) ? { label: model, provider: "ai-gateway", model } : null
  }
  return colon === -1 && GATEWAY_ID.test(trimmed) ? { label: trimmed, provider: "ai-gateway", model: trimmed } : null
}

export interface EvalRunResult {
  readonly stage: EvalStageName
  readonly model: string
  readonly provider: AgentProviderName
  // billed: real money (the gateway, OpenCode, a CLI on an API key); subscription: on a plan (Codex on ChatGPT, the
  // Claude CLI signed in), where the cost is the plan's value or nothing
  readonly billing: "billed" | "subscription"
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

// A cautious guess at one priced run's cost before any run of that stage and model has been seen, so the budget
// stops a run before it would overspend. After the first run, the most expensive one seen is used instead.
const ESTIMATE_USD: Record<EvalStageName, { readonly cli: number; readonly api: number }> = {
  ads: { cli: 0.15, api: 0.1 },
  story: { cli: 0.6, api: 0.25 },
  script: { cli: 0.45, api: 0.15 },
  metadata: { cli: 0.08, api: 0.03 }
}

export interface EvalInput {
  readonly stages: ReadonlyArray<EvalStage>
  readonly models: ReadonlyArray<EvalModel>
  readonly runs: number
  // the cap on priced runs (billed); runs on a plan don't count toward it
  readonly budgetUsd: number
  // how each provider is paid for
  readonly billing: (provider: AgentProviderName) => "billed" | "subscription"
  // the most runs on a plan per provider (they use up its limits, not dollars)
  readonly maxSubscriptionRuns: number
  readonly onResult: (result: EvalRunResult, spentUsd: number) => Effect.Effect<void>
  readonly onProgress?: (stage: EvalStageName, model: string, message: string) => Effect.Effect<void>
}

// Runs every stage on every model `runs` times, round by round (so a budget stop still leaves every model
// compared on the earlier rounds), with no gates and nothing saved to a library. Priced runs stop at the dollar
// budget; runs on a plan stop at `maxSubscriptionRuns` per provider.
export const runEval = Effect.fn("runEval")(function*(input: EvalInput) {
  const agent = yield* AgentSession
  const results: Array<EvalRunResult> = []
  const worst = new Map<string, number>()
  const planRuns = new Map<AgentProviderName, number>()
  let spent = 0

  for (let run = 1; run <= input.runs; run++) {
    for (const stage of input.stages) {
      for (const model of input.models) {
        const key = `${stage.name}|${model.label}`
        const billing = input.billing(model.provider)
        const estimate = worst.get(key) ?? ESTIMATE_USD[stage.name][model.provider === "claude-cli" ? "cli" : "api"]
        const base = { stage: stage.name, model: model.label, provider: model.provider, billing, run }
        const used = planRuns.get(model.provider) ?? 0
        const over = billing === "subscription"
          ? used >= input.maxSubscriptionRuns
            ? `would pass the ${input.maxSubscriptionRuns} runs allowed on the ${model.provider} plan`
            : null
          : spent + estimate > input.budgetUsd
          ? `would pass the $${input.budgetUsd.toFixed(2)} budget ($${spent.toFixed(2)} spent, about $${estimate.toFixed(2)} more)`
          : null
        if (over !== null) {
          const skipped: EvalRunResult = {
            ...base,
            status: "skipped",
            error: over,
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
        if (billing === "subscription") planRuns.set(model.provider, used + 1)
        else spent += costUsd
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
