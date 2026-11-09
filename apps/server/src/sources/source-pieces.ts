import { NodeServices } from "@effect/platform-node"
import type { PiecesBySource, Source, SourceId, SourcePiece } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Semaphore } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { ScriptRunner } from "../script-runner/script-runner.ts"
import { piecesFor, type Range, uncovered, wantedRanges } from "./piece-ranges.ts"
import { FetchedSource } from "./source-fetcher.ts"

// Reports progress: a percentage (null when unknown) and an optional message for the person watching.
type Progress = (pct: number | null, message?: string) => Effect.Effect<void>

// What a short gets for one of its videos: nothing to do for a full download or your own file (`scan` false);
// for a scan, the full-quality pieces covering the stretches asked for, or why they couldn't all be fetched.
export interface SourceFootage {
  readonly scan: boolean
  readonly pieces: ReadonlyArray<SourcePiece>
  // the pieces' height (1080 when YouTube has it) and the scan's (480)
  readonly height: number | null
  readonly scanHeight: number | null
  // in plain words; null when every stretch is covered
  readonly problem: string | null
}

// One of a short's videos, by its position in the short (V1 = 0), and the stretches its clips play.
export interface ShortVideo {
  readonly index: number
  readonly source: Source
  readonly ranges: ReadonlyArray<Range>
}

export interface ShortFootage {
  // for the render plan; absent when no video is a scan or nothing could be fetched
  readonly piecesBySource: PiecesBySource | undefined
  // the scanned videos only, by position
  readonly videos: ReadonlyArray<SourceFootage & { readonly index: number; readonly source: Source }>
}

const PieceRecord = Schema.Struct({
  // its name in the pieces folder
  file: Schema.String,
  start: Schema.Finite,
  end: Schema.Finite,
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int)
})
type PieceRecord = typeof PieceRecord.Type
const IndexJson = Schema.fromJsonString(Schema.Struct({ pieces: Schema.Array(PieceRecord) }))

const Line = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), pct: Schema.Finite }),
  Schema.Struct({ type: Schema.Literal("log"), message: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("piece"),
    path: Schema.String,
    start: Schema.Finite,
    end: Schema.Finite,
    width: Schema.NullOr(Schema.Int),
    height: Schema.NullOr(Schema.Int)
  }),
  Schema.Struct({ type: Schema.Literal("done"), pieces: Schema.Int })
]))

const plainProblem = (code: string, message: string) =>
  code === "blocked"
    ? "YouTube refused the 1080p pieces twice (403)"
    : `the 1080p pieces couldn't be fetched (${message.split("\n").find((l) => l.trim() !== "")?.trim().slice(0, 160) ?? code})`

