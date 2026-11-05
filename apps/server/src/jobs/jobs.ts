import { Context, Deferred, Effect, Fiber, Layer, Scope } from "effect"

// Tracks running job fibers and pending approvals so any connected client can
// cancel a job or answer an approval, not just the client that started it.
export class Jobs extends Context.Service<Jobs, {
  track(jobId: string, fiber: Fiber.Fiber<unknown, unknown>): Effect.Effect<void, never, Scope.Scope>
  cancel(jobId: string): Effect.Effect<boolean>
  awaitApproval(requestId: string): Effect.Effect<boolean>
  respond(requestId: string, approved: boolean): Effect.Effect<boolean>
}>()("@viral/server/jobs/jobs") {
  static readonly layer = Layer.sync(Jobs, () => {
    const running = new Map<string, Fiber.Fiber<unknown, unknown>>()
    const pending = new Map<string, Deferred.Deferred<boolean>>()

    const track = (jobId: string, fiber: Fiber.Fiber<unknown, unknown>) =>
      Effect.acquireRelease(
        Effect.sync(() => void running.set(jobId, fiber)),
        () => Effect.sync(() => void running.delete(jobId))
      )

    const cancel = Effect.fn("Jobs.cancel")(function*(jobId: string) {
      const fiber = running.get(jobId)
      if (fiber === undefined) return false
      yield* Fiber.interrupt(fiber)
      return true
    })

    const awaitApproval = Effect.fn("Jobs.awaitApproval")(function*(requestId: string) {
      const deferred = yield* Deferred.make<boolean>()
      pending.set(requestId, deferred)
      return yield* Deferred.await(deferred).pipe(
        Effect.ensuring(Effect.sync(() => void pending.delete(requestId)))
      )
    })

    const respond = Effect.fn("Jobs.respond")(function*(requestId: string, approved: boolean) {
      const deferred = pending.get(requestId)
      if (deferred === undefined) return false
      return yield* Deferred.succeed(deferred, approved)
    })

    return Jobs.of({ track, cancel, awaitApproval, respond })
  })
}
