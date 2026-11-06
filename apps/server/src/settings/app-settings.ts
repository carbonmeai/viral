import { AgentProvider, AgentStage, type AppSettings, TranscriberChoice } from "@viral/contracts"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { Settings } from "./settings.ts"

// The keys the server's own preferences live under.
export const stageModelKey = (stage: AgentStage) => `stage.${stage}.model`
export const stageProviderKey = (stage: AgentStage) => `stage.${stage}.provider`
export const TRANSCRIBER_KEY = "transcription.provider"

// The typed view of the app's preferences that Settings › Agents and Transcription edit.
export class AppSettingsStore extends Context.Service<AppSettingsStore, {
  readonly get: Effect.Effect<AppSettings>
  setStageModel(stage: AgentStage, model: string | null): Effect.Effect<AppSettings>
  setStageProvider(stage: AgentStage, provider: AgentProvider, model: string | null): Effect.Effect<AppSettings>
  setTranscriber(choice: TranscriberChoice): Effect.Effect<AppSettings>
}>()("@viral/server/settings/app-settings/AppSettingsStore") {
  static readonly layer = Layer.effect(
    AppSettingsStore,
    Effect.gen(function*() {
      const settings = yield* Settings
      const env = yield* Config.option(Config.String("VIRAL_TRANSCRIBER")).pipe(Effect.orDie)

      const model = (stage: AgentStage) =>
        settings.get(stageModelKey(stage), Schema.String).pipe(Effect.map(Option.getOrNull))

      const provider = (stage: AgentStage) =>
        settings.get(stageProviderKey(stage), AgentProvider).pipe(Effect.map(Option.getOrElse(() => "claude-cli" as const)))
      const perStage = <A>(read: (stage: AgentStage) => Effect.Effect<A>) =>
        Effect.map(
          Effect.all(AgentStage.literals.map((stage) => Effect.map(read(stage), (value) => [stage, value] as const))),
          (entries) => Object.fromEntries(entries) as Record<AgentStage, A>
        )

      const get = Effect.gen(function*() {
        const stageModels = yield* perStage(model)
        const stageProviders = yield* perStage(provider)
        const transcriber = Option.getOrElse(yield* settings.get(TRANSCRIBER_KEY, TranscriberChoice), () => "auto" as const)
        return {
          stageModels,
          stageProviders,
          transcriber,
          transcriberFromEnvironment: Option.getOrNull(env)
        } satisfies AppSettings
      }).pipe(Effect.withSpan("AppSettingsStore.get"))

      const setStageModel = Effect.fn("AppSettingsStore.setStageModel")(function*(stage: AgentStage, value: string | null) {
        const trimmed = value?.trim() ?? ""
        yield* trimmed === "" ? settings.remove(stageModelKey(stage)) : settings.set(stageModelKey(stage), trimmed)
        return yield* get
      })

      // The provider and its model change together: a gateway id means nothing to the CLI, and the reverse.
      const setStageProvider = Effect.fn("AppSettingsStore.setStageProvider")(
        function*(stage: AgentStage, provider: AgentProvider, value: string | null) {
          yield* provider === "claude-cli" ? settings.remove(stageProviderKey(stage)) : settings.set(stageProviderKey(stage), provider)
          return yield* setStageModel(stage, value)
        }
      )

      const setTranscriber = Effect.fn("AppSettingsStore.setTranscriber")(function*(choice: TranscriberChoice) {
        yield* settings.set(TRANSCRIBER_KEY, choice)
        return yield* get
      })

      return AppSettingsStore.of({ get, setStageModel, setStageProvider, setTranscriber })
    })
  ).pipe(Layer.provide(Settings.layer))
}
