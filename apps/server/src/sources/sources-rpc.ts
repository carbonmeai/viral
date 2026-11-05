import { type JobEvent, SourcesRpcs } from "@viral/contracts"
import { Effect, Queue, Stream } from "effect"
import { SourceStages } from "./source-stages.ts"
import { Sources } from "./sources.ts"

export const SourcesRpcLive = SourcesRpcs.toLayer(Effect.gen(function*() {
  const sources = yield* Sources
  const stages = yield* SourceStages
  return SourcesRpcs.of({
    CreateSource: (input) => sources.create(input),
    ListSources: () => sources.list,
    GetSource: ({ id }) => sources.get(id),
    SetSourceRights: ({ id, rights, rightsNote }) => sources.setRights(id, rights, rightsNote),
    // The stage runs in a fiber owned by the stream, so a client disconnect stops it and its processes.
    RunSourceStage: ({ id, stage, force }) =>
      Stream.callback<JobEvent>((queue) =>
        Effect.gen(function*() {
          const emit = (event: JobEvent) => Queue.offer(queue, event).pipe(Effect.asVoid)
          yield* stages.run(id, stage, force, emit).pipe(
            Effect.catchTags({
              SourceNotFound: (error) => emit({ _tag: "Failed", message: `no source ${error.id}` }),
              SourceStageError: (error) => emit({ _tag: "Failed", message: `${error.stage} (${error.code}): ${error.message}` })
            }),
            Effect.onInterrupt(() => emit({ _tag: "Cancelled" })),
            Effect.ensuring(Queue.end(queue)),
            Effect.forkScoped
          )
        })
      ),
    DeleteSource: ({ id }) => sources.remove(id)
  })
}))
