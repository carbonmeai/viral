import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node"
import { ViralRpcs } from "@viral/contracts"
import { Config, Duration, Effect, Layer, Option, Schedule } from "effect"
import { HttpRouter } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer needs a node:http server factory
import { createServer } from "node:http"
import { AgentSession } from "./agent-session/agent-session.ts"
import { Artifacts } from "./artifacts/artifacts.ts"
import { ArtifactsRpcLive } from "./artifacts/artifacts-rpc.ts"
import { MusicBeds } from "./music-bed/music-beds.ts"
import { MusicBedsRpcLive } from "./music-bed/music-beds-rpc.ts"
import { Publishing } from "./metadata/publishing.ts"
import { PublishRpcLive } from "./metadata/publish-rpc.ts"
import { MusicLibrary } from "./music-library/music-library.ts"
import { MusicLibraryRpcLive } from "./music-library/music-library-rpc.ts"
import { Presets } from "./presets/presets.ts"
import { PresetsRpcLive } from "./presets/presets-rpc.ts"
import { Projects } from "./projects/projects.ts"
import { ProjectsRpcLive } from "./projects/projects-rpc.ts"
import { References } from "./references/references.ts"
import { ReferencesRpcLive } from "./references/references-rpc.ts"
import { PipelineStagesLive } from "./runs/pipeline-stages.ts"
import { RunManager } from "./runs/run-manager.ts"
import { RunStore } from "./runs/run-store.ts"
import { RunsRpcLive } from "./runs/runs-rpc.ts"
import { SoundLibrary } from "./sound-library/sound-library.ts"
import { SoundLibraryRpcLive } from "./sound-library/sound-library-rpc.ts"
import { Sources } from "./sources/sources.ts"
import { SourcesRpcLive } from "./sources/sources-rpc.ts"
import { FramesAround } from "./contact-sheet/frames-around.ts"
import { ShortWorkspaces } from "./projects/short-workspace.ts"
import { ShortWorkspaceRpcLive } from "./projects/short-workspace-rpc.ts"
import { SourceOverviews } from "./sources/source-overview.ts"
import { SourceOverviewRpcLive } from "./sources/source-overview-rpc.ts"
import { Transcriber } from "./transcribe/transcriber.ts"
import { ElevenLabs } from "./voice/eleven-labs.ts"
import { VoicePreviews } from "./voice/voice-previews.ts"
import { VoicesRpcLive } from "./voice/voices-rpc.ts"
import { ViralHome } from "./home/viral-home.ts"
import { HealthRouteLive, MediaRouteLive } from "./media/media-route.ts"
import { prependToolsPath, Tools } from "./tools/tools.ts"
import { ToolsRpcLive } from "./tools/tools-rpc.ts"
import { KeyAccounts } from "./secrets/key-accounts.ts"
import { Secrets } from "./secrets/secrets.ts"
import { AppSettingsStore } from "./settings/app-settings.ts"
import { SettingsRpcLive } from "./settings/settings-rpc.ts"
import { StorageReport } from "./storage/storage.ts"
import { UsageReport } from "./usage/usage.ts"
import { EvalRecords } from "./eval/eval-records.ts"
import { DatabaseLive } from "./persistence/database.ts"
import { VideoSetOverviews } from "./video-sets/video-set-overview.ts"
import { VideoSets } from "./video-sets/video-sets.ts"
import { VideoSetsRpcLive } from "./video-sets/video-sets-rpc.ts"
import { Researches } from "./research/researches.ts"

// The port clients connect to; VIRAL_PORT moves it (the desktop app passes its own).
const PORT = 3410

const DomainsLive = Layer.mergeAll(
  Sources.layer,
  Artifacts.layer,
  Projects.layer,
  Presets.layer,
  MusicLibrary.layer,
  SoundLibrary.layer,
  References.layer,
  RunStore.layer,
  ElevenLabs.layer,
  VoicePreviews.layer,
  Transcriber.layer,
  ViralHome.layer,
  Tools.layer,
  Secrets.layer,
  KeyAccounts.layer,
  AppSettingsStore.layer,
  StorageReport.layer,
  UsageReport.layer,
  EvalRecords.layer.pipe(Layer.provide(DatabaseLive)),
  SourceOverviews.layer,
  ShortWorkspaces.layer,
  FramesAround.layer,
  VideoSets.layer,
  VideoSetOverviews.layer,
  Researches.layer,
  NodeServices.layer
)

