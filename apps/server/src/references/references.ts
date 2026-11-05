import { NodeServices } from "@effect/platform-node"
import { type ReferenceVideo, ReferenceVideoId, ReferenceVideoNotFound } from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"

const ReferenceRow = Schema.Struct({
  id: ReferenceVideoId,
  url: Schema.String,
  platform: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  creator: Schema.NullOr(Schema.String),
  duration_s: Schema.NullOr(Schema.Finite),
  notes: Schema.NullOr(Schema.String),
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString
})
const toReference = (row: typeof ReferenceRow.Type): ReferenceVideo => ({
  id: row.id,
  url: row.url,
  platform: row.platform,
  title: row.title,
  creator: row.creator,
  durationS: row.duration_s,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

// The platform, from the link, so references can be grouped before they are fetched.
const platformOf = (url: string): string | null => {
  const host = URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : ""
  if (host.endsWith("tiktok.com")) return "tiktok"
  if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube"
  if (host.endsWith("instagram.com")) return "instagram"
  return null
}

// Viral videos kept to learn from: a row plus ~/.viral/references/<id>/ for the download and its
// analysis. Fetching and analysing come with the references step.
export class References extends Context.Service<References, {
  create(url: string, notes: string | null): Effect.Effect<ReferenceVideo>
  readonly list: Effect.Effect<ReadonlyArray<ReferenceVideo>>
  get(id: ReferenceVideoId): Effect.Effect<ReferenceVideo, ReferenceVideoNotFound>
  remove(id: ReferenceVideoId): Effect.Effect<boolean>
}>()("@viral/server/references/references") {
  static readonly layer = Layer.effect(
    References,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem
      const random = yield* SecureRandom.SecureRandom
      const home = yield* ViralHome

      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: ReferenceRow,
        execute: () => sql`SELECT * FROM reference_videos ORDER BY created_at DESC`
      })
      const findById = SqlSchema.findOneOption({
        Request: ReferenceVideoId,
        Result: ReferenceRow,
        execute: (id) => sql`SELECT * FROM reference_videos WHERE id = ${id}`
      })

      const get = Effect.fn("References.get")(function*(id: ReferenceVideoId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new ReferenceVideoNotFound({ id })
        return toReference(row.value)
      })

      const create = Effect.fn("References.create")(function*(url: string, notes: string | null) {
        const id = ReferenceVideoId.make(yield* random.uuidV7())
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* fs.makeDirectory(home.referenceDir(id), { recursive: true })
        yield* sql`
          INSERT INTO reference_videos (id, url, platform, notes, created_at, updated_at)
          VALUES (${id}, ${url}, ${platformOf(url)}, ${notes}, ${now}, ${now})
        `
        return yield* get(id)
      }, Effect.orDie)

      const list = findAll().pipe(
        Effect.map((rows) => rows.map(toReference)),
        Effect.orDie,
        Effect.withSpan("References.list")
      )

      const remove = Effect.fn("References.remove")(function*(id: ReferenceVideoId) {
        const deleted = yield* sql`DELETE FROM reference_videos WHERE id = ${id} RETURNING id`
        if (deleted.length === 0) return false
        yield* fs.remove(home.referenceDir(id), { recursive: true, force: true })
        return true
      }, Effect.orDie)

      return References.of({ create, list, get, remove })
    })
  ).pipe(Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto]))
}
