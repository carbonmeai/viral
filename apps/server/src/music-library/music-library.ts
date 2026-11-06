import { NodeServices } from "@effect/platform-node"
import {
  BeatSource,
  type MusicAnalysisError,
  type MusicTrack,
  MusicFileUnreadable,
  MusicTrackId,
  MusicTrackNotFound,
  MusicTrackOrigin,
  ReferenceVideoId,
  Rights
} from "@viral/contracts"
import { Context, DateTime, Effect, FiberSet, FileSystem, Layer, Path, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"
import { TrackAnalyser } from "./track-analyser.ts"

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
  beat_source: Schema.NullOr(BeatSource),
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
  beatSource: row.beat_source,
  loudnessLufs: row.loudness_lufs,
  analyzedAt: row.analyzed_at,
  createdAt: row.created_at
})

// Tracks you supply. Each file is copied into ~/.viral/music/<id><ext> so a short never depends on the
// original location. Adding a track analyses it in the background (tempo, drop, loudness); a tempo and drop you
// set by hand (SetMusicTrackBeat) win over analysis and are never overwritten by it.
export class MusicLibrary extends Context.Service<MusicLibrary, {
  add(file: string, title: string | null, rights: Rights): Effect.Effect<MusicTrack, MusicFileUnreadable>
  setRights(id: MusicTrackId, rights: Rights): Effect.Effect<MusicTrack, MusicTrackNotFound>
  setBeat(id: MusicTrackId, bpm: number, dropS: number): Effect.Effect<MusicTrack, MusicTrackNotFound>
  analyse(id: MusicTrackId): Effect.Effect<MusicTrack, MusicTrackNotFound | MusicAnalysisError>
  readonly list: Effect.Effect<ReadonlyArray<MusicTrack>>
  get(id: MusicTrackId): Effect.Effect<MusicTrack, MusicTrackNotFound>
  remove(id: MusicTrackId): Effect.Effect<boolean>
}>()("@viral/server/music-library/music-library/MusicLibrary") {
  // Needs a TrackAnalyser; `layer` provides the real one, tests a replay.
  static readonly make = Effect.gen(function*() {
      const analyser = yield* TrackAnalyser
      // background analyses belong to the library: closing it interrupts them (and their script)
      const background = yield* FiberSet.make()
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
        // the add doesn't wait for it, and a track that can't be analysed is still in the library
        yield* FiberSet.run(background, analyse(id).pipe(
          Effect.catchCause((cause) => Effect.logWarning("couldn't analyse a music track", { id, cause }))
        ))
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

      const setBeat = Effect.fn("MusicLibrary.setBeat")(function*(id: MusicTrackId, bpm: number, dropS: number) {
        yield* sql`UPDATE music_tracks SET bpm = ${bpm}, drop_s = ${dropS}, beat_source = 'manual' WHERE id = ${id}`
          .pipe(Effect.orDie)
        return yield* get(id)
      })

      // Length and loudness are always refreshed; tempo and drop only when you haven't set them yourself.
      const analyse: (id: MusicTrackId) => Effect.Effect<MusicTrack, MusicTrackNotFound | MusicAnalysisError> = Effect.fn(
        "MusicLibrary.analyse"
      )(function*(id: MusicTrackId) {
        const track = yield* get(id)
        const result = yield* analyser.analyse(path.join(home.music, track.path))
        const now = DateTime.formatIso(yield* DateTime.now)
        const source = result.bpm === null && result.dropS === null ? null : "analysis"
        yield* sql`
          UPDATE music_tracks SET
            duration_s = ${result.durationS},
            loudness_lufs = ${result.loudnessLufs},
            analyzed_at = ${now},
            bpm = CASE WHEN beat_source = 'manual' THEN bpm ELSE ${result.bpm} END,
            drop_s = CASE WHEN beat_source = 'manual' THEN drop_s ELSE ${result.dropS} END,
            beat_source = CASE WHEN beat_source = 'manual' THEN 'manual' ELSE ${source} END
          WHERE id = ${id}
        `.pipe(Effect.orDie)
        yield* Effect.logInfo("analysed a music track", { id, ...result })
        return yield* get(id)
      })

      return MusicLibrary.of({ add, setRights, setBeat, analyse, list, get, remove })
    })

  static readonly layer = Layer.effect(MusicLibrary, MusicLibrary.make).pipe(
    Layer.provide([TrackAnalyser.layer, DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto])
  )
}
