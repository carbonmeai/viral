import { NodeServices } from "@effect/platform-node"
import { AgentStage, resolveAgentRoute } from "@viral/contracts"
import { Config, Context, Effect, Layer, Option, Path, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SkillPack } from "../agent-skills/skill-pack.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Secrets } from "../secrets/secrets.ts"
import { AppSettingsStore } from "../settings/app-settings.ts"
import { Settings } from "../settings/settings.ts"
import { makeAiGatewayProvider } from "@viral/provider-ai-gateway"
import { makeClaudeCliProvider } from "@viral/provider-claude-cli"
import { replayRun } from "@viral/provider-testing"
import type { LanguageModel } from "ai"
import type { AgentError, AgentHooks, AgentRoute, AgentRun, AgentTask } from "./agent-task.ts"

export {
  AgentError,
  type AgentHooks,
  AgentProviderName,
  type AgentRoute,
  type AgentTask,
  type AgentTool,
  agentTool,
  toolJsonSchema,
  toolShape
} from "./agent-task.ts"

export interface AgentSessionOptions {
  // the gateway's language model behind an id; tests pass a mock
  readonly gatewayModel?: (modelId: string, apiKey: string) => LanguageModel
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
      const claude = yield* makeClaudeCliProvider
      const gateway = yield* makeAiGatewayProvider({
        apiKey: secrets.get("gateway"),
        sessionsDir: path.join(home.root, "agent-sessions"),
        ...(options.gatewayModel === undefined ? {} : { languageModel: options.gatewayModel })
      })
      const providers: Record<AgentRoute["provider"], AgentRun> = { "claude-cli": claude, "ai-gateway": gateway }
      // a CLI with an API key bills per use; signed in to a Claude plan, its reported cost is the plan's value
      const cliBilling = Option.isSome(yield* Config.option(Config.String("ANTHROPIC_API_KEY")).pipe(Effect.orDie))
        ? "billed" as const
        : "subscription" as const

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
        // every cost is recorded with who ran it and whether it's real money
        const billing = route.provider === "claude-cli" ? cliBilling : "billed" as const
        const stamped: AgentHooks = {
          ...hooks,
          recordCost: (cost) => hooks.recordCost({ ...cost, provider: route.provider, billing })
        }
        const system = skillPack.systemPrompt({ prompt: task.instructions, skills: task.skills })
        return yield* providers[route.provider](task, stamped, route.model, system)
      })

      return AgentSession.of({ run })
  })

  static readonly layer = Layer.effect(AgentSession, AgentSession.make()).pipe(
    Layer.provide([
      NodeServices.layer,
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
