import { NodeServices } from "@effect/platform-node"
import {
  type MusicTrack,
  MusicFileUnreadable,
  MusicTrackId,
  MusicTrackNotFound,
  MusicTrackOrigin,
  ReferenceVideoId,
  Rights
} from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"

const OriginJson = Schema.fromJsonString(MusicTrackOrigin)

const TrackRow = Schema.Struct({
  id: MusicTrackId,
  title: Schema.String,
  path: Schema.String,
  origin: OriginJson,
  rights: Rights,
  reference_id: Schema.NullOr(ReferenceVideoId),
  duration_s: Schema.NullOr(Schema.Finite),
  bpm: Schema.NullOr(Schema.Finite),
  drop_s: Schema.NullOr(Schema.Finite),
  loudness_lufs: Schema.NullOr(Schema.Finite),
  analyzed_at: Schema.NullOr(Schema.DateTimeUtcFromString),
  created_at: Schema.DateTimeUtcFromString
})
const toTrack = (row: typeof TrackRow.Type): MusicTrack => ({
  id: row.id,
  title: row.title,
  path: row.path,
  origin: row.origin,
  rights: row.rights,
  referenceId: row.reference_id,
  durationS: row.duration_s,
  bpm: row.bpm,
  dropS: row.drop_s,
  loudnessLufs: row.loudness_lufs,
  analyzedAt: row.analyzed_at,
  createdAt: row.created_at
})

// Tracks you supply. Each file is copied into ~/.viral/music/<id><ext> so a short never depends on the
// original location. BPM and drop are filled in later by the music stage's analysis.
export class MusicLibrary extends Context.Service<MusicLibrary, {
  add(file: string, title: string | null, rights: Rights): Effect.Effect<MusicTrack, MusicFileUnreadable>
  setRights(id: MusicTrackId, rights: Rights): Effect.Effect<MusicTrack, MusicTrackNotFound>
  readonly list: Effect.Effect<ReadonlyArray<MusicTrack>>
  get(id: MusicTrackId): Effect.Effect<MusicTrack, MusicTrackNotFound>
  remove(id: MusicTrackId): Effect.Effect<boolean>
}>()("@viral/server/music-library/music-library/MusicLibrary") {
  static readonly layer = Layer.effect(
    MusicLibrary,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const random = yield* SecureRandom.SecureRandom
      const home = yield* ViralHome

      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: TrackRow,
        execute: () => sql`SELECT * FROM music_tracks ORDER BY created_at DESC`
      })
      const findById = SqlSchema.findOneOption({
        Request: MusicTrackId,
        Result: TrackRow,
        execute: (id) => sql`SELECT * FROM music_tracks WHERE id = ${id}`
      })

      const get = Effect.fn("MusicLibrary.get")(function*(id: MusicTrackId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new MusicTrackNotFound({ id })
        return toTrack(row.value)
      })

      const add = Effect.fn("MusicLibrary.add")(function*(file: string, title: string | null, rights: Rights) {
        const unreadable = (message: string) => new MusicFileUnreadable({ file, message })
        const info = yield* fs.stat(file).pipe(Effect.mapError((error) => unreadable(error.message)))
        if (info.type !== "File") return yield* unreadable("not a file")

        const id = MusicTrackId.make(yield* random.uuidV7())
        const stored = `${id}${path.extname(file).toLowerCase()}`
        yield* fs.copyFile(file, path.join(home.music, stored)).pipe(Effect.mapError((error) => unreadable(error.message)))
        const now = DateTime.formatIso(yield* DateTime.now)
        const origin = yield* Schema.encodeEffect(OriginJson)({ _tag: "Upload", file }).pipe(Effect.orDie)
        yield* sql`
          INSERT INTO music_tracks (id, title, path, origin, rights, created_at)
          VALUES (${id}, ${title ?? path.basename(file, path.extname(file))}, ${stored}, ${origin}, ${rights}, ${now})
        `.pipe(Effect.orDie)
        return yield* get(id).pipe(Effect.orDie)
      })

      const list = findAll().pipe(
        Effect.map((rows) => rows.map(toTrack)),
        Effect.orDie,
        Effect.withSpan("MusicLibrary.list")
      )

      const remove = Effect.fn("MusicLibrary.remove")(function*(id: MusicTrackId) {
        const deleted = yield* sql<{ readonly path: string }>`DELETE FROM music_tracks WHERE id = ${id} RETURNING path`
        const [track] = deleted
        if (track === undefined) return false
        yield* fs.remove(path.join(home.music, track.path), { force: true })
        return true
      }, Effect.orDie)

      const setRights = Effect.fn("MusicLibrary.setRights")(function*(id: MusicTrackId, rights: Rights) {
        yield* sql`UPDATE music_tracks SET rights = ${rights} WHERE id = ${id}`.pipe(Effect.orDie)
        return yield* get(id)
      })

      return MusicLibrary.of({ add, setRights, list, get, remove })
    })
  ).pipe(Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto]))
}
