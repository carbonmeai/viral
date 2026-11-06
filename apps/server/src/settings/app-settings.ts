import { AgentStage, type AppSettings, TranscriberChoice } from "@viral/contracts"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { Settings } from "./settings.ts"

// The keys the server's own preferences live under.
export const stageModelKey = (stage: AgentStage) => `stage.${stage}.model`
export const TRANSCRIBER_KEY = "transcription.provider"

// The typed view of the app's preferences that Settings › Agents and Transcription edit.
export class AppSettingsStore extends Context.Service<AppSettingsStore, {
  readonly get: Effect.Effect<AppSettings>
  setStageModel(stage: AgentStage, model: string | null): Effect.Effect<AppSettings>
  setTranscriber(choice: TranscriberChoice): Effect.Effect<AppSettings>
}>()("@viral/server/settings/app-settings/AppSettingsStore") {
  static readonly layer = Layer.effect(
    AppSettingsStore,
    Effect.gen(function*() {
      const settings = yield* Settings
      const env = yield* Config.option(Config.String("VIRAL_TRANSCRIBER")).pipe(Effect.orDie)

      const model = (stage: AgentStage) =>
        settings.get(stageModelKey(stage), Schema.String).pipe(Effect.map(Option.getOrNull))

      const get = Effect.gen(function*() {
        const [ads, story, script, shots, metadata] = yield* Effect.all(AgentStage.literals.map(model))
        const transcriber = Option.getOrElse(yield* settings.get(TRANSCRIBER_KEY, TranscriberChoice), () => "auto" as const)
        return {
          stageModels: { ads: ads ?? null, story: story ?? null, script: script ?? null, shots: shots ?? null, metadata: metadata ?? null },
          transcriber,
          transcriberFromEnvironment: Option.getOrNull(env)
        } satisfies AppSettings
      }).pipe(Effect.withSpan("AppSettingsStore.get"))

      const setStageModel = Effect.fn("AppSettingsStore.setStageModel")(function*(stage: AgentStage, value: string | null) {
        const trimmed = value?.trim() ?? ""
        yield* trimmed === "" ? settings.remove(stageModelKey(stage)) : settings.set(stageModelKey(stage), trimmed)
        return yield* get
      })

      const setTranscriber = Effect.fn("AppSettingsStore.setTranscriber")(function*(choice: TranscriberChoice) {
        yield* settings.set(TRANSCRIBER_KEY, choice)
        return yield* get
      })

      return AppSettingsStore.of({ get, setStageModel, setTranscriber })
    })
  ).pipe(Layer.provide(Settings.layer))
}
