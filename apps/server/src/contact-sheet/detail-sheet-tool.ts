import { Effect, Path, Schema } from "effect"
import { agentTool } from "../agent-session/agent-session.ts"
import type { ContactSheets } from "./contact-sheets.ts"

// A detail sheet covers at most this many seconds, a frame each second.
export const DETAIL_SECONDS = 60
const DetailRequest = Schema.Struct({ start: Schema.Finite, end: Schema.Finite })

// The `contact_sheet` tool a vision stage offers its agent: a frame every second between two source times,
// drawn into `root/<from>-<to>/` and kept there for later attempts. Returns the sheet files to Read.
export const detailSheetTool = (
  contactSheets: ContactSheets["Service"],
  path: Path.Path,
  video: string,
  sourceSeconds: number,
  root: string
) =>
  agentTool({
    name: "contact_sheet",
    description: `A contact sheet with a frame every second between two source times (at most ${DETAIL_SECONDS}s). Returns the image files to Read.`,
    schema: DetailRequest,
    run: ({ start, end }) => {
      const from = Math.max(0, Math.floor(start))
      const to = Math.min(Math.floor(sourceSeconds), Math.ceil(end))
      if (!(to > from) || end - start > DETAIL_SECONDS) {
        return Effect.succeed(`ask for a range of 1–${DETAIL_SECONDS}s inside the video (0–${sourceSeconds.toFixed(0)}s)`)
      }
      const dir = path.join(root, `${from}-${to}`)
      return contactSheets.make(video, dir, { every: 1, cols: 6, rows: 5, start: from, end: to }, () => Effect.void).pipe(
        Effect.map((set) => set.sheets.map((s) => `${path.join(dir, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`).join("\n")),
        Effect.catch((error) => Effect.succeed(`couldn't make that sheet: ${error.message}`))
      )
    }
  })
