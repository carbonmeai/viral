import { NodeServices } from "@effect/platform-node"
import type { Storage } from "@viral/contracts"
import { Context, Effect, Layer, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ViralHome } from "../home/viral-home.ts"

// Where the library lives and how much space each part of it takes, for Settings › Storage.
export class StorageReport extends Context.Service<StorageReport, {
  readonly get: Effect.Effect<Storage>
}>()("@viral/server/storage/storage/StorageReport") {
  static readonly layer = Layer.effect(
    StorageReport,
    Effect.gen(function*() {
      const home = yield* ViralHome
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const path = yield* Path.Path

      // `du -sk` is fast even on big video folders; a folder that isn't there yet takes no space
      const bytes = (target: string) =>
        spawner.string(ChildProcess.make("du", ["-sk", target])).pipe(
          Effect.map((out) => Number(out.trim().split(/\s+/)[0] ?? "0") * 1024),
          Effect.map((n) => Number.isFinite(n) ? n : 0),
          Effect.orElseSucceed(() => 0)
        )

      const areas = [
        ["sources", path.join(home.root, "sources")],
        ["projects", path.join(home.root, "projects")],
        ["renders", home.renders],
        ["music", home.music],
        ["sounds", home.sounds],
        ["references", path.join(home.root, "references")],
        ["voice-previews", home.voicePreviews],
        ["database", home.database]
      ] as const

      const get = Effect.forEach(areas, ([name, target]) => Effect.map(bytes(target), (n) => ({ name, path: target, bytes: n })), {
        concurrency: 4
      }).pipe(
        Effect.map((list) => ({ root: home.root, areas: list })),
        Effect.withSpan("StorageReport.get")
      )

      return StorageReport.of({ get })
    })
  ).pipe(Layer.provide([ViralHome.layer, NodeServices.layer]))
}