const RunsLive = RunManager.layer.pipe(
  Layer.provideMerge(PipelineStagesLive),
  Layer.provideMerge(Layer.mergeAll(DomainsLive, AgentSession.layer))
)

const RpcLive = RpcServer.layerHttp({ group: ViralRpcs, path: "/rpc", protocol: "websocket" }).pipe(
  Layer.provide([
    SourcesRpcLive,
    ProjectsRpcLive,
    PresetsRpcLive,
    MusicLibraryRpcLive,
    ArtifactsRpcLive,
    SoundLibraryRpcLive,
    ReferencesRpcLive,
    RunsRpcLive,
    VoicesRpcLive,
    ToolsRpcLive,
    SettingsRpcLive,
    SourceOverviewRpcLive,
    ShortWorkspaceRpcLive,
    VideoSetsRpcLive,
    MusicBedsRpcLive.pipe(Layer.provide(MusicBeds.layer)),
    PublishRpcLive.pipe(Layer.provide(Publishing.layer))
  ]),
  Layer.provide(RunsLive),
  Layer.provide(RpcSerialization.layerJson)
)

// Media files and the readiness check, next to the RPC endpoint.
const HttpLive = Layer.mergeAll(MediaRouteLive, HealthRouteLive).pipe(Layer.provide([ViralHome.layer, NodeServices.layer]))

// Only this machine can connect: the server holds your keys' results and your library.
const ListenLive = Layer.unwrap(Effect.gen(function*() {
  const port = yield* Config.Int("VIRAL_PORT").pipe(Config.withDefault(PORT))
  return NodeHttpServer.layer(createServer, { port, host: "127.0.0.1" })
}))

const ServerLive = HttpRouter.serve(Layer.mergeAll(RpcLive, HttpLive)).pipe(Layer.provide(ListenLive))

// When an app starts the server (the desktop app sets VIRAL_PARENT_PID), the server stops once that app is
// gone, even if it crashed or was killed without a chance to stop it.
const ParentWatchLive = Layer.effectDiscard(Effect.gen(function*() {
  const parent = yield* Config.option(Config.Int("VIRAL_PARENT_PID"))
  if (Option.isNone(parent)) return
  const alive = Effect.sync(() => {
    try {
      process.kill(parent.value, 0)
      return true
    } catch {
      return false
    }
  })
  yield* alive.pipe(
    Effect.repeat({ schedule: Schedule.spaced(Duration.seconds(2)), while: (up) => up }),
    Effect.andThen(Effect.logInfo("the app that started the server is gone; stopping")),
    Effect.andThen(Effect.sync(() => process.kill(process.pid, "SIGTERM"))),
    Effect.forkDetach
  )
}))

// Viral's own yt-dlp keeps up with YouTube: a background check at start, at most every few days. Where macOS's
// own cut-out works, rembg's models are a fallback fetched only when a thumbnail needs them; elsewhere they're
// fetched quietly once first-run setup has the required tools (VIRAL_PREFETCH_MODELS=off skips it).
const ToolUpdatesLive = Layer.effectDiscard(Effect.gen(function*() {
  const tools = yield* Tools
  yield* tools.updateYtDlp.pipe(Effect.forkDetach)
  const prefetch = yield* Config.String("VIRAL_PREFETCH_MODELS").pipe(Config.withDefault("on"), Effect.orDie)
  if (prefetch === "off" || tools.appleCutout) return
  const requiredReady = tools.list.pipe(Effect.map((list) => list.every((t) => !t.required || t.status === "ready")))
  yield* requiredReady.pipe(
    Effect.repeat({ schedule: Schedule.spaced(Duration.seconds(30)), until: (ready) => ready }),
    Effect.andThen(tools.prefetchBackgroundRemoval),
    Effect.forkDetach
  )
})).pipe(Layer.provide(Tools.layer))

// Viral's tools folder goes first on the PATH before anything starts a tool.
prependToolsPath.pipe(
  Effect.provide(NodeServices.layer),
  Effect.andThen(Layer.launch(Layer.mergeAll(ServerLive, ParentWatchLive, ToolUpdatesLive))),
  NodeRuntime.runMain
)
