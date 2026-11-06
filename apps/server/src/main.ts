import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { ViralRpcs } from "@viral/contracts"
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer needs a node:http server factory
import { createServer } from "node:http"
import { AgentSession } from "./agent-session/agent-session.ts"
import { Artifacts } from "./artifacts/artifacts.ts"
import { ArtifactsRpcLive } from "./artifacts/artifacts-rpc.ts"
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
import { Transcriber } from "./transcribe/transcriber.ts"
import { ElevenLabs } from "./voice/eleven-labs.ts"
import { VoicesRpcLive } from "./voice/voices-rpc.ts"
import { ViralHome } from "./home/viral-home.ts"

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
  Transcriber.layer,
  ViralHome.layer
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
    VoicesRpcLive
  ]),
  Layer.provide(RunsLive),
  Layer.provide(RpcSerialization.layerJson)
)

const ServerLive = HttpRouter.serve(RpcLive).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: PORT }))
)

Layer.launch(ServerLive).pipe(NodeRuntime.runMain)
