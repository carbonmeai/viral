import { NodeServices } from "@effect/platform-node"
import { MusicBed, type MusicTrackId, type MusicTrackNotFound, type ProjectId, type ProjectNotFound, type Run } from "@viral/contracts"
import { Context, Effect, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Projects } from "../projects/projects.ts"
import { RunManager } from "../runs/run-manager.ts"
import { Settings } from "../settings/settings.ts"
import { dropWordKey } from "./music-bed-settings.ts"

// A short's fitted music bed: reading it, and changing the song or the drop word, which fits a new bed by
// re-running the short from assemble. The library song is never changed.
export class MusicBeds extends Context.Service<MusicBeds, {
  // the bed and its file as the media route serves it, or null when the short has no music
  get(projectId: ProjectId): Effect.Effect<{ readonly bed: MusicBed; readonly media: string } | null, ProjectNotFound>
  // sets the song (null: no music) and, when given, the drop word (null: back to the start of the last narrated
  // line), then re-runs the short from assemble so a new bed is fitted
  refit(
    projectId: ProjectId,
    trackId: MusicTrackId | null,
    dropWord: number | null | undefined
  ): Effect.Effect<Run, ProjectNotFound | MusicTrackNotFound>
}>()("@viral/server/music-bed/music-beds/MusicBeds") {
  static readonly layer = Layer.effect(
    MusicBeds,
    Effect.gen(function*() {
      const projects = yield* Projects
      const artifacts = yield* Artifacts
      const home = yield* ViralHome
      const path = yield* Path.Path
      const settings = yield* Settings
      const runs = yield* RunManager

      const get = Effect.fn("MusicBeds.get")(function*(projectId: ProjectId) {
        const project = yield* projects.get(projectId)
        // a short whose music was removed keeps its old beds as history; it plays none
        if (project.musicTrackId === null) return null
        const latest = yield* artifacts.latest({ _tag: "Project", id: projectId }, "music-bed")
        if (Option.isNone(latest)) return null
        const bed = Schema.decodeUnknownOption(MusicBed)(latest.value.data)
        const file = artifacts.resolve(latest.value)
        if (Option.isNone(bed) || file === null) return null
        return { bed: bed.value, media: path.relative(home.root, file) }
      })

      const refit = Effect.fn("MusicBeds.refit")(function*(
        projectId: ProjectId,
        trackId: MusicTrackId | null,
        dropWord: number | null | undefined
      ) {
        yield* projects.setMusic(projectId, trackId)
        if (dropWord === null) yield* settings.remove(dropWordKey(projectId))
        else if (dropWord !== undefined) yield* settings.set(dropWordKey(projectId), dropWord)
        // assemble is where the bed is fitted; everything after it (render, metadata, thumbnail) follows
        return yield* runs.start({ _tag: "Project", id: projectId }, "assemble").pipe(Effect.orDie)
      })

      return MusicBeds.of({ get, refit })
    })
  ).pipe(Layer.provide([Projects.layer, Artifacts.layer, ViralHome.layer, Settings.layer, NodeServices.layer]))
}
