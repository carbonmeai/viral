import { Effect, FileSystem, Layer, Option, Path } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse, Mime } from "effect/http"
import { ViralHome } from "../home/viral-home.ts"
import { appOrigin, byteRange, mediaSegments } from "./media-path.ts"

const notFound = HttpServerResponse.text("Not Found", { status: 404 })

// GET /media/<path inside the Viral home>: frames, contact sheets, voiceovers and renders for the app. Read-only,
// limited to the media folders (never viral.db), symlinks resolved and checked to stay inside the home, and byte
// ranges so audio and video can seek. The server listens on 127.0.0.1 only.
export const MediaRouteLive = Layer.unwrap(Effect.gen(function*() {
  const home = yield* ViralHome
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const serve = Effect.fn("MediaRoute.serve")(
    function*(request: HttpServerRequest.HttpServerRequest) {
      const raw = (yield* HttpRouter.params)["*"] ?? ""
      const segments = mediaSegments(yield* Effect.try({ try: () => decodeURIComponent(raw), catch: () => "bad-path" }))
      if (segments === null) return notFound

      // the real file must still be inside the real home, whatever symlinks say
      const root = yield* fs.realPath(home.root)
      const file = yield* fs.realPath(path.join(home.root, ...segments))
      const relative = path.relative(root, file)
      if (relative.startsWith("..") || path.isAbsolute(relative)) return notFound
      const info = yield* fs.stat(file)
      if (info.type !== "File") return notFound

      const size = Number(info.size)
      const contentType = Option.getOrElse(Mime.getType(file), () => "application/octet-stream")
      const origin = appOrigin(request.headers["origin"])
      const headers = {
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        ...(origin === null ? {} : { "access-control-allow-origin": origin, vary: "origin" })
      }
      const rangeHeader = request.headers["range"]
      const range = rangeHeader === undefined ? null : byteRange(rangeHeader, size)
      if (range?._tag === "Unsatisfiable") {
        return HttpServerResponse.empty({ status: 416, headers: { ...headers, "content-range": range.contentRange } })
      }
      if (range?._tag === "Range") {
        return yield* HttpServerResponse.file(file, {
          status: 206,
          contentType,
          offset: range.start,
          bytesToRead: range.length,
          headers: { ...headers, "content-range": range.contentRange }
        })
      }
      return yield* HttpServerResponse.file(file, { contentType, headers })
    },
    Effect.orElseSucceed(() => notFound)
  )

  return HttpRouter.add("GET", "/media/*", serve)
}))

// GET /healthz: answers once the server is up, for the desktop app to wait on before loading the UI.
export const HealthRouteLive = HttpRouter.add("GET", "/healthz", HttpServerResponse.text("ok"))
