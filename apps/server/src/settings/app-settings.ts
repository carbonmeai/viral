import {
  AgentChoice,
  AgentProvider,
  AgentStage,
  type AppSettings,
  canRunStage,
  catalogFor,
  catalogModel,
  isKeyProvider,
  type KeyProvider,
  resolveAgentRoute,
  seesImages,
  SettingsError,
  TranscriberChoice,
  visionModelKey
} from "@viral/contracts"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { Settings } from "./settings.ts"

// The keys the server's own preferences live under. A step's own choice is its provider plus its model; the
// default for every step is `agents.default`.
export const stageModelKey = (stage: string) => `stage.${stage}.model`
export const stageProviderKey = (stage: string) => `stage.${stage}.provider`
export const DEFAULT_AGENT_KEY = "agents.default"
export const TRANSCRIBER_KEY = "transcription.provider"
// models outside Viral's knowledge that their vendor's list says take images ("openrouter:qwen/qwen3-vl")
export const VISION_MODELS_KEY = "agents.vision-models"

const CLI_DEFAULT: AgentChoice = { provider: "claude-cli", model: null }

const invalid = (message: string) => new SettingsError({ message })

const KEY_PROVIDER_NAMES = { anthropic: "Anthropic", openai: "OpenAI", google: "Google Gemini", openrouter: "OpenRouter", "ai-gateway": "the AI Gateway" }

// A choice the server will accept: the key providers (Anthropic, OpenAI, Google, OpenRouter, the AI Gateway) and
// OpenCode need a model; the vision steps need a model that sees images (`seen`: the ones remembered from a vendor's
// list).
export const checkChoice = Effect.fn("checkChoice")(function*(stage: AgentStage | null, choice: AgentChoice, seen: ReadonlyArray<string> = []) {
  const model = choice.model?.trim() ?? ""
  if (isKeyProvider(choice.provider) && model === "") {
    const example = catalogFor(choice.provider)[0]?.id
    return yield* invalid(`choose a model for ${KEY_PROVIDER_NAMES[choice.provider]}${example === undefined ? "" : `, e.g. ${example}`}`)
  }
  if (choice.provider === "opencode" && !model.includes("/")) {
    return yield* invalid("choose an OpenCode model (provider/model), e.g. anthropic/claude-haiku-5.5")
  }
  const checked = { provider: choice.provider, model: model === "" ? null : model } satisfies AgentChoice
  if (stage !== null && !canRunStage(checked, stage, seen)) {
    if (!isKeyProvider(choice.provider)) {
      return yield* invalid(`the ${stage} step looks at images, which ${choice.provider === "codex" ? "Codex" : "OpenCode"} can't do in Viral`)
    }
    const name = catalogModel(choice.provider, model)?.label ?? model
    return yield* invalid(`the ${stage} step looks at images, and ${name} doesn't take images (or ${KEY_PROVIDER_NAMES[choice.provider]} doesn't say it does)`)
  }
  return checked
})

// The typed view of the app's preferences that Settings › Agents and Transcription edit.
export class AppSettingsStore extends Context.Service<AppSettingsStore, {
  readonly get: Effect.Effect<AppSettings>
  setDefaultAgent(agent: AgentChoice): Effect.Effect<AppSettings, SettingsError>
  setStageAgent(stage: AgentStage, agent: AgentChoice | null): Effect.Effect<AppSettings, SettingsError>
  setTranscriber(choice: TranscriberChoice): Effect.Effect<AppSettings>
  // remembers that a model's vendor lists it as taking images, so it can run the image steps
  rememberVision(provider: KeyProvider, model: string): Effect.Effect<void>
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
      const visionModels = settings.get(VISION_MODELS_KEY, Schema.Array(Schema.String)).pipe(Effect.map(Option.getOrElse((): ReadonlyArray<string> => [])))

      const perStage = <A>(read: (stage: AgentStage) => Effect.Effect<A>) =>
        Effect.map(
          Effect.all(AgentStage.literals.map((stage) => Effect.map(read(stage), (value) => [stage, value] as const))),
          (entries) => Object.fromEntries(entries) as Record<AgentStage, A>
        )

      const get = Effect.gen(function*() {
        const fallback = yield* defaultAgent
        const stageAgents = yield* perStage(stageAgent)
        const seen = yield* visionModels
        const routes = Object.fromEntries(
          AgentStage.literals.map((stage) => [stage, resolveAgentRoute(stage, fallback, stageAgents[stage], seen)])
        ) as AppSettings["routes"]
        const transcriber = Option.getOrElse(yield* settings.get(TRANSCRIBER_KEY, TranscriberChoice), () => "auto" as const)
        return {
          defaultAgent: fallback,
          stageAgents,
          routes,
          visionModels: seen,
          transcriber,
          transcriberFromEnvironment: Option.getOrNull(env)
        } satisfies AppSettings
      }).pipe(Effect.withSpan("AppSettingsStore.get"))

      const setDefaultAgent = Effect.fn("AppSettingsStore.setDefaultAgent")(function*(agent: AgentChoice) {
        const checked = yield* checkChoice(null, agent, yield* visionModels)
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
        const checked = yield* checkChoice(stage, agent, yield* visionModels)
        yield* settings.set(stageProviderKey(stage), checked.provider)
        yield* checked.model === null ? settings.remove(stageModelKey(stage)) : settings.set(stageModelKey(stage), checked.model)
        return yield* get
      })

      const setTranscriber = Effect.fn("AppSettingsStore.setTranscriber")(function*(choice: TranscriberChoice) {
        yield* settings.set(TRANSCRIBER_KEY, choice)
        return yield* get
      })

      const rememberVision = Effect.fn("AppSettingsStore.rememberVision")(function*(provider: KeyProvider, model: string) {
        const seen = yield* visionModels
        if (seesImages({ provider, model }, seen)) return
        yield* settings.set(VISION_MODELS_KEY, [...seen, visionModelKey(provider, model)])
      })

      return AppSettingsStore.of({ get, setDefaultAgent, setStageAgent, setTranscriber, rememberVision })
    })
  ).pipe(Layer.provide(Settings.layer))
}
