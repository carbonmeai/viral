import { NodeServices } from "@effect/platform-node"
import { AgentStage, KEY_PROVIDERS, type KeyProvider, priceOf, PROVIDER_KEY, resolveAgentRoute, tokenCostUsd } from "@viral/contracts"
import { Config, Context, Effect, Layer, Option, Path, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SkillPack } from "../agent-skills/skill-pack.ts"
import { CLI_OF, type CliProvider, CliSetups } from "../cli-setup/cli-setup.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Secrets } from "../secrets/secrets.ts"
import { AppSettingsStore } from "../settings/app-settings.ts"
import { Settings } from "../settings/settings.ts"
import { makeAiSdkProvider } from "@viral/provider-ai-sdk"
import { makeClaudeCliProvider } from "@viral/provider-claude-cli"
import { makeCodexProvider } from "@viral/provider-codex"
import { makeOpencodeProvider } from "@viral/provider-opencode"
import { replayRun } from "@viral/provider-testing"
import type { LanguageModel } from "ai"
import type { AgentCost, AgentError, AgentHooks, AgentRoute, AgentRun, AgentTask } from "./agent-task.ts"
import { modelImageReader } from "./model-images.ts"
import { MODEL_KEY_CHECKS } from "./model-key-checks.ts"

export {
  AgentError,
  type AgentHooks,
  AgentProviderName,
  type AgentRoute,
  type AgentTask,
  type AgentTool,
  agentTool,
  type ToolAnswer,
  toolAnswer,
  toolJsonSchema,
  toolShape
} from "./agent-task.ts"

export interface AgentSessionOptions {
  // a key provider's language model behind an id; tests pass a mock
  readonly keyModel?: (provider: KeyProvider, modelId: string, apiKey: string) => LanguageModel
  // a CLI provider in place of the real one; tests pass a stand-in that records what a run was given
  readonly cliRuns?: Partial<Record<CliProvider, AgentRun>>
}

const isCliProvider = (provider: AgentRoute["provider"]): provider is CliProvider => provider in CLI_OF

// Codex reports tokens, never dollars. On your OpenAI key that's real money, priced from Viral's table (an estimate;
// a model without a price keeps its tokens and an unknown cost).
const priced = (provider: AgentRoute["provider"], billing: "billed" | "subscription", cost: AgentCost): AgentCost => {
  if (provider !== "codex" || billing !== "billed") return cost
  const price = cost.model === null ? undefined : priceOf("openai", cost.model)
  return price === undefined
    ? { ...cost, costUsd: null, costBasis: "unknown" }
    : { ...cost, costUsd: tokenCostUsd(price, cost), costBasis: "estimate" }
}