// The full-quality pieces of the videos read from a 480p scan (found by research): when a short is rendered, only
// the seconds it plays are fetched in 1080p, a second of padding either side, one yt-dlp request per video with all
// its stretches, into ~/.viral/sources/<id>/pieces/ (pieces.json lists them). Pieces are kept and reused by later
// renders and other shorts. A video that isn't a scan is left alone. Fetching never fails a render: what couldn't be
// fetched plays from the scan, and `problem` says so.
export class SourcePieces extends Context.Service<SourcePieces, {
  forSource(source: Source, ranges: ReadonlyArray<Range>, progress: Progress): Effect.Effect<SourceFootage>
  forShort(videos: ReadonlyArray<ShortVideo>, progress: Progress): Effect.Effect<ShortFootage>
}>()("@viral/server/sources/source-pieces/SourcePieces") {
  static readonly layer = Layer.effect(
    SourcePieces,
    Effect.gen(function*() {
      const artifacts = yield* Artifacts
      const scripts = yield* ScriptRunner
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      // one fetch at a time: two renders never download the same stretch twice
      const one = yield* Semaphore.make(1)

      const dirOf = (id: SourceId) => path.join(home.sourceDir(id), "pieces")
      const readIndex = (dir: string) =>
        fs.readFileString(path.join(dir, "pieces.json")).pipe(
          Effect.flatMap(Schema.decodeEffect(IndexJson)),
          Effect.map((index) => index.pieces),
          Effect.orElseSucceed((): ReadonlyArray<PieceRecord> => [])
        )
      const writeIndex = (dir: string, pieces: ReadonlyArray<PieceRecord>) =>
        Schema.encodeEffect(IndexJson)({ pieces: pieces.toSorted((a, b) => a.start - b.start) }).pipe(
          Effect.flatMap((json) => fs.writeFileString(path.join(dir, "pieces.json"), json)),
          Effect.orDie
        )

      const fetchPieces = Effect.fn("SourcePieces.fetchPieces")(
        function*(url: string, dir: string, scan: string, ranges: ReadonlyArray<Range>, progress: Progress) {
          const got: Array<PieceRecord> = []
          const result = yield* scripts.run(
            [
              path.join(import.meta.dirname, "fetch-pieces.py"),
              "--url",
              url,
              "--out-dir",
              dir,
              "--scan",
              scan,
              ...ranges.flatMap((r) => ["--section", `${r.start}-${r.end}`])
            ],
            Schema.decodeEffect(Line),
            (line): Effect.Effect<true | undefined> => {
              switch (line.type) {
                case "progress":
                  return progress(line.pct).pipe(Effect.as(undefined))
                case "log":
                  return progress(null, line.message).pipe(Effect.as(undefined))
                case "piece":
                  return Effect.sync(() => {
                    got.push({ file: path.basename(line.path), start: line.start, end: line.end, width: line.width, height: line.height })
                    return undefined
                  })
                case "done":
                  return Effect.succeed(true)
              }
            }
          ).pipe(
            Effect.as(null),
            Effect.catch((error) => Effect.succeed(plainProblem(error.code, error.message)))
          )
          return { got, problem: result }
        }
      )

      const forSource = Effect.fn("SourcePieces.forSource")(function*(source: Source, ranges: ReadonlyArray<Range>, progress: Progress) {
        const owner = { _tag: "Source", id: source.id } as const
        const artifact = yield* artifacts.latest(owner, "source-video")
        const fetched = Option.flatMap(artifact, (a) => Schema.decodeUnknownOption(FetchedSource)(a.data))
        const scanFile = Option.flatMapNullishOr(artifact, artifacts.resolve)
        const none: SourceFootage = { scan: false, pieces: [], height: null, scanHeight: null, problem: null }
        if (Option.isNone(fetched) || fetched.value.scan !== true || Option.isNone(scanFile)) return none
        const scanHeight = fetched.value.height
        const url = source.url ?? (source.origin._tag === "Url" ? source.origin.url : null)
        const wanted = wantedRanges(ranges, source.durationS ?? fetched.value.duration_s)
        const dir = dirOf(source.id)
        return yield* one.withPermits(1)(Effect.gen(function*() {
          yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
          // a piece whose file went missing doesn't count
          const known = yield* Effect.filter(yield* readIndex(dir), (p) => fs.exists(path.join(dir, p.file)).pipe(Effect.orElseSucceed(() => false)))
          const missing = uncovered(wanted, known)
          let problem: string | null = null
          let all = known
          if (missing.length > 0) {
            if (url === null) {
              problem = "the video has no link to fetch the 1080p pieces from"
            } else {
              const seconds = missing.reduce((t, r) => t + r.end - r.start, 0)
              yield* progress(null, `fetching ${missing.length} ${missing.length === 1 ? "stretch" : "stretches"} (${Math.round(seconds)}s) of "${source.title ?? "the video"}" in 1080p`)
              const fetchedNow = yield* fetchPieces(url, dir, scanFile.value, missing, progress)
              all = [...known.filter((k) => !fetchedNow.got.some((g) => g.file === k.file)), ...fetchedNow.got]
              yield* writeIndex(dir, all)
              problem = fetchedNow.problem
              if (problem === null && uncovered(wanted, all).length > 0) problem = "some of the 1080p pieces didn't arrive"
            }
          }
          const used = piecesFor(wanted, all)
          return {
            scan: true,
            pieces: used.map((p) => ({ path: path.join(dir, p.file), start: p.start, end: p.end })),
            height: used.reduce<number | null>((h, p) => p.height === null ? h : Math.max(h ?? 0, p.height), null),
            scanHeight,
            problem
          } satisfies SourceFootage
        }))
      })

      const forShort = Effect.fn("SourcePieces.forShort")(function*(videos: ReadonlyArray<ShortVideo>, progress: Progress) {
        const results = yield* Effect.forEach(videos, (v) =>
          Effect.map(forSource(v.source, v.ranges, progress), (footage) => ({ ...footage, index: v.index, source: v.source })))
        const scanned = results.filter((r) => r.scan)
        const withPieces = scanned.filter((r) => r.pieces.length > 0)
        return {
          piecesBySource: withPieces.length === 0 ? undefined : Object.fromEntries(withPieces.map((r) => [String(r.index), r.pieces])),
          videos: scanned
        } satisfies ShortFootage
      })

      return SourcePieces.of({ forSource, forShort })
    })
  ).pipe(Layer.provide([Artifacts.layer, ScriptRunner.layer, ViralHome.layer, NodeServices.layer]))
}
