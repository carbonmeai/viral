import { NodeServices } from "@effect/platform-node"
import { AgentStage, resolveAgentRoute } from "@viral/contracts"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SkillPack } from "../agent-skills/skill-pack.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Secrets } from "../secrets/secrets.ts"
import { AppSettingsStore } from "../settings/app-settings.ts"
import { Settings } from "../settings/settings.ts"
import { type AiGatewayOptions, makeAiGatewayProvider } from "./ai-gateway-provider.ts"
import { AgentError, type AgentHooks, AgentProviderName, type AgentRoute, type AgentTask } from "./agent-task.ts"
import { makeClaudeCliProvider } from "./claude-cli-provider.ts"

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

// Runs every agent stage. The Claude CLI (claude-cli-provider.ts) is the default for every stage, always; a
// stage's `stage.<name>.provider` setting can switch it to the experimental AI Gateway (ai-gateway-provider.ts),
// and an eval passes `task.route` to pick one directly. Both providers take the same task: instructions and
// skills, one output tool whose Effect Schema is its input schema, helper tools, cost and session hooks.
export class AgentSession extends Context.Service<AgentSession, {
  run<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks): Effect.Effect<S["Type"], AgentError, S["DecodingServices"]>
}>()("@viral/server/agent-session/agent-session/AgentSession") {
  static readonly make = Effect.fn("AgentSession.make")(function*(gatewayOptions: AiGatewayOptions = {}) {
      const appSettings = yield* AppSettingsStore
      const claude = yield* makeClaudeCliProvider
      const gateway = yield* makeAiGatewayProvider(gatewayOptions)
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
        return yield* (route.provider === "ai-gateway" ? gateway : claude)(task, stamped, route.model)
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

  // For tests: answers each task with a saved result instead of calling Claude, so whole pipelines run
  // without spending tokens. The result still goes through the stage's schema.
  static readonly replay = (answer: (task: AgentTask<Schema.Top>) => unknown) =>
    Layer.succeed(AgentSession, AgentSession.of({
      run: Effect.fn("AgentSession.replay")(function*<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks) {
        yield* hooks.recordSession(`replay-${task.stage}`)
        yield* hooks.recordCost({ model: "replay", inputTokens: 0, outputTokens: 0, costUsd: 0, provider: "replay", billing: null })
        return yield* Schema.decodeUnknownEffect(task.output.schema)(answer(task)).pipe(
          Effect.mapError((error) => new AgentError({ code: "invalid-output", message: error.message }))
        )
      })
    }))
}
