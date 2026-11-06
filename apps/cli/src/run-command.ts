import { RequestId, RunId } from "@viral/contracts"
import { Console, Effect, Stream } from "effect"
import { positionals } from "./args.ts"
import { Client } from "./client.ts"
import { printUpdate } from "./print-event.ts"

export const RUN_USAGE = `  follow <run-id> | cancel <run-id> | resume <run-id>
  requests | approve <request-id> | reject <request-id> "<note>"`

// Prints a run's updates until it finishes or stops at a gate you need to answer.
export const follow = Effect.fn("follow")(function*(runId: RunId) {
  const client = yield* Client
  const print = printUpdate()
  yield* client.SubscribeRun({ runId, afterSeq: 0 }).pipe(
    Stream.tap(print),
    Stream.takeUntil((u) => u._tag === "Event" && u.event._tag === "RequestRaised"),
    Stream.runDrain
  )
})

export const runCommand = Effect.fn("runCommand")(function*() {
  const client = yield* Client
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
        response: command === "approve" ? { _tag: "Approve" } : { _tag: "Reject", note }
      })
      yield* Console.log(`${command}d ${request.stage}`)
      return yield* follow(request.runId)
    }
    default:
      return yield* Console.error(RUN_USAGE)
  }
})