// Runs every agent stage on the provider chosen for it (Settings › Agents; an eval passes `task.route`). The
// Claude CLI is the default. Each provider lives in its own package (packages/provider-*) and takes the same
// task: the system prompt built here from the stage's instructions and skills, one output tool whose Effect
// Schema is its input schema, helper tools, and cost and session hooks.
export class AgentSession extends Context.Service<AgentSession, {
  run<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks): Effect.Effect<S["Type"], AgentError, S["DecodingServices"]>
}>()("@viral/server/agent-session/agent-session/AgentSession") {
  static readonly make = Effect.fn("AgentSession.make")(function*(options: AgentSessionOptions = {}) {
      const appSettings = yield* AppSettingsStore
      const skillPack = yield* SkillPack
      const secrets = yield* Secrets
      const home = yield* ViralHome
      const path = yield* Path.Path
      const cliSetups = yield* CliSetups
      const claude = options.cliRuns?.["claude-cli"] ?? (yield* makeClaudeCliProvider)
      // One AI SDK provider per model key (packages/provider-ai-sdk), each with its vendor's model ids. The key is read
      // per run and passed only to that call; it never goes into process.env. A vendor's address moves only when its
      // *_API_URL override is set (tests point it at a fake server), the same override its key check uses.
      // images go to model APIs downscaled (big contact sheets as JPEGs), cached next to the conversations
      const readImage = yield* modelImageReader(path.join(home.root, "agent-sessions", "images"))
      const keyProvider = Effect.fn("AgentSession.keyProvider")(function*(provider: KeyProvider) {
        const key = PROVIDER_KEY[provider]
        const override = yield* Config.option(Config.String(MODEL_KEY_CHECKS[key].override)).pipe(Effect.orDie)
        const keyModel = options.keyModel
        return yield* makeAiSdkProvider({
          provider,
          apiKey: secrets.get(key),
          sessionsDir: path.join(home.root, "agent-sessions"),
          readImage,
          ...(Option.isSome(override) && provider !== "ai-gateway" ? { baseUrl: override.value.replace(/\/+$/, "") } : {}),
          ...(keyModel === undefined ? {} : { languageModel: (modelId: string, apiKey: string) => keyModel(provider, modelId, apiKey) })
        })
      })
      const keyRuns = yield* Effect.forEach(KEY_PROVIDERS, (provider) => Effect.map(keyProvider(provider), (run) => [provider, run] as const))
      const codex = options.cliRuns?.codex ?? (yield* makeCodexProvider())
      const opencode = options.cliRuns?.opencode ?? (yield* makeOpencodeProvider())
      const providers: Record<AgentRoute["provider"], AgentRun> = {
        "claude-cli": claude,
        codex,
        opencode,
        ...(Object.fromEntries(keyRuns) as Record<KeyProvider, AgentRun>)
      }

      // The step's own choice, or the default for every step (Settings › Agents); a null CLI model is the
      // stage's own default (e.g. Haiku for ads).
      const routeFor = Effect.fn("AgentSession.routeFor")(function*(task: AgentTask<Schema.Top>) {
        const stage = Schema.decodeUnknownOption(AgentStage)(task.stage)
        if (Option.isNone(stage)) return { provider: "claude-cli", model: task.defaultModel } satisfies AgentRoute
        const settings = yield* appSettings.get
        const route = resolveAgentRoute(stage.value, settings.defaultAgent, settings.stageAgents[stage.value])
        return {
          provider: route.provider,
          model: route.provider === "claude-cli" ? route.model ?? task.defaultModel : route.model
        } satisfies AgentRoute
      })

      const run = Effect.fn("AgentSession.run")(function*<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks) {
        const route = task.route ?? (yield* routeFor(task))
        // A CLI runs on your sign-in or on a key (its setup in Settings › Accounts), resolved for this run only: a
        // CLI on a key bills per use; on a Claude plan, its reported cost is the plan's value; Codex on your
        // ChatGPT plan counts against it. The key providers always bill.
        const cliRun = isCliProvider(route.provider) ? yield* cliSetups.resolve(route.provider) : null
        const billing = cliRun?.billing ?? "billed"
        // every cost is recorded with who ran it and whether it's real money
        const stamped: AgentHooks = {
          ...hooks,
          recordCost: (cost) => hooks.recordCost({ ...priced(route.provider, billing, cost), ...(cliRun?.costBasis ? { costBasis: cliRun.costBasis } : {}), provider: route.provider, billing })
        }
        const system = skillPack.systemPrompt({ prompt: task.instructions, skills: task.skills })
        return yield* providers[route.provider](task, stamped, route.model, system, cliRun?.environment)
      })

      return AgentSession.of({ run })
  })

  static readonly layer = Layer.effect(AgentSession, AgentSession.make()).pipe(
    Layer.provide([
      NodeServices.layer,
      CliSetups.layer,
      SkillPack.layer,
      Settings.layer,
      AppSettingsStore.layer,
      Secrets.layer,
      ViralHome.layer,
      SecureRandom.layerWebCrypto
    ])
  )

  // For tests: answers each task with a saved result instead of calling a model, so whole pipelines run
  // without spending tokens (packages/provider-testing). The result still goes through the stage's schema.
  static readonly replay = (answer: (task: AgentTask<Schema.Top>) => unknown) =>
    Layer.succeed(AgentSession, AgentSession.of({ run: replayRun(answer) }))
}
