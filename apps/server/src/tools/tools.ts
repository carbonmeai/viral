import { NodeServices } from "@effect/platform-node"
import type { Tool, ToolProgress, ToolSource } from "@viral/contracts"
import { Cause, Clock, Config, Context, Deferred, Duration, Effect, FileSystem, Layer, Option, Path, Ref, Schedule, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import {
  BACKGROUND_REMOVAL_MODELS,
  type BinaryName,
  type DownloadSpec,
  type ModelSpec,
  TOOL_NAMES,
  TOOL_SPECS,
  type ToolSpec,
  type UvToolSpec,
  VERSION_ARGS
} from "./tool-specs.ts"

export interface ToolsOptions {
  // Viral's own tools folder, searched first and where downloads go
  readonly dir: string
  // the PATH to search after the tools folder
  readonly path: string
  // pinned downloads for this platform; empty when there are none
  readonly specs: ReadonlyArray<ToolSpec>
  // how often Viral's yt-dlp may update itself
  readonly updateEvery: Duration.Duration
  // where the background-removal models go (rembg's U2NET_HOME, which cutout.py is given); default: <dir>/models
  readonly modelsDir?: string
  // the models to fetch; none means the entry reports what's on disk and never downloads
  readonly models?: ReadonlyArray<ModelSpec>
  // cutout.py, whose Python environment is prepared once the models are in; null skips that
  readonly cutoutScript?: string | null
}

// Where the background-removal models live: ~/Library/Caches/Viral/models on macOS, ~/.cache/viral/models
// elsewhere (the folder render-thumbnail.py hands cutout.py); VIRAL_MODELS_DIR overrides it.
export const modelsDir = Effect.gen(function*() {
  const path = yield* Path.Path
  const override = yield* Config.option(Config.String("VIRAL_MODELS_DIR")).pipe(Effect.orDie)
  if (Option.isSome(override)) return override.value
  const home = yield* Config.String("HOME").pipe(Effect.orDie)
  return process.platform === "darwin"
    ? path.join(home, "Library", "Caches", "Viral", "models")
    : path.join(home, ".cache", "viral", "models")
})

// How long a background-removal wait reports progress apart.
const ENSURE_POLL = Duration.seconds(2)

// Viral's tools folder: ~/Library/Application Support/Viral/tools on macOS, ~/.viral/tools elsewhere;
// VIRAL_TOOLS_DIR overrides it.
export const toolsDir = Effect.gen(function*() {
  const path = yield* Path.Path
  const override = yield* Config.option(Config.String("VIRAL_TOOLS_DIR")).pipe(Effect.orDie)
  if (Option.isSome(override)) return override.value
  const home = yield* Config.String("HOME").pipe(Effect.orDie)
  return process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Viral", "tools")
    : path.join(home, ".viral", "tools")
})

// Puts Viral's tools folder first on this process's PATH, so every tool started by name (ffmpeg, uv, yt-dlp)
// is Viral's copy when there is one. Child processes inherit it.
export const prependToolsPath = Effect.gen(function*() {
  const dir = yield* toolsDir
  const current = yield* Config.String("PATH").pipe(Config.withDefault(""), Effect.orDie)
  if (!current.split(":").includes(dir)) {
    // @effect-diagnostics-next-line processEnvInEffect:off -- changing the process's own PATH is the point
    process.env["PATH"] = current === "" ? dir : `${dir}:${current}`
  }
  return dir
})

const UPDATE_EVERY = Duration.days(3)
// a version check that hangs is reported as unknown rather than holding up the list
const VERSION_TIMEOUT = Duration.seconds(60)
const UV_TIMEOUT = Duration.minutes(10)
// report download progress at most every this many bytes
const PROGRESS_STEP = 512 * 1024

const Lock = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Struct({ url: Schema.String, sha256: Schema.String })))
const State = Schema.fromJsonString(Schema.Struct({ ytDlpCheckedAt: Schema.Finite }))

