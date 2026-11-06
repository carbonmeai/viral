import {
  AgentChoice,
  AgentProvider,
  AgentStage,
  type AppSettings,
  canRunStage,
  resolveAgentRoute,
  SettingsError,
  TranscriberChoice
} from "@viral/contracts"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { Settings } from "./settings.ts"

// The keys the server's own preferences live under. A step's own choice is its provider plus its model; the
// default for every step is `agents.default`.
export const stageModelKey = (stage: string) => `stage.${stage}.model`
export const stageProviderKey = (stage: string) => `stage.${stage}.provider`
export const DEFAULT_AGENT_KEY = "agents.default"
export const TRANSCRIBER_KEY = "transcription.provider"

const CLI_DEFAULT: AgentChoice = { provider: "claude-cli", model: null }

const invalid = (message: string) => new SettingsError({ message })

// A choice the server will accept: the gateway and OpenCode need a model; the vision steps need a provider that
// sees images.
export const checkChoice = (stage: AgentStage | null, choice: AgentChoice) => {
  const model = choice.model?.trim() ?? ""
  if (choice.provider === "ai-gateway" && model === "") {
    return Effect.fail(invalid("choose a model for the AI Gateway, e.g. anthropic/claude-haiku-5.5"))
  }
  if (choice.provider === "opencode" && !model.includes("/")) {
    return Effect.fail(invalid("choose an OpenCode model (provider/model), e.g. anthropic/claude-haiku-5.5"))
  }
  if (stage !== null && !canRunStage(choice.provider, stage)) {
    return Effect.fail(invalid(`the ${stage} step looks at images, which this provider can't do in Viral yet`))
  }
  return Effect.succeed({ provider: choice.provider, model: model === "" ? null : model } satisfies AgentChoice)
}

// The typed view of the app's preferences that Settings › Agents and Transcription edit.
export class AppSettingsStore extends Context.Service<AppSettingsStore, {
  readonly get: Effect.Effect<AppSettings>
  setDefaultAgent(agent: AgentChoice): Effect.Effect<AppSettings, SettingsError>
  setStageAgent(stage: AgentStage, agent: AgentChoice | null): Effect.Effect<AppSettings, SettingsError>
  setTranscriber(choice: TranscriberChoice): Effect.Effect<AppSettings>
}>()("@viral/server/settings/app-settings/AppSettingsStore") {
  static readonly layer = Layer.effect(
    AppSettingsStore,
    Effect.gen(function*() {
      const settings = yield* Settings
      const env = yield* Config.option(Config.String("VIRAL_TRANSCRIBER")).pipe(Effect.orDie)

      // A step's own choice: its provider (claude-cli when only a CLI model was set, as older settings did) and
      // model, or null when it has neither and uses the default.
      const stageAgent = Effect.fn("AppSettingsStore.stageAgent")(function*(stage: AgentStage) {
        const provider = yield* settings.get(stageProviderKey(stage), AgentProvider)
        const model = yield* settings.get(stageModelKey(stage), Schema.String)
        if (Option.isNone(provider) && Option.isNone(model)) return null
        return { provider: Option.getOrElse(provider, () => "claude-cli" as const), model: Option.getOrNull(model) } satisfies AgentChoice
      })
      const defaultAgent = settings.get(DEFAULT_AGENT_KEY, AgentChoice).pipe(Effect.map(Option.getOrElse(() => CLI_DEFAULT)))

      const perStage = <A>(read: (stage: AgentStage) => Effect.Effect<A>) =>
        Effect.map(
          Effect.all(AgentStage.literals.map((stage) => Effect.map(read(stage), (value) => [stage, value] as const))),
          (entries) => Object.fromEntries(entries) as Record<AgentStage, A>
        )

      const get = Effect.gen(function*() {
        const fallback = yield* defaultAgent
        const stageAgents = yield* perStage(stageAgent)
        const routes = Object.fromEntries(
          AgentStage.literals.map((stage) => [stage, resolveAgentRoute(stage, fallback, stageAgents[stage])])
        ) as AppSettings["routes"]
        const transcriber = Option.getOrElse(yield* settings.get(TRANSCRIBER_KEY, TranscriberChoice), () => "auto" as const)
        return {
          defaultAgent: fallback,
          stageAgents,
          routes,
          transcriber,
          transcriberFromEnvironment: Option.getOrNull(env)
        } satisfies AppSettings
      }).pipe(Effect.withSpan("AppSettingsStore.get"))

      const setDefaultAgent = Effect.fn("AppSettingsStore.setDefaultAgent")(function*(agent: AgentChoice) {
        const checked = yield* checkChoice(null, agent)
        yield* checked.provider === "claude-cli" && checked.model === null
          ? settings.remove(DEFAULT_AGENT_KEY)
          : settings.set(DEFAULT_AGENT_KEY, checked)
        return yield* get
      })

      // The provider and its model change together: a gateway id means nothing to the CLI, and the reverse.
      const setStageAgent = Effect.fn("AppSettingsStore.setStageAgent")(function*(stage: AgentStage, agent: AgentChoice | null) {
        if (agent === null) {
          yield* settings.remove(stageProviderKey(stage))
          yield* settings.remove(stageModelKey(stage))
          return yield* get
        }
        const checked = yield* checkChoice(stage, agent)
        yield* settings.set(stageProviderKey(stage), checked.provider)
        yield* checked.model === null ? settings.remove(stageModelKey(stage)) : settings.set(stageModelKey(stage), checked.model)
        return yield* get
      })

      const setTranscriber = Effect.fn("AppSettingsStore.setTranscriber")(function*(choice: TranscriberChoice) {
        yield* settings.set(TRANSCRIBER_KEY, choice)
        return yield* get
      })

      return AppSettingsStore.of({ get, setDefaultAgent, setStageAgent, setTranscriber })
    })
  ).pipe(Layer.provide(Settings.layer))
}
