import type { WaitingItem } from "@viral/contracts"
import { Effect, Option } from "effect"
import { Projects, sourcesOf } from "../projects/projects.ts"
import { Sources } from "../sources/sources.ts"
import { RunStore } from "./run-store.ts"

// Every gate waiting for you, with the video and short it belongs to, so the app can show the global list
// and each video's own list from one call.
export const listWaiting = Effect.fn("listWaiting")(function*() {
  const store = yield* RunStore
  const sources = yield* Sources
  const projects = yield* Projects
  const pending = yield* store.listPendingRequests
  return yield* Effect.forEach(pending, (request) =>
    Effect.gen(function*() {
      const run = yield* store.getRun(request.runId)
      if (Option.isNone(run)) return Option.none<WaitingItem>()
      const owner = run.value.owner
      const project = owner._tag === "Project" ? yield* projects.get(owner.id).pipe(Effect.option) : Option.none()
      // a short's gate is listed under its first video (V1)
      const sourceId = owner._tag === "Source" ? Option.some(owner.id) : Option.map(project, (p) => sourcesOf(p)[0])
      if (Option.isNone(sourceId)) return Option.none<WaitingItem>()
      const id = sourceId.value
      const source = yield* sources.get(id).pipe(Effect.option)
      return Option.some<WaitingItem>({
        request,
        owner,
        sourceId: id,
        sourceTitle: Option.match(source, { onNone: () => null, onSome: (s) => s.title }),
        projectId: Option.match(project, { onNone: () => null, onSome: (p) => p.id }),
        projectTitle: Option.match(project, { onNone: () => null, onSome: (p) => p.title }),
        projectNumber: Option.match(project, { onNone: () => null, onSome: (p) => p.number })
      })
    })).pipe(Effect.map((items) => items.flatMap(Option.toArray)))
})
