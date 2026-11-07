import { NodeServices } from "@effect/platform-node"
import {
  MAX_SHORT_SOURCES,
  MIN_SET_SOURCES,
  SourceId,
  type SourceNotFound,
  SourceSetId,
  type VideoSet,
  VideoSetInUse,
  VideoSetInvalid,
  VideoSetNotFound
} from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"
import { Sources } from "../sources/sources.ts"

export interface CreateVideoSetInput {
  // the videos, V1 first
  readonly sourceIds: ReadonlyArray<SourceId>
  // why they belong together; required
  readonly brief: string
  // null or blank = named from the brief
  readonly title?: string | null
}

// Why these videos don't make a set, or null when they do.
export const setProblem = (sourceIds: ReadonlyArray<SourceId>, brief: string): string | null => {
  if (sourceIds.length < MIN_SET_SOURCES) return `a video set needs at least ${MIN_SET_SOURCES} videos`
  if (sourceIds.length > MAX_SHORT_SOURCES) return `a video set can have up to ${MAX_SHORT_SOURCES} videos, not ${sourceIds.length}`
  if (new Set(sourceIds).size !== sourceIds.length) return "each video can be in a set once"
  if (brief.trim() === "") return "a video set needs a brief: what should its shorts achieve?"
  return null
}

const TITLE_LENGTH = 60

// A set's name when you don't give one: the brief's first line, cut at a word near 60 characters.
export const titleFromBrief = (brief: string) => {
  const line = brief.trim().split("\n")[0]!.trim()
  if (line.length <= TITLE_LENGTH) return line
  const cut = line.slice(0, TITLE_LENGTH)
  const space = cut.lastIndexOf(" ")
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[,.;:–-]+$/, "")}…`
}

const SetRow = Schema.Struct({
  id: SourceSetId,
  title: Schema.String,
  brief: Schema.NullOr(Schema.String),
  // its videos in order, from source_set_members (a JSON array)
  source_ids: Schema.fromJsonString(Schema.Array(SourceId)),
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString
})
const toSet = (row: typeof SetRow.Type): VideoSet => ({
  id: row.id,
  title: row.title,
  brief: row.brief ?? "",
  sourceIds: row.source_ids,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

// Video sets: 2–10 of your videos (source_set_members, V1 first) with a brief, plus ~/.viral/sets/<id>/ for the
// set's own work (the set story). A set never owns its videos: deleting it leaves them, and a video in a set
// can't be deleted.
export class VideoSets extends Context.Service<VideoSets, {
  create(input: CreateVideoSetInput): Effect.Effect<VideoSet, VideoSetInvalid | SourceNotFound>
  readonly list: Effect.Effect<ReadonlyArray<VideoSet>>
  get(id: SourceSetId): Effect.Effect<VideoSet, VideoSetNotFound>
  rename(id: SourceSetId, title: string): Effect.Effect<VideoSet, VideoSetNotFound | VideoSetInvalid>
  // false when the set is unknown; refused while shorts made from it exist
  remove(id: SourceSetId): Effect.Effect<boolean, VideoSetInUse>
}>()("@viral/server/video-sets/video-sets/VideoSets") {
  static readonly layer = Layer.effect(
    VideoSets,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem
      const random = yield* SecureRandom.SecureRandom
      const home = yield* ViralHome
      const sources = yield* Sources
      const now = Effect.map(DateTime.now, DateTime.formatIso)

      const withMembers = sql`
        SELECT s.*, (SELECT json_group_array(source_id) FROM (
          SELECT source_id FROM source_set_members m WHERE m.set_id = s.id ORDER BY position
        )) AS source_ids
        FROM source_sets s`
      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SetRow,
        execute: () => sql`${withMembers} ORDER BY s.created_at DESC`
      })
      const findById = SqlSchema.findOneOption({
        Request: SourceSetId,
        Result: SetRow,
        execute: (id) => sql`${withMembers} WHERE s.id = ${id}`
      })

      const get = Effect.fn("VideoSets.get")(function*(id: SourceSetId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (Option.isNone(row)) return yield* new VideoSetNotFound({ id })
        return toSet(row.value)
      })

      const create = Effect.fn("VideoSets.create")(function*(input: CreateVideoSetInput) {
        const problem = setProblem(input.sourceIds, input.brief)
        if (problem !== null) return yield* new VideoSetInvalid({ message: problem })
        yield* Effect.forEach(input.sourceIds, (id) => sources.get(id), { discard: true })
        const brief = input.brief.trim()
        const title = input.title?.trim() || titleFromBrief(brief)
        const id = SourceSetId.make(yield* random.uuidV7())
        const at = yield* now
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`
            INSERT INTO source_sets (id, title, brief, created_at, updated_at)
            VALUES (${id}, ${title}, ${brief}, ${at}, ${at})
          `
          yield* Effect.forEach(input.sourceIds, (sourceId, position) =>
            sql`INSERT INTO source_set_members (set_id, source_id, position) VALUES (${id}, ${sourceId}, ${position})`)
        })).pipe(Effect.orDie)
        return yield* get(id).pipe(Effect.orDie)
      })

      const list = findAll().pipe(Effect.map((rows) => rows.map(toSet)), Effect.orDie)

      const rename = Effect.fn("VideoSets.rename")(function*(id: SourceSetId, title: string) {
        const trimmed = title.trim()
        if (trimmed === "") return yield* new VideoSetInvalid({ message: "a video set needs a name" })
        yield* get(id)
        yield* sql`UPDATE source_sets SET title = ${trimmed}, updated_at = ${yield* now} WHERE id = ${id}`.pipe(Effect.orDie)
        return yield* get(id)
      })

      // Shorts keep a link to their set (set_id) for the set page, so a set with shorts stays until they're gone.
      const remove = Effect.fn("VideoSets.remove")(function*(id: SourceSetId) {
        const [used] = yield* sql<{ readonly shorts: number }>`
          SELECT count(*) AS shorts FROM projects WHERE set_id = ${id}`.pipe(Effect.orDie)
        const shorts = Number(used?.shorts ?? 0)
        if (shorts > 0) {
          return yield* new VideoSetInUse({ id, shorts, message: `used by ${shorts} ${shorts === 1 ? "short" : "shorts"}` })
        }
        const deleted = yield* sql`DELETE FROM source_sets WHERE id = ${id} RETURNING id`.pipe(Effect.orDie)
        if (deleted.length === 0) return false
        yield* fs.remove(home.setDir(id), { recursive: true, force: true }).pipe(Effect.orDie)
        return true
      })

      return VideoSets.of({ create, list, get, rename, remove })
    })
  ).pipe(
    Layer.provide(Sources.layer),
    Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto])
  )
}
