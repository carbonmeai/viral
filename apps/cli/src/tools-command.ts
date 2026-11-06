import type { Tool } from "@viral/contracts"
import { Console, Effect, Stream } from "effect"
import { positionals } from "./args.ts"
import { Client } from "./client.ts"

export const TOOLS_USAGE = `  tools                       (ffmpeg, ffprobe, uv, yt-dlp: version and where each comes from)
  tools install               (downloads the missing ones into Viral's tools folder)`

const describe = (tool: Tool) =>
  `${tool.name.padEnd(8)} ${tool.status.padEnd(10)} ${(tool.source ?? "").padEnd(7)} ${tool.version ?? tool.error ?? ""}` +
  (tool.path === null ? "" : `\n         ${tool.path}`)

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export const toolsCommand = Effect.fn("toolsCommand")(function*() {
  const client = yield* Client
  const [, sub = "list"] = positionals
  switch (sub) {
    case "list":
      return yield* Effect.forEach(yield* client.ListTools(), (t) => Console.log(describe(t)), { discard: true })
    case "install": {
      let printed = 0
      yield* client.InstallTools().pipe(Stream.runForEach((event) => {
        switch (event._tag) {
          case "Downloading": {
            // a line every ~10 MB, and at the end
            if (event.bytes - printed < 10 * 1024 * 1024 && event.bytes !== event.total) return Effect.void
            printed = event.bytes
            return Console.log(`  ${event.name}: ${mb(event.bytes)}${event.total === null ? "" : ` of ${mb(event.total)}`}`)
          }
          case "Installed":
            printed = 0
            return Console.log(`✔ ${describe(event.tool)}`)
          case "Failed":
            printed = 0
            return Console.log(`✖ ${event.name}: ${event.message}`)
        }
      }))
      return yield* Console.log("done")
    }
    default:
      return yield* Console.error(TOOLS_USAGE)
  }
})
