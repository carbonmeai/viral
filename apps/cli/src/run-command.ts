import { RequestId, RunId, StageName } from "@viral/contracts"
import { Console, Effect, FileSystem, Path, Schema, Stream } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { printUpdate } from "./print-event.ts"

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeStage = Schema.decodeUnknownEffect(StageName)

export const RUN_USAGE = `  follow <run-id> | cancel <run-id> | resume <run-id>
  requests | approve <request-id> | reject <request-id> "<note>" [--to <stage>]   (--to sends it back further, e.g. assemble)
  edit <request-id> <file.json>   (answer a gate with your edited version, e.g. a shot list)`

// Prints a run's updates until it finishes or stops at a gate you still need to answer (the history
// replays gates you already answered).
export const follow = Effect.fn("follow")(function*(runId: RunId) {
  const client = yield* Client
  const print = printUpdate()
  yield* client.SubscribeRun({ runId, afterSeq: 0 }).pipe(
    Stream.tap(print),
    Stream.takeUntilEffect((u) => {
      if (u._tag !== "Event" || u.event._tag !== "RequestRaised") return Effect.succeed(false)
      const raised = u.event.request.id
      return Effect.map(client.ListPendingRequests(), (pending) => pending.some((r) => r.id === raised))
    }),
    Stream.runDrain
  )
})

export const runCommand = Effect.fn("runCommand")(function*() {
  const client = yield* Client
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const [command, id = "", note = ""] = positionals
  switch (command) {
    case "follow":
      return yield* follow(RunId.make(id))
    case "cancel":
      return yield* Console.log(`cancelled: ${yield* client.CancelRun({ runId: RunId.make(id) })}`)
    case "resume": {
      const run = yield* client.ResumeRun({ runId: RunId.make(id) })
      return yield* follow(run.id)
    }
    case "requests": {
      const pending = yield* client.ListPendingRequests()
      if (pending.length === 0) return yield* Console.log("nothing is waiting for you")
      return yield* Effect.forEach(pending, (r) => Console.log(`${r.id}  ${r.stage.padEnd(8)} ${r.title}  (run ${r.runId})`), { discard: true })
    }
    case "approve":
    case "reject": {
      const request = yield* client.RespondToRequest({
        requestId: RequestId.make(id),
        response: command === "approve"
          ? { _tag: "Approve" }
          : { _tag: "Reject", note, ...(option("--to") === undefined ? {} : { to: yield* decodeStage(option("--to")) }) }
      })
      yield* Console.log(`${command}d ${request.stage}`)
      return yield* follow(request.runId)
    }
    case "edit": {
      const file = note
      if (file === "") return yield* Console.error(RUN_USAGE)
      const artifact = yield* fs.readFileString(path.resolve(file)).pipe(Effect.flatMap(Schema.decodeEffect(Json)))
      const request = yield* client.RespondToRequest({ requestId: RequestId.make(id), response: { _tag: "Edit", artifact } })
      yield* Console.log(`edited ${request.stage}`)
      return yield* follow(request.runId)
    }
    default:
      return yield* Console.error(RUN_USAGE)
  }
})
