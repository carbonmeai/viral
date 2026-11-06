import { NodeServices } from "@effect/platform-node"
import type { Tool, ToolName, ToolProgress, ToolSource } from "@viral/contracts"
import { Cause, Clock, Config, Context, Duration, Effect, FileSystem, Layer, Option, Path, Ref, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { TOOL_NAMES, TOOL_SPECS, type ToolSpec, VERSION_ARGS } from "./tool-specs.ts"

export interface ToolsOptions {
  // Viral's own tools folder, searched first and where downloads go
  readonly dir: string
  // the PATH to search after the tools folder
  readonly path: string
  // pinned downloads for this platform; empty when there are none
  readonly specs: ReadonlyArray<ToolSpec>
  // how often Viral's yt-dlp may update itself
  readonly updateEvery: Duration.Duration
}

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
const VERSION_TIMEOUT = Duration.seconds(10)
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
  // updates Viral's own yt-dlp (`yt-dlp -U`) when the last check is older than `updateEvery`; never a PATH copy
  readonly updateYtDlp: Effect.Effect<"updated" | "skipped">
}>()("@viral/server/tools/tools") {
  static readonly make = Effect.fn("Tools.make")(function*(options: ToolsOptions) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const installing = yield* Ref.make(new Set<ToolName>())
    const failures = yield* Ref.make(new Map<ToolName, string>())
    const lockFile = path.join(options.dir, "tools.lock.json")
    const stateFile = path.join(options.dir, "tools.state.json")

    const isExecutable = (file: string) =>
      fs.stat(file).pipe(
        Effect.map((info) => info.type === "File" && (info.mode & 0o111) !== 0),
        Effect.orElseSucceed(() => false)
      )

    // Viral's folder first, then the PATH (leaving out the folder itself, which the server put first).
    const locate = Effect.fn("Tools.locate")(function*(name: ToolName) {
      const own = path.join(options.dir, name)
      if (yield* isExecutable(own)) return Option.some({ file: own, source: "viral" as ToolSource })
      for (const entry of options.path.split(":")) {
        if (entry === "" || path.resolve(entry) === path.resolve(options.dir)) continue
        const file = path.join(entry, name)
        if (yield* isExecutable(file)) return Option.some({ file, source: "system" as ToolSource })
      }
      return Option.none()
    })

    const versionOf = (name: ToolName, file: string) =>
      spawner.string(ChildProcess.make(file, [...VERSION_ARGS[name]])).pipe(
        Effect.map((out) => out.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? null),
        Effect.timeout(VERSION_TIMEOUT),
        Effect.orElseSucceed(() => null)
      )

    const describe = Effect.fn("Tools.describe")(function*(name: ToolName) {
      const found = yield* locate(name)
      const busy = (yield* Ref.get(installing)).has(name)
      const error = (yield* Ref.get(failures)).get(name) ?? null
      if (Option.isNone(found)) {
        return { name, status: busy ? "installing" : error === null ? "missing" : "failed", source: null, version: null, path: null, error } satisfies Tool
      }
      const { file, source } = found.value
      return { name, status: "ready", source, version: yield* versionOf(name, file), path: file, error: null } satisfies Tool
    })

    const list = Effect.forEach(TOOL_NAMES, describe).pipe(Effect.withSpan("Tools.list"))

    const readLock = fs.readFileString(lockFile).pipe(
      Effect.flatMap(Schema.decodeEffect(Lock)),
      Effect.orElseSucceed((): Record<string, { readonly url: string; readonly sha256: string }> => ({}))
    )

    // Checks the bytes against the pin (or the hash recorded on the first download), then writes the binary
    // through a temporary file and renames it into place, so the folder never holds a half-written tool.
    const place = Effect.fn("Tools.place")(function*(spec: ToolSpec, bytes: Uint8Array<ArrayBuffer>) {
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

    const installOne = (name: ToolName): Stream.Stream<ToolProgress> => {
      const spec = options.specs.find((s) => s.name === name)
      if (spec === undefined) {
        const message = `Viral has no download of ${name} for this computer; install it yourself (e.g. with Homebrew)`
        return Stream.fromEffect(Ref.update(failures, (m) => new Map(m).set(name, message)).pipe(
          Effect.as<ToolProgress>({ _tag: "Failed", name, message })
        ))
      }
      return Stream.unwrap(Effect.gen(function*() {
        yield* Ref.update(installing, (s) => new Set(s).add(name))
        yield* Ref.update(failures, (m) => {
          const next = new Map(m)
          next.delete(name)
          return next
        })
        const response = yield* http.get(spec.url).pipe(Effect.mapError((e) => new ToolInstallError({ message: e.message })))
        const length = Number(response.headers["content-length"])
        const total = Number.isFinite(length) && length > 0 ? length : null
        const chunks: Array<Uint8Array> = []
        let bytes = 0
        let reported = 0
        const download = response.stream.pipe(
          Stream.mapError((e) => new ToolInstallError({ message: e.message })),
          Stream.map((chunk) => {
            chunks.push(chunk)
            bytes += chunk.length
            return bytes
          }),
          Stream.filter((n) => n - reported >= PROGRESS_STEP || n === total),
          Stream.map((n): ToolProgress => {
            reported = n
            return { _tag: "Downloading", name, bytes: n, total }
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
          yield* Ref.update(installing, (s) => {
            const next = new Set(s)
            next.delete(name)
            return next
          })
          return { _tag: "Installed", tool: yield* describe(name) } satisfies ToolProgress
        })
        return Stream.concat(download, Stream.fromEffect(finish))
      })).pipe(
        Stream.catchCause((cause) => {
          const error = Cause.squash(cause)
          const message = isInstallError(error) ? error.message : String(error)
          return Stream.fromEffect(Effect.gen(function*() {
            yield* Ref.update(installing, (s) => {
              const next = new Set(s)
              next.delete(name)
              return next
            })
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
      const todo = tools.filter((t) => t.status === "missing" || t.status === "failed").map((t) => t.name)
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
      const exit = yield* spawner.exitCode(ChildProcess.make(own, ["-U"])).pipe(
        Effect.timeout(Duration.minutes(2)),
        Effect.option
      )
      if (Option.isNone(exit) || exit.value !== ChildProcessSpawner.ExitCode(0)) {
        yield* Effect.logWarning("yt-dlp couldn't update itself; keeping the current version")
      }
      return "updated" as const
    }).pipe(Effect.withSpan("Tools.updateYtDlp"))

    return Tools.of({ list, install, updateYtDlp })
  })

  static readonly layer = Layer.effect(
    Tools,
    Effect.gen(function*() {
      const dir = yield* toolsDir
      return yield* Tools.make({
        dir,
        path: yield* Config.String("PATH").pipe(Config.withDefault(""), Effect.orDie),
        specs: TOOL_SPECS[`${process.platform}-${process.arch}`] ?? [],
        updateEvery: UPDATE_EVERY
      })
    })
  ).pipe(Layer.provide([NodeServices.layer, FetchHttpClient.layer]))
}
