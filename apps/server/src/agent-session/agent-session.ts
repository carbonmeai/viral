import { NodeServices } from "@effect/platform-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SkillPack } from "../agent-skills/skill-pack.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Secrets } from "../secrets/secrets.ts"
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

// The settings keys that choose a stage's provider and model.
export const stageProviderKey = (stage: string) => `stage.${stage}.provider`
export const stageModelKey = (stage: string) => `stage.${stage}.model`

// Runs every agent stage. The Claude CLI (claude-cli-provider.ts) is the default for every stage, always; a
// stage's `stage.<name>.provider` setting can switch it to the experimental AI Gateway (ai-gateway-provider.ts),
// and an eval passes `task.route` to pick one directly. Both providers take the same task: instructions and
// skills, one output tool whose Effect Schema is its input schema, helper tools, cost and session hooks.
export class AgentSession extends Context.Service<AgentSession, {
  run<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks): Effect.Effect<S["Type"], AgentError, S["DecodingServices"]>
}>()("@viral/server/agent-session/agent-session/AgentSession") {
  static readonly make = Effect.fn("AgentSession.make")(function*(gatewayOptions: AiGatewayOptions = {}) {
      const settings = yield* Settings
      const claude = yield* makeClaudeCliProvider
      const gateway = yield* makeAiGatewayProvider(gatewayOptions)

      // The stage's settings, or its own default model on the Claude CLI.
      const routeFor = Effect.fn("AgentSession.routeFor")(function*(task: AgentTask<Schema.Top>) {
        const provider = Option.getOrElse(yield* settings.get(stageProviderKey(task.stage), AgentProviderName), () => "claude-cli" as const)
        const model = Option.getOrElse(yield* settings.get(stageModelKey(task.stage), Schema.String), () => task.defaultModel)
        return { provider, model } satisfies AgentRoute
      })

      const run = Effect.fn("AgentSession.run")(function*<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks) {
        const route = task.route ?? (yield* routeFor(task))
        return yield* (route.provider === "ai-gateway" ? gateway : claude)(task, hooks, route.model)
      })

      return AgentSession.of({ run })
  })

  static readonly layer = Layer.effect(AgentSession, AgentSession.make()).pipe(
    Layer.provide([NodeServices.layer, SkillPack.layer, Settings.layer, Secrets.layer, ViralHome.layer, SecureRandom.layerWebCrypto])
  )

  // For tests: answers each task with a saved result instead of calling Claude, so whole pipelines run
  // without spending tokens. The result still goes through the stage's schema.
  static readonly replay = (answer: (task: AgentTask<Schema.Top>) => unknown) =>
    Layer.succeed(AgentSession, AgentSession.of({
      run: Effect.fn("AgentSession.replay")(function*<S extends Schema.Top>(task: AgentTask<S>, hooks: AgentHooks) {
        yield* hooks.recordSession(`replay-${task.stage}`)
        yield* hooks.recordCost({ model: "replay", inputTokens: 0, outputTokens: 0, costUsd: 0 })
        return yield* Schema.decodeUnknownEffect(task.output.schema)(answer(task)).pipe(
          Effect.mapError((error) => new AgentError({ code: "invalid-output", message: error.message }))
        )
      })
    }))
}
