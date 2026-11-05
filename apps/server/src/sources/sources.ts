import { NodeServices } from "@effect/platform-node"
import { ProjectId, type Source, SourceId, SourceNotFound, SourceOrigin, SourceRights } from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"

export interface CreateSourceInput {
  readonly origin: SourceOrigin
  readonly rights: SourceRights
  readonly rightsNote: string | null
}

const OriginJson = Schema.fromJsonString(SourceOrigin)

const SourceRow = Schema.Struct({
  id: SourceId,
  origin: OriginJson,
  title: Schema.NullOr(Schema.String),
  channel: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  duration_s: Schema.NullOr(Schema.Finite),
  rights: SourceRights,
  rights_note: Schema.NullOr(Schema.String),
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString
})
const toSource = (row: typeof SourceRow.Type): Source => ({
  id: row.id,
  origin: row.origin,
  title: row.title,
  channel: row.channel,
  url: row.url,
  durationS: row.duration_s,
  rights: row.rights,
  rightsNote: row.rights_note,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

// A long video: a row plus ~/.viral/sources/<id>/, which holds the media and video-level artifacts
// shared by every short made from it.
export class Sources extends Context.Service<Sources, {
  create(input: CreateSourceInput): Effect.Effect<Source>
  readonly list: Effect.Effect<ReadonlyArray<Source>>
  get(id: SourceId): Effect.Effect<Source, SourceNotFound>
  setRights(id: SourceId, rights: SourceRights, rightsNote: string | null): Effect.Effect<Source, SourceNotFound>
  remove(id: SourceId): Effect.Effect<boolean>
}>()("@viral/server/sources/sources") {
  static readonly layer = Layer.effect(
    Sources,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem
      const random = yield* SecureRandom.SecureRandom
      const home = yield* ViralHome

      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SourceRow,
        execute: () => sql`SELECT * FROM sources ORDER BY created_at DESC`
      })
      const findById = SqlSchema.findOneOption({
        Request: SourceId,
        Result: SourceRow,
        execute: (id) => sql`SELECT * FROM sources WHERE id = ${id}`
      })

      const get = Effect.fn("Sources.get")(function*(id: SourceId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new SourceNotFound({ id })
        return toSource(row.value)
      })

      const create = Effect.fn("Sources.create")(function*(input: CreateSourceInput) {
        const id = SourceId.make(yield* random.uuidV7())
        const now = DateTime.formatIso(yield* DateTime.now)
        const origin = yield* Schema.encodeEffect(OriginJson)(input.origin)
        yield* fs.makeDirectory(home.sourceDir(id), { recursive: true })
        yield* sql`
          INSERT INTO sources (id, origin, rights, rights_note, created_at, updated_at)
          VALUES (${id}, ${origin}, ${input.rights}, ${input.rightsNote}, ${now}, ${now})
        `
        return yield* get(id)
      }, Effect.orDie)

      const list = findAll().pipe(
        Effect.map((rows) => rows.map(toSource)),
        Effect.orDie,
        Effect.withSpan("Sources.list")
      )

      const setRights = Effect.fn("Sources.setRights")(
        function*(id: SourceId, rights: SourceRights, rightsNote: string | null) {
          const now = DateTime.formatIso(yield* DateTime.now)
          yield* sql`UPDATE sources SET rights = ${rights}, rights_note = ${rightsNote}, updated_at = ${now} WHERE id = ${id}`
            .pipe(Effect.orDie)
          return yield* get(id)
        }
      )

      // The database cascades to the source's shorts; their folders are removed here too.
      const remove = Effect.fn("Sources.remove")(function*(id: SourceId) {
        const projects = yield* sql<{ readonly id: string }>`SELECT id FROM projects WHERE source_id = ${id}`
        const deleted = yield* sql`DELETE FROM sources WHERE id = ${id} RETURNING id`
        if (deleted.length === 0) return false
        const dirs = [home.sourceDir(id), ...projects.map((p) => home.projectDir(ProjectId.make(p.id)))]
        yield* Effect.forEach(dirs, (dir) => fs.remove(dir, { recursive: true, force: true }), { discard: true })
        return true
      }, Effect.orDie)

      return Sources.of({ create, list, get, setRights, remove })
    })
  ).pipe(Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto]))
}
