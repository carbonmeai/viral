import { VideoNumber } from "@viral/contracts"
import { Effect, Path, Schema } from "effect"
import { agentTool } from "../agent-session/agent-session.ts"
import type { ContactSheets } from "./contact-sheets.ts"

// A detail sheet covers at most this many seconds, a frame each second.
export const DETAIL_SECONDS = 60
const DetailRequest = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  // which of the short's videos, by its V number; V1 when left out
  video: Schema.optionalKey(VideoNumber)
})

// One video the tool can draw from: its file and length.
export interface DetailVideo {
  readonly video: string
  readonly seconds: number
}

// The `contact_sheet` tool a vision stage offers its agent: a frame every second between two source times, drawn
// into `root/<from>-<to>/` (`root/v2/<from>-<to>/` for V2 and up) and kept there for later attempts. Returns the
// sheet files to Read. Takes one video, or a short's videos (V1 first), picked by `video`.
export const detailSheetTool = (
  contactSheets: ContactSheets["Service"],
  path: Path.Path,
  video: string | ReadonlyArray<DetailVideo>,
  sourceSeconds: number,
  root: string
) => {
  const videos: ReadonlyArray<DetailVideo> = typeof video === "string" ? [{ video, seconds: sourceSeconds }] : video
  const several = videos.length > 1
  return agentTool({
    name: "contact_sheet",
    description: several
      ? `A contact sheet with a frame every second between two times of one video (\`video\`: its V number, V1–V${videos.length}; at most ${DETAIL_SECONDS}s). Returns the image files to Read.`
      : `A contact sheet with a frame every second between two source times (at most ${DETAIL_SECONDS}s). Returns the image files to Read.`,
    schema: DetailRequest,
    run: Effect.fn("DetailSheet.run")(function*({ start, end, video: number }) {
      const index = (number ?? 1) - 1
      const target = videos[index]
      if (target === undefined) return `there's no V${number}; the short's videos are V1–V${videos.length}`
      const label = several ? `V${index + 1} ` : ""
      const from = Math.max(0, Math.floor(start))
      const to = Math.min(Math.floor(target.seconds), Math.ceil(end))
      if (!(to > from) || end - start > DETAIL_SECONDS) {
        return `ask for a range of 1–${DETAIL_SECONDS}s inside the ${label}video (0–${target.seconds.toFixed(0)}s)`
      }
      const dir = index === 0 ? path.join(root, `${from}-${to}`) : path.join(root, `v${index + 1}`, `${from}-${to}`)
      const set = yield* contactSheets.make(target.video, dir, { every: 1, cols: 6, rows: 5, start: from, end: to }, () => Effect.void)
      return set.sheets.map((s) => `${path.join(dir, s.file)}  (${label}${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`).join("\n")
    }, Effect.catch((error) => Effect.succeed(`couldn't make that sheet: ${error.message}`)))
  })
}
