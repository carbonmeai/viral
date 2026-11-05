import { NodeSocket } from "@effect/platform-node"
import { ViralRpcs } from "@viral/contracts"
import { Context, Effect, Layer } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import type { RpcClientError } from "effect/rpc/RpcClientError"

const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
  Layer.provide([NodeSocket.layerWebSocket("ws://127.0.0.1:3410/rpc"), RpcSerialization.layerJson])
)

// The typed RPC client for the local Viral server.
export class Client extends Context.Service<Client, RpcClient.FromGroup<typeof ViralRpcs, RpcClientError>>()("@viral/cli/client") {
  static readonly layer = Layer.effect(Client, RpcClient.make(ViralRpcs)).pipe(Layer.provide(ProtocolLive))
}
