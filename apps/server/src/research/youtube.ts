import { NodeServices } from "@effect/platform-node"
import { RESEARCH_SEARCH_RESULTS } from "@viral/contracts"
import { Clock, Config, Context, Duration, Effect, Fiber, FileSystem, Layer, Path, Schema, Semaphore, Stream } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { captionsExcerpt, classifyFailure, parseDetails, parseSearch, type RefusalKind, type VideoDetails, type VideoFound } from "./youtube-values.ts"

// A YouTube request that failed: `blocked` when YouTube refused (Viral never works around that), `unavailable` for a
// removed, private or members-only video, `failed` for anything else.
export class YouTubeError extends Schema.TaggedError<YouTubeError>()("YouTubeError", {
  kind: Schema.Literals(["blocked", "unavailable", "failed"]),
  message: Schema.String
}) {}

export interface YouTubeOptions {
  // the yt-dlp to run: Viral's own (first on the PATH) unless a test passes a fake
  readonly command?: string
  // saves a video's thumbnail image to `file`; false when it couldn't. Tests pass their own.
  readonly fetchThumbnail?: (videoId: string, file: string) => Effect.Effect<boolean>
  // the pause between two requests, so a research never bursts
  readonly spacing?: Duration.Input
}

// YouTube's own small thumbnail for a video (320×180), fetched once into the set's folder so the app never loads
// images from YouTube itself.
const fetchYouTubeThumbnail = (fs: FileSystem.FileSystem, http: HttpClient.HttpClient) => (videoId: string, file: string) =>
  http.get(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`).pipe(
    Effect.flatMap((response) => response.arrayBuffer),
    Effect.timeout(Duration.seconds(15)),
    Effect.flatMap((bytes) => fs.writeFile(file, new Uint8Array(bytes))),
    Effect.as(true),
    Effect.orElseSucceed(() => false)
  )

const STDERR_TAIL = 8_000

// YouTube through Viral's own yt-dlp, the polite way: a search is one request (`--flat-playlist`, titles, channels,
// lengths and views only), a lookup reads one video's details and, when asked, its English captions; nothing is
// ever downloaded here. Requests go one at a time with a pause between them.
export class YouTube extends Context.Service<YouTube, {
  search(query: string): Effect.Effect<ReadonlyArray<VideoFound>, YouTubeError>
  details(videoId: string, options: { readonly captions: boolean }): Effect.Effect<VideoDetails, YouTubeError>
  saveThumbnail(videoId: string, file: string): Effect.Effect<boolean>
}>()("@viral/server/research/youtube") {
  static readonly make = Effect.fn("YouTube.make")(function*(options: YouTubeOptions = {}) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const command = options.command ?? "yt-dlp"
    const spacing = Duration.fromInputUnsafe(options.spacing ?? Duration.millis(1500))
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const fetchThumbnail = options.fetchThumbnail ?? fetchYouTubeThumbnail(fs, http)
    const one = yield* Semaphore.make(1)
    let last = 0

    // Runs yt-dlp once and returns its stdout; a failure is classified from its stderr.
    const ytDlp = (args: ReadonlyArray<string>) =>
      one.withPermits(1)(Effect.scoped(Effect.gen(function*() {
        const wait = last + Duration.toMillis(spacing) - (yield* Clock.currentTimeMillis)
        if (wait > 0) yield* Effect.sleep(Duration.millis(wait))
        const handle = yield* spawner.spawn(ChildProcess.make(command, ["--no-warnings", "--ignore-config", ...args])).pipe(
          Effect.mapError((cause) => new YouTubeError({ kind: "failed", message: `couldn't start yt-dlp: ${cause.message}` }))
        )
        let stderr = ""
        const drain = yield* handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) => Effect.sync(() => void (stderr = (stderr + chunk).slice(-STDERR_TAIL)))),
          Effect.ignore,
          Effect.forkScoped
        )
        const stdout = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.mkString,
          Effect.mapError((cause) => new YouTubeError({ kind: "failed", message: cause.message }))
        )
        const exit = yield* handle.exitCode.pipe(
          Effect.mapError((cause) => new YouTubeError({ kind: "failed", message: cause.message }))
        )
        yield* Fiber.join(drain)
        last = yield* Clock.currentTimeMillis
        if (exit !== ChildProcessSpawner.ExitCode(0) && stdout.trim() === "") {
          const failure = classifyFailure(stderr)
          return yield* new YouTubeError({ kind: failure.kind satisfies RefusalKind, message: failure.message })
        }
        return stdout
      })))

    const search = Effect.fn("YouTube.search")(function*(query: string) {
      const out = yield* ytDlp(["--flat-playlist", "--dump-single-json", `ytsearch${RESEARCH_SEARCH_RESULTS}:${query}`])
      return parseSearch(out)
    })

    const details = Effect.fn("YouTube.details")(function*(videoId: string, wanted: { readonly captions: boolean }) {
      const url = `https://www.youtube.com/watch?v=${videoId}`
      if (!wanted.captions) {
        const out = yield* ytDlp(["--dump-single-json", "--skip-download", "--no-playlist", "--", url])
        const parsed = parseDetails(out, null)
        if (parsed === null) return yield* new YouTubeError({ kind: "failed", message: "yt-dlp said nothing about the video" })
        return parsed
      }
      return yield* Effect.scoped(Effect.gen(function*() {
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "viral-captions-" }).pipe(
          Effect.mapError((e) => new YouTubeError({ kind: "failed", message: e.message }))
        )
        const out = yield* ytDlp([
          "--dump-single-json",
          "--no-simulate",
          "--skip-download",
          "--no-playlist",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs",
          "en.*,en",
          "--sub-format",
          "vtt",
          "-o",
          path.join(dir, "%(id)s.%(ext)s"),
          "--",
          url
        ])
        const files = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as Array<string>))
        const vtts = files.filter((f) => f.endsWith(".vtt"))
        // the video's own English first (manual, then the original automatic), then any English track
        const rank = (f: string) => /\.en\.vtt$/.test(f) ? 0 : /\.en-orig\.vtt$/.test(f) ? 1 : /\.en-[A-Z]{2}\.vtt$/.test(f) ? 2 : 3
        const best = [...vtts].sort((a, b) => rank(a) - rank(b))[0]
        const vtt = best === undefined ? null : yield* fs.readFileString(path.join(dir, best)).pipe(Effect.orElseSucceed(() => null))
        const parsed = parseDetails(out, vtt === null ? null : captionsExcerpt(vtt))
        if (parsed === null) return yield* new YouTubeError({ kind: "failed", message: "yt-dlp said nothing about the video" })
        return parsed
      }))
    })

    const saveThumbnail = Effect.fn("YouTube.saveThumbnail")(function*(videoId: string, file: string) {
      yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
      return yield* fetchThumbnail(videoId, file)
    })

    return YouTube.of({ search, details, saveThumbnail })
  })

  // VIRAL_YT_DLP runs another yt-dlp (tests point it at a fake), VIRAL_YT_SPACING_MS changes the pause between
  // requests, and VIRAL_YT_THUMBNAILS=off skips fetching thumbnails.
  static readonly layer = Layer.effect(YouTube, Effect.gen(function*() {
    const command = yield* Config.String("VIRAL_YT_DLP").pipe(Config.withDefault("yt-dlp"))
    const spacing = yield* Config.Int("VIRAL_YT_SPACING_MS").pipe(Config.withDefault(1500))
    const thumbnails = yield* Config.String("VIRAL_YT_THUMBNAILS").pipe(Config.withDefault("on"))
    return yield* YouTube.make({
      command,
      spacing: Duration.millis(spacing),
      ...(thumbnails === "off" ? { fetchThumbnail: () => Effect.succeed(false) } : {})
    })
  }).pipe(Effect.orDie)).pipe(Layer.provide([NodeServices.layer, FetchHttpClient.layer]))
  // tests: a fake yt-dlp and thumbnails, no pause
  static readonly layerWith = (options: YouTubeOptions) => Layer.effect(YouTube, YouTube.make(options)).pipe(Layer.provide([NodeServices.layer, FetchHttpClient.layer]))
}
