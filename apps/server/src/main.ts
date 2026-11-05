import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { ViralRpcs } from "@viral/contracts"
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer needs a node:http server factory
import { createServer } from "node:http"
import { Jobs } from "./jobs/jobs.ts"
import { JobsRpcLive } from "./jobs/jobs-rpc.ts"
import { Pipeline } from "./pipeline/pipeline.ts"
import { PipelineRpcLive } from "./pipeline/pipeline-rpc.ts"
import { RenderEngine } from "./render/render-engine.ts"
import { ScriptAgent } from "./script/script-agent.ts"

const PORT = 3410

const RpcLive = RpcServer.layerHttp({ group: ViralRpcs, path: "/rpc", protocol: "websocket" }).pipe(
  Layer.provide([JobsRpcLive, PipelineRpcLive]),
  Layer.provide(Pipeline.layer),
  Layer.provide(Layer.mergeAll(Jobs.layer, ScriptAgent.layer, RenderEngine.layer)),
  Layer.provide(RpcSerialization.layerJson)
)

const ServerLive = HttpRouter.serve(RpcLive).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: PORT }))
)

Layer.launch(ServerLive).pipe(NodeRuntime.runMain)