class ToolInstallError extends Schema.TaggedError<ToolInstallError>()("ToolInstallError", { message: Schema.String }) {}

const isInstallError = Schema.is(ToolInstallError)

const hex = (digest: ArrayBuffer) => Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")

// The command-line tools the pipeline runs (ffmpeg, ffprobe, uv, yt-dlp): where each one is, which version,
// and downloading any that are missing into Viral's tools folder. A tool already on your PATH (e.g. from
// Homebrew) is used as it is and never downloaded.
export class Tools extends Context.Service<Tools, {
  readonly list: Effect.Effect<ReadonlyArray<Tool>>
  readonly install: Stream.Stream<ToolProgress>
  // starts fetching the background-removal models if they're missing or failed (one download at a time,
  // shared by every caller) and returns their state at once
  readonly prefetchBackgroundRemoval: Effect.Effect<Tool>
  // waits for the background-removal models, starting the download if needed and reporting it through
  // `progress`; never fails (a thumbnail falls back to a framed inset without them)
  ensureBackgroundRemoval(progress: (pct: number | null, message: string) => Effect.Effect<void>): Effect.Effect<"ready" | "unavailable">
  // updates Viral's own yt-dlp (`uv tool upgrade`) when the last check is older than `updateEvery`; never a PATH
  // copy. An older standalone download in Viral's folder is replaced by uv's install.
  readonly updateYtDlp: Effect.Effect<"updated" | "skipped">
}>()("@viral/server/tools/tools") {
  static readonly make = Effect.fn("Tools.make")(function*(options: ToolsOptions) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const installing = yield* Ref.make(new Set<BinaryName>())
    const failures = yield* Ref.make(new Map<BinaryName, string>())
    // versions by file, kept until the file changes: asking a tool for its version can be slow
    const versions = yield* Ref.make(new Map<string, { readonly modified: number; readonly version: string | null }>())
    const lockFile = path.join(options.dir, "tools.lock.json")
    const stateFile = path.join(options.dir, "tools.state.json")

    const isExecutable = (file: string) =>
      fs.stat(file).pipe(
        Effect.map((info) => info.type === "File" && (info.mode & 0o111) !== 0),
        Effect.orElseSucceed(() => false)
      )

    // Viral's folder first, then the PATH (leaving out the folder itself, which the server put first).
    const locate = Effect.fn("Tools.locate")(function*(name: BinaryName) {
      const own = path.join(options.dir, name)
      if (yield* isExecutable(own)) return Option.some({ file: own, source: "viral" as ToolSource })
      for (const entry of options.path.split(":")) {
        if (entry === "" || path.resolve(entry) === path.resolve(options.dir)) continue
        const file = path.join(entry, name)
        if (yield* isExecutable(file)) return Option.some({ file, source: "system" as ToolSource })
      }
      return Option.none()
    })

    const versionOf = Effect.fn("Tools.versionOf")(function*(name: BinaryName, file: string) {
      const modified = yield* fs.stat(file).pipe(
        Effect.map((info) => Option.getOrElse(Option.map(info.mtime, (d) => d.getTime()), () => 0)),
        Effect.orElseSucceed(() => 0)
      )
      const cached = (yield* Ref.get(versions)).get(file)
      if (cached !== undefined && cached.modified === modified) return cached.version
      const version = yield* spawner.string(ChildProcess.make(file, [...VERSION_ARGS[name]])).pipe(
        Effect.map((out) => out.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? null),
        Effect.timeout(VERSION_TIMEOUT),
        Effect.orElseSucceed(() => null)
      )
      yield* Ref.update(versions, (m) => new Map(m).set(file, { modified, version }))
      return version
    })

    const describe = Effect.fn("Tools.describe")(function*(name: BinaryName) {
      const found = yield* locate(name)
      const busy = (yield* Ref.get(installing)).has(name)
      const error = (yield* Ref.get(failures)).get(name) ?? null
      if (Option.isNone(found)) {
        return {
          name,
          status: busy ? "installing" : error === null ? "missing" : "failed",
          source: null,
          version: null,
          path: null,
          error,
          required: true,
          progress: null
        } satisfies Tool
      }
      const { file, source } = found.value
      return { name, status: "ready", source, version: yield* versionOf(name, file), path: file, error: null, required: true, progress: null } satisfies Tool
    })

    // the four tools are looked up side by side, so one slow version check doesn't hold up the others
    // ---- the background-removal models: fetched in the background, never part of first-run setup

    const models = options.models ?? []
    const modelsFolder = options.modelsDir ?? path.join(options.dir, "models")
    const modelsSize = models.reduce((n, m) => n + m.size, 0)
    interface ModelsState {
      // the download under way, which every caller waits on
      readonly running: Deferred.Deferred<"ready" | "unavailable"> | null
      readonly bytes: number
      readonly total: number | null
      readonly error: string | null
    }
    const modelsState = yield* Ref.make<ModelsState>({ running: null, bytes: 0, total: null, error: null })

    const modelPresent = (model: ModelSpec) =>
      fs.stat(path.join(modelsFolder, model.file)).pipe(
        Effect.map((info) => info.type === "File" && Number(info.size) > 0),
        Effect.orElseSucceed(() => false)
      )
    // with no specs (a platform or test without downloads), any model already in the folder counts
    const modelsPresent = models.length === 0
      ? fs.readDirectory(modelsFolder).pipe(Effect.map((files) => files.some((f) => f.endsWith(".onnx"))), Effect.orElseSucceed(() => false))
      : Effect.forEach(models, modelPresent).pipe(Effect.map((present) => present.every(Boolean)))

    const describeModels = Effect.gen(function*() {
      const state = yield* Ref.get(modelsState)
      const present = yield* modelsPresent
      const base = { name: "background-removal" as const, required: false, path: present ? modelsFolder : null }
      if (state.running !== null) {
        return { ...base, status: "installing", source: null, version: null, error: null, progress: { bytes: state.bytes, total: state.total } } satisfies Tool
      }
      if (present) {
        const size = modelsSize > 0 ? ` · ${Math.round(modelsSize / 1e6)} MB` : ""
        return { ...base, status: "ready", source: "viral", version: `${models.length || "rembg"} models${size}`, error: null, progress: null } satisfies Tool
      }
      return { ...base, status: state.error === null ? "missing" : "failed", source: null, version: null, error: state.error, progress: null } satisfies Tool
    }).pipe(Effect.withSpan("Tools.describeModels"))

    // One model: downloaded with progress, checked against its checksum, written through a temporary file.
    const downloadModel = Effect.fn("Tools.downloadModel")(function*(model: ModelSpec, before: number, total: number) {
      const fail = (message: string) => new ToolInstallError({ message })
      const response = yield* http.get(model.url).pipe(Effect.mapError((e) => fail(e.message)))
      const chunks: Array<Uint8Array> = []
      let bytes = 0
      let reported = 0
      yield* response.stream.pipe(
        Stream.mapError((e) => fail(e.message)),
        Stream.runForEach((chunk) => {
          chunks.push(chunk)
          bytes += chunk.length
          if (bytes - reported < PROGRESS_STEP) return Effect.void
          reported = bytes
          return Ref.update(modelsState, (s) => ({ ...s, bytes: before + bytes, total }))
        })
      )
      const all = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) {
        all.set(chunk, offset)
        offset += chunk.length
      }
      const sha256 = hex(yield* Effect.promise(() => crypto.subtle.digest("SHA-256", all)))
      if (sha256 !== model.sha256) {
        return yield* fail(`${model.file}'s checksum ${sha256.slice(0, 12)}… doesn't match the pinned ${model.sha256.slice(0, 12)}…; not keeping it`)
      }
      const target = path.join(modelsFolder, model.file)
      const temp = path.join(modelsFolder, `.${model.file}.download`)
      yield* fs.writeFile(temp, all).pipe(
        Effect.andThen(fs.rename(temp, target)),
        Effect.mapError((e) => fail(e.message)),
        Effect.tapError(() => fs.remove(temp, { force: true }).pipe(Effect.ignore))
      )
      yield* Ref.update(modelsState, (s) => ({ ...s, bytes: before + bytes, total }))
    })

    // cutout.py's Python environment (rembg and its dependencies), so the first cut-out doesn't install it
    const warmCutout = Effect.gen(function*() {
      if (options.cutoutScript === undefined || options.cutoutScript === null) return
      const found = yield* locate("uv")
      if (Option.isNone(found)) return
      const exit = yield* spawner.exitCode(ChildProcess.make(found.value.file, ["sync", "--script", options.cutoutScript])).pipe(
        Effect.timeout(UV_TIMEOUT),
        Effect.option
      )
      if (Option.isNone(exit) || exit.value !== ChildProcessSpawner.ExitCode(0)) {
        yield* Effect.logWarning("couldn't prepare the background-removal environment; the first cut-out will")
      }
    })

    const fetchModels = Effect.gen(function*() {
      yield* fs.makeDirectory(modelsFolder, { recursive: true }).pipe(Effect.mapError((e) => new ToolInstallError({ message: e.message })))
      const missing: Array<ModelSpec> = []
      for (const model of models) if (!(yield* modelPresent(model))) missing.push(model)
      const total = missing.reduce((n, m) => n + m.size, 0)
      yield* Ref.update(modelsState, (s) => ({ ...s, bytes: 0, total }))
      let before = 0
      for (const model of missing) {
        yield* downloadModel(model, before, total)
        before += model.size
      }
      yield* warmCutout
    })

    // Starts the download unless it's running or the models are here; returns what to wait on (null: nothing).
    const startModels = Effect.gen(function*() {
      if (models.length === 0 || ((yield* Ref.get(modelsState)).running === null && (yield* modelsPresent))) return null
      const done = yield* Deferred.make<"ready" | "unavailable">()
      // claimed atomically, so two callers never start two downloads
      type Claim = readonly [Deferred.Deferred<"ready" | "unavailable">, boolean]
      const [waitOn, started] = yield* Ref.modify(modelsState, (s): readonly [Claim, ModelsState] =>
        s.running !== null
          ? [[s.running, false], s]
          : [[done, true], { running: done, bytes: 0, total: null, error: null }])
      if (started) {
        yield* fetchModels.pipe(
          Effect.matchCauseEffect({
            onSuccess: () =>
              Ref.set(modelsState, { running: null, bytes: 0, total: null, error: null }).pipe(Effect.andThen(Deferred.succeed(done, "ready"))),
            onFailure: (cause) => {
              const error = Cause.squash(cause)
              const message = isInstallError(error) ? error.message : String(error)
              return Ref.set(modelsState, { running: null, bytes: 0, total: null, error: message }).pipe(
                Effect.andThen(Effect.logWarning("couldn't fetch the background-removal models", { message })),
                Effect.andThen(Deferred.succeed(done, "unavailable"))
              )
            }
          }),
          Effect.forkDetach
        )
      }
      return waitOn
    })

    const prefetchBackgroundRemoval = startModels.pipe(Effect.andThen(describeModels), Effect.withSpan("Tools.prefetchBackgroundRemoval"))

    const ensureBackgroundRemoval = Effect.fn("Tools.ensureBackgroundRemoval")(function*(
      progress: (pct: number | null, message: string) => Effect.Effect<void>
    ) {
      const waitOn = yield* startModels
      if (waitOn === null) return (yield* modelsPresent) ? "ready" as const : "unavailable" as const
      const report = Effect.gen(function*() {
        const { bytes, total } = yield* Ref.get(modelsState)
        const pct = total !== null && total > 0 ? Math.round(100 * bytes / total) : null
        yield* progress(pct, `Downloading background removal${pct === null ? "…" : `… ${pct}%`}`)
      })
      const reporting: Effect.Effect<never> = report.pipe(Effect.repeat(Schedule.spaced(ENSURE_POLL)), Effect.andThen(Effect.never))
      return yield* Effect.race(Deferred.await(waitOn), reporting)
    })

    const list = Effect.all([
      Effect.forEach(TOOL_NAMES, describe, { concurrency: "unbounded" }),
      describeModels
    ], { concurrency: "unbounded" }).pipe(Effect.map(([tools, models]) => [...tools, models]), Effect.withSpan("Tools.list"))

    const readLock = fs.readFileString(lockFile).pipe(
      Effect.flatMap(Schema.decodeEffect(Lock)),
      Effect.orElseSucceed((): Record<string, { readonly url: string; readonly sha256: string }> => ({}))
    )

    // Checks the bytes against the pin (or the hash recorded on the first download), then writes the binary
    // through a temporary file and renames it into place, so the folder never holds a half-written tool.
    const place = Effect.fn("Tools.place")(function*(spec: DownloadSpec, bytes: Uint8Array<ArrayBuffer>) {
      const fail = (message: string) => new ToolInstallError({ message })
      const sha256 = hex(yield* Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)))
      const lock = yield* readLock
      const recorded = lock[spec.name]?.url === spec.url ? lock[spec.name]?.sha256 : undefined
      const expected = spec.sha256 ?? recorded
      if (expected !== undefined && expected !== sha256) {
        return yield* fail(`the download's checksum ${sha256.slice(0, 12)}… doesn't match the pinned ${expected.slice(0, 12)}…; not installing it`)
      }

      yield* fs.makeDirectory(options.dir, { recursive: true }).pipe(Effect.mapError((e) => fail(e.message)))
      const target = path.join(options.dir, spec.name)
      const temp = path.join(options.dir, `.${spec.name}.download`)
      yield* Effect.gen(function*() {
        if (spec.archive === undefined) {
          yield* fs.writeFile(temp, bytes)
        } else {
          const staging = path.join(options.dir, `.${spec.name}.staging`)
          const archive = `${staging}.tar.gz`
          yield* fs.makeDirectory(staging, { recursive: true })
          yield* fs.writeFile(archive, bytes)
          const exit = yield* spawner.exitCode(ChildProcess.make("tar", ["-xzf", archive, "-C", staging, spec.archive.member]))
          if (exit !== ChildProcessSpawner.ExitCode(0)) return yield* fail(`couldn't unpack ${spec.archive.member}`)
          yield* fs.rename(path.join(staging, spec.archive.member), temp)
          yield* fs.remove(staging, { recursive: true, force: true })
          yield* fs.remove(archive, { force: true })
        }
        yield* fs.chmod(temp, 0o755)
        yield* fs.rename(temp, target)
      }).pipe(
        Effect.mapError((e) => isInstallError(e) ? e : fail(e.message)),
        Effect.tapError(() => fs.remove(temp, { force: true }).pipe(Effect.ignore))
      )
      if (spec.sha256 === null && recorded === undefined) {
        yield* Effect.logInfo("no published checksum; recording this download's", { tool: spec.name, sha256 })
        yield* Schema.encodeEffect(Lock)({ ...lock, [spec.name]: { url: spec.url, sha256 } }).pipe(
          Effect.flatMap((json) => fs.writeFileString(lockFile, json)),
          Effect.orElseSucceed(() => undefined)
        )
      }
    })

    // uv's tool, bin and Python folders all live in Viral's tools folder, so a uv tool never touches the system
    const uvEnv = {
      UV_TOOL_DIR: path.join(options.dir, "uv-tools"),
      UV_TOOL_BIN_DIR: options.dir,
      UV_PYTHON_INSTALL_DIR: path.join(options.dir, "python")
    }
    const uv = Effect.fn("Tools.uv")(function*(args: ReadonlyArray<string>) {
      const found = yield* locate("uv")
      if (Option.isNone(found)) return yield* new ToolInstallError({ message: "uv isn't installed yet, and it installs this tool" })
      const exit = yield* spawner.exitCode(ChildProcess.make(found.value.file, [...args], { env: uvEnv, extendEnv: true })).pipe(
        Effect.timeout(UV_TIMEOUT),
        Effect.mapError((e) => new ToolInstallError({ message: e.message }))
      )
      if (exit !== ChildProcessSpawner.ExitCode(0)) {
        return yield* new ToolInstallError({ message: `uv ${args.join(" ")} exited with code ${exit}` })
      }
    })

    const download = (spec: DownloadSpec): Stream.Stream<ToolProgress, ToolInstallError> =>
      Stream.unwrap(Effect.gen(function*() {
        const response = yield* http.get(spec.url).pipe(Effect.mapError((e) => new ToolInstallError({ message: e.message })))
        const length = Number(response.headers["content-length"])
        const total = Number.isFinite(length) && length > 0 ? length : null
        const chunks: Array<Uint8Array> = []
        let bytes = 0
        let reported = 0
        const progress = response.stream.pipe(
          Stream.mapError((e) => new ToolInstallError({ message: e.message })),
          Stream.map((chunk) => {
            chunks.push(chunk)
            bytes += chunk.length
            return bytes
          }),
          Stream.filter((n) => n - reported >= PROGRESS_STEP || n === total),
          Stream.map((n): ToolProgress => {
            reported = n
            return { _tag: "Downloading", name: spec.name, bytes: n, total }
          })
        )
        const finish = Effect.gen(function*() {
          const all = new Uint8Array(bytes)
          let offset = 0
          for (const chunk of chunks) {
            all.set(chunk, offset)
            offset += chunk.length
          }
          yield* place(spec, all)
        })
        return Stream.concat(progress, Stream.fromEffect(finish).pipe(Stream.drain))
      }))

    // uv fetches the package and a Python for it; there's no byte count to report, only that it started
    const uvTool = (spec: UvToolSpec): Stream.Stream<ToolProgress, ToolInstallError> =>
      Stream.concat(
        Stream.succeed<ToolProgress>({ _tag: "Downloading", name: spec.name, bytes: 0, total: null }),
        Stream.fromEffect(uv(["tool", "install", "--force", spec.package])).pipe(Stream.drain)
      )

    const clear = <A>(ref: Ref.Ref<A>, update: (a: A) => A) => Ref.update(ref, update)
    const notInstalling = (name: BinaryName) => clear(installing, (s) => {
      const next = new Set(s)
      next.delete(name)
      return next
    })

    // One tool's install, with the bookkeeping every kind shares: marked as installing, its last failure
    // cleared, and a failure recorded and reported instead of ending the stream.
    const installOne = (name: BinaryName): Stream.Stream<ToolProgress> => {
      const spec = options.specs.find((s) => s.name === name)
      if (spec === undefined) {
        const message = `Viral has no download of ${name} for this computer; install it yourself (e.g. with Homebrew)`
        return Stream.fromEffect(Ref.update(failures, (m) => new Map(m).set(name, message)).pipe(
          Effect.as<ToolProgress>({ _tag: "Failed", name, message })
        ))
      }
      const start = Effect.gen(function*() {
        yield* Ref.update(installing, (s) => new Set(s).add(name))
        yield* clear(failures, (m) => {
          const next = new Map(m)
          next.delete(name)
          return next
        })
      })
      const done = Effect.gen(function*() {
        yield* notInstalling(name)
        return { _tag: "Installed", tool: yield* describe(name) } satisfies ToolProgress
      })
      const work = spec.via === "download" ? download(spec) : uvTool(spec)
      return Stream.unwrap(start.pipe(Effect.as(Stream.concat(work, Stream.fromEffect(done))))).pipe(
        Stream.catchCause((cause) => {
          const error = Cause.squash(cause)
          const message = isInstallError(error) ? error.message : String(error)
          return Stream.fromEffect(Effect.gen(function*() {
            yield* notInstalling(name)
            yield* Ref.update(failures, (m) => new Map(m).set(name, message))
            yield* Effect.logWarning("couldn't install a tool", { tool: name, message })
            return { _tag: "Failed", name, message } satisfies ToolProgress
          }))
        })
      )
    }

    // Only the tools that are missing (or failed before); one after another.
    const install = Stream.unwrap(Effect.gen(function*() {
      const tools = yield* list
      // only the tools first run needs; the background-removal models are fetched on their own
      const todo = tools.flatMap((t) => t.required && t.name !== "background-removal" && (t.status === "missing" || t.status === "failed") ? [t.name] : [])
      return Stream.fromIterable(todo).pipe(Stream.flatMap(installOne))
    }))

    const updateYtDlp = Effect.gen(function*() {
      const own = path.join(options.dir, "yt-dlp")
      if (!(yield* isExecutable(own))) return "skipped" as const
      const now = yield* Clock.currentTimeMillis
      const state = yield* fs.readFileString(stateFile).pipe(Effect.flatMap(Schema.decodeEffect(State)), Effect.option)
      if (Option.isSome(state) && now - state.value.ytDlpCheckedAt < Duration.toMillis(options.updateEvery)) return "skipped" as const
      // recorded before trying, so a failing update is retried on the next interval, not on every start
      yield* Schema.encodeEffect(State)({ ytDlpCheckedAt: now }).pipe(
        Effect.flatMap((json) => fs.writeFileString(stateFile, json)),
        Effect.ignore
      )
      // uv's install upgrades in place; an older standalone download is replaced by uv's install; with no uv,
      // the standalone build updates itself
      const managed = yield* fs.exists(path.join(uvEnv.UV_TOOL_DIR, "yt-dlp")).pipe(Effect.orElseSucceed(() => false))
      const hasUv = Option.isSome(yield* locate("uv"))
      const updated = managed
        ? uv(["tool", "upgrade", "yt-dlp"])
        : hasUv
        ? uv(["tool", "install", "--force", "yt-dlp"])
        : spawner.exitCode(ChildProcess.make(own, ["-U"])).pipe(
          Effect.timeout(Duration.minutes(2)),
          Effect.flatMap((exit) => exit === ChildProcessSpawner.ExitCode(0) ? Effect.void : Effect.fail(new ToolInstallError({ message: `exit ${exit}` })))
        )
      yield* updated.pipe(
        Effect.catch((error) => Effect.logWarning("yt-dlp couldn't update; keeping the current version", { error: String(error) }))
      )
      return "updated" as const
    }).pipe(Effect.withSpan("Tools.updateYtDlp"))

    return Tools.of({ list, install, prefetchBackgroundRemoval, ensureBackgroundRemoval, updateYtDlp })
  })

  static readonly layer = Layer.effect(
    Tools,
    Effect.gen(function*() {
      const dir = yield* toolsDir
      const path = yield* Path.Path
      return yield* Tools.make({
        dir,
        path: yield* Config.String("PATH").pipe(Config.withDefault(""), Effect.orDie),
        specs: TOOL_SPECS[`${process.platform}-${process.arch}`] ?? [],
        updateEvery: UPDATE_EVERY,
        modelsDir: yield* modelsDir,
        models: BACKGROUND_REMOVAL_MODELS,
        cutoutScript: path.join(import.meta.dirname, "..", "thumbnail", "cutout.py")
      })
    })
  ).pipe(Layer.provide([NodeServices.layer, FetchHttpClient.layer]))
}
