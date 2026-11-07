import { NodeServices } from "@effect/platform-node"
import { type Source, SourceId, SourceInUse, SourceNotFound, SourceOrigin, SourceRights } from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"

// What the source stage learns about the video once it has it.
export interface SourceMetadata {
  readonly title: string | null
  readonly channel: string | null
  readonly url: string | null
  readonly durationS: number
}

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
  setDetails(id: SourceId, title: string | null, channel: string | null): Effect.Effect<Source, SourceNotFound>
  // What fetching found; it fills in a title or channel only where none is set, so yours are kept
  recordMetadata(id: SourceId, metadata: SourceMetadata): Effect.Effect<void>
  // false when the source is unknown; refused while shorts or video sets use it
  remove(id: SourceId): Effect.Effect<boolean, SourceInUse>
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

      const setDetails = Effect.fn("Sources.setDetails")(function*(id: SourceId, title: string | null, channel: string | null) {
        const now = DateTime.formatIso(yield* DateTime.now)
        const clean = (value: string | null) => value === null || value.trim() === "" ? null : value.trim()
        yield* sql`UPDATE sources SET title = ${clean(title)}, channel = ${clean(channel)}, updated_at = ${now} WHERE id = ${id}`
          .pipe(Effect.orDie)
        return yield* get(id)
      })

      const recordMetadata = Effect.fn("Sources.recordMetadata")(function*(id: SourceId, metadata: SourceMetadata) {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          UPDATE sources
          SET title = coalesce(title, ${metadata.title}), channel = coalesce(channel, ${metadata.channel}), url = ${metadata.url},
              duration_s = ${metadata.durationS}, updated_at = ${now}
          WHERE id = ${id}
        `
      }, Effect.orDie)

      // A video a short or a video set uses is never deleted from under it (the database refuses too): delete
      // those first. The source's own runs and artifacts go with it, and so does its folder.
      const remove = Effect.fn("Sources.remove")(function*(id: SourceId) {
        const [used] = yield* sql<{ readonly shorts: number; readonly sets: number }>`
          SELECT (SELECT count(*) FROM project_sources WHERE source_id = ${id}) AS shorts,
                 (SELECT count(*) FROM source_set_members WHERE source_id = ${id}) AS sets`.pipe(Effect.orDie)
        const shorts = Number(used?.shorts ?? 0)
        const sets = Number(used?.sets ?? 0)
        if (shorts > 0 || sets > 0) {
          const uses = [
            shorts > 0 ? `${shorts} ${shorts === 1 ? "short" : "shorts"}` : null,
            sets > 0 ? `${sets} video ${sets === 1 ? "set" : "sets"}` : null
          ].filter((x) => x !== null)
          return yield* new SourceInUse({ id, shorts, sets, message: `used by ${uses.join(" and ")}` })
        }
        const deleted = yield* sql`DELETE FROM sources WHERE id = ${id} RETURNING id`.pipe(Effect.orDie)
        if (deleted.length === 0) return false
        yield* fs.remove(home.sourceDir(id), { recursive: true, force: true }).pipe(Effect.orDie)
        return true
      })

      return Sources.of({ create, list, get, setRights, setDetails, recordMetadata, remove })
    })
  ).pipe(Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto]))
}
