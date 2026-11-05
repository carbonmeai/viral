import { NodeServices } from "@effect/platform-node"
import type { ProjectId, SourceId } from "@viral/contracts"
import { Config, Context, Effect, FileSystem, Layer, Path } from "effect"

// Where Viral keeps user data: ~/.viral by default, or $VIRAL_HOME (tests point it at a temp dir).
//   viral.db · sources/<id>/ · projects/<id>/ · music/ · renders/
export class ViralHome extends Context.Service<ViralHome, {
  readonly root: string
  readonly database: string
  readonly music: string
  readonly renders: string
  sourceDir(id: SourceId): string
  projectDir(id: ProjectId): string
}>()("@viral/server/home/viral-home/ViralHome") {
  static readonly layer = Layer.effect(
    ViralHome,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const override = yield* Config.String("VIRAL_HOME").pipe(Config.withDefault(""))
      const root = override !== "" ? override : path.join(yield* Config.String("HOME"), ".viral")
      const dirs = {
        sources: path.join(root, "sources"),
        projects: path.join(root, "projects"),
        music: path.join(root, "music"),
        renders: path.join(root, "renders")
      }
      yield* Effect.forEach(Object.values(dirs), (dir) => fs.makeDirectory(dir, { recursive: true }), {
        discard: true
      })

      return ViralHome.of({
        root,
        database: path.join(root, "viral.db"),
        music: dirs.music,
        renders: dirs.renders,
        sourceDir: (id) => path.join(dirs.sources, id),
        projectDir: (id) => path.join(dirs.projects, id)
      })
    }).pipe(Effect.orDie)
  ).pipe(Layer.provide(NodeServices.layer))
}
