import type { JobEvent } from "@viral/contracts"
import { Console, Effect, Stream } from "effect"
import * as readline from "node:readline/promises"
import { flag, option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { printEvent } from "./print-event.ts"

export const JOB_USAGE = `  run <job-id> [--approve|--reject] [--seconds N]
  approve <request-id> | reject <request-id>
  cancel <job-id>`

const ask = (question: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => readline.createInterface({ input: process.stdin, output: process.stdout })),
    (rl) => Effect.promise(() => rl.question(question)),
    (rl) => Effect.sync(() => rl.close())
  )

// Spike pipeline commands; these become project runs in step 6.
export const jobCommand = Effect.fn("jobCommand")(function*() {
  const client = yield* Client
  const [command, target = "job-1"] = positionals

  const answer = Effect.fn("answer")(function*(requestId: string) {
    const approved = flag("--approve") ? true : flag("--reject") ? false : (yield* ask("approve? [y/N] ")) === "y"
    yield* client.Respond({ requestId, approved })
  })

  const show = printEvent()
  const print = (event: JobEvent) =>
    event._tag === "ApprovalRequested"
      ? Console.log(`? ${event.title} (${event.requestId})`).pipe(Effect.andThen(answer(event.requestId)))
      : show(event)

  switch (command) {
    case "run":
      return yield* client.StartJob({ jobId: target, renderSeconds: Number(option("--seconds") ?? 20) }).pipe(
        Stream.runForEach(print)
      )
    case "approve":
    case "reject":
      return yield* Console.log(yield* client.Respond({ requestId: target, approved: command === "approve" }))
    case "cancel":
      return yield* Console.log(`cancelled: ${yield* client.CancelJob({ jobId: target })}`)
    default:
      return yield* Console.error(JOB_USAGE)
  }
})
