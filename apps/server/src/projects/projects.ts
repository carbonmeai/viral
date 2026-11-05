import { NodeServices } from "@effect/platform-node"
import {
  MusicTrackId,
  type MusicTrackNotFound,
  PresetId,
  type PresetNotFound,
  type Project,
  ProjectFormat,
  ProjectId,
  ProjectNotFound,
  SourceId,
  type SourceNotFound
} from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { DatabaseLive } from "../persistence/database.ts"
import { Presets } from "../presets/presets.ts"
import { Sources } from "../sources/sources.ts"
import { projectSlug } from "./project-slug.ts"

export interface CreateProjectInput {
  readonly sourceId: SourceId
  readonly title: string
  readonly format: ProjectFormat
  readonly presetId: PresetId | null
  readonly musicTrackId: MusicTrackId | null
}

const ProjectRow = Schema.Struct({
  id: ProjectId,
  source_id: SourceId,
  number: Schema.Int,
  slug: Schema.String,
  title: Schema.String,
  format: ProjectFormat,
  preset_id: Schema.NullOr(PresetId),
  music_track_id: Schema.NullOr(MusicTrackId),
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString
})
const toProject = (row: typeof ProjectRow.Type): Project => ({
  id: row.id,
  sourceId: row.source_id,
  number: row.number,
  slug: row.slug,
  title: row.title,
  format: row.format,
  presetId: row.preset_id,
  musicTrackId: row.music_track_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

// A short made from a source: a row plus ~/.viral/projects/<id>/ for its own artifacts. Shorts are
// numbered per source (01-, 02-…).
export class Projects extends Context.Service<Projects, {
  create(input: CreateProjectInput): Effect.Effect<Project, SourceNotFound | PresetNotFound | MusicTrackNotFound>
  list(sourceId: SourceId | null): Effect.Effect<ReadonlyArray<Project>>
  get(id: ProjectId): Effect.Effect<Project, ProjectNotFound>
  remove(id: ProjectId): Effect.Effect<boolean>
}>()("@viral/server/projects/projects") {
  static readonly layer = Layer.effect(
    Projects,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem
      const random = yield* SecureRandom.SecureRandom
      const home = yield* ViralHome
      const sources = yield* Sources
      const presets = yield* Presets
      const music = yield* MusicLibrary

      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: ProjectRow,
        execute: () => sql`SELECT * FROM projects ORDER BY updated_at DESC`
      })
      const findBySource = SqlSchema.findAll({
        Request: SourceId,
        Result: ProjectRow,
        execute: (sourceId) => sql`SELECT * FROM projects WHERE source_id = ${sourceId} ORDER BY number`
      })
      const findById = SqlSchema.findOneOption({
        Request: ProjectId,
        Result: ProjectRow,
        execute: (id) => sql`SELECT * FROM projects WHERE id = ${id}`
      })
      const nextNumber = SqlSchema.findOne({
        Request: SourceId,
        Result: Schema.Struct({ next: Schema.Int }),
        execute: (sourceId) => sql`SELECT coalesce(max(number), 0) + 1 AS next FROM projects WHERE source_id = ${sourceId}`
      })

      const get = Effect.fn("Projects.get")(function*(id: ProjectId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new ProjectNotFound({ id })
        return toProject(row.value)
      })

      const create = Effect.fn("Projects.create")(function*(input: CreateProjectInput) {
        // Check references up front so callers get a typed error instead of a foreign-key failure.
        yield* sources.get(input.sourceId)
        if (input.presetId !== null) yield* presets.get(input.presetId)
        if (input.musicTrackId !== null) yield* music.get(input.musicTrackId)

        const id = ProjectId.make(yield* random.uuidV7())
        const now = DateTime.formatIso(yield* DateTime.now)
        // Numbering and insert share a transaction so two shorts can't take the same number.
        yield* sql.withTransaction(Effect.gen(function*() {
          const { next } = yield* nextNumber(input.sourceId)
          yield* sql`
            INSERT INTO projects (id, source_id, number, slug, title, format, preset_id, music_track_id, created_at, updated_at)
            VALUES (${id}, ${input.sourceId}, ${next}, ${projectSlug(next, input.title)}, ${input.title}, ${input.format},
                    ${input.presetId}, ${input.musicTrackId}, ${now}, ${now})
          `
        })).pipe(Effect.orDie)
        yield* fs.makeDirectory(home.projectDir(id), { recursive: true }).pipe(Effect.orDie)
        return yield* get(id).pipe(Effect.orDie)
      })

      const list = Effect.fn("Projects.list")(function*(sourceId: SourceId | null) {
        const rows = yield* Option.match(Option.fromNullishOr(sourceId), {
          onNone: () => findAll(),
          onSome: findBySource
        }).pipe(Effect.orDie)
        return rows.map(toProject)
      })

      const remove = Effect.fn("Projects.remove")(function*(id: ProjectId) {
        const deleted = yield* sql`DELETE FROM projects WHERE id = ${id} RETURNING id`
        if (deleted.length === 0) return false
        yield* fs.remove(home.projectDir(id), { recursive: true, force: true })
        return true
      }, Effect.orDie)

      return Projects.of({ create, list, get, remove })
    })
  ).pipe(
    Layer.provide([Sources.layer, Presets.layer, MusicLibrary.layer]),
    Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto])
  )
}
