import { NodeRuntime, NodeSocket } from "@effect/platform-node"
import { type JobEvent, ViralRpcs } from "@viral/contracts"
import { Console, Effect, Layer, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import * as readline from "node:readline/promises"

// Dev client:
//   node apps/cli/src/main.ts run <jobId> [--approve|--reject] [--seconds N]
//   node apps/cli/src/main.ts approve <requestId> | reject <requestId>
//   node apps/cli/src/main.ts cancel <jobId>
const [command = "run", target = "job-1", ...flags] = process.argv.slice(2)
const flag = (name: string) => flags.includes(name)
const secondsIndex = flags.indexOf("--seconds")
const renderSeconds = secondsIndex >= 0 ? Number(flags[secondsIndex + 1]) : 20

const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
  Layer.provide([NodeSocket.layerWebSocket("ws://127.0.0.1:3410/rpc"), RpcSerialization.layerJson])
)

const ask = (question: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => readline.createInterface({ input: process.stdin, output: process.stdout })),
    (rl) => Effect.promise(() => rl.question(question)),
    (rl) => Effect.sync(() => rl.close())
  )

const program = Effect.gen(function*() {
  const client = yield* RpcClient.make(ViralRpcs)

  const answer = Effect.fn("answer")(function*(requestId: string) {
    const approved = flag("--approve") ? true : flag("--reject") ? false : (yield* ask("approve? [y/N] ")) === "y"
    yield* client.Respond({ requestId, approved })
  })

  const print = (event: JobEvent) => {
    switch (event._tag) {
      case "AgentText":
        return Console.log(`  claude: ${event.text}`)
      case "ScriptProposed":
        return Console.log(`  script:\n    ${[event.script.hook, ...event.script.lines].join("\n    ")}`)
      case "ApprovalRequested":
        return Console.log(`? ${event.title} (${event.requestId})`).pipe(Effect.andThen(answer(event.requestId)))
      case "Progress":
        return Console.log(`  ${event.stage} ${event.pct.toFixed(1)}%`)
      default:
        return Console.log(`[${event._tag}] ${JSON.stringify({ ...event, _tag: undefined })}`)
    }
  }

  switch (command) {
    case "run":
      return yield* client.StartJob({ jobId: target, renderSeconds }).pipe(Stream.runForEach(print))
    case "approve":
    case "reject":
      return yield* Console.log(yield* client.Respond({ requestId: target, approved: command === "approve" }))
    case "cancel":
      return yield* Console.log(`cancelled: ${yield* client.CancelJob({ jobId: target })}`)
    default:
      return yield* Console.error(`unknown command ${command}`)
  }
}).pipe(Effect.scoped, Effect.provide(ProtocolLive))

NodeRuntime.runMain(program)
