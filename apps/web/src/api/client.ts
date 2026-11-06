import { ViralRpcs } from "@viral/contracts"
import { Layer } from "effect"
import { AtomRpc } from "effect/reactivity"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { rpcUrl } from "../config/server-url.ts"

// The typed client for the Viral server, over one WebSocket that reconnects when the server restarts. Its
// runtime backs every query and mutation atom in the app.
export class ViralClient extends AtomRpc.Service<ViralClient>()("ViralClient", {
  group: ViralRpcs,
  protocol: RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide([Socket.layerWebSocket(rpcUrl), RpcSerialization.layerJson]),
    Layer.provide(Socket.layerWebSocketConstructorGlobal)
  )
}) {}
