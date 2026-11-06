import { NodeServices } from "@effect/platform-node"
import { ContactSheetSet } from "@viral/contracts"
import { Context, Effect, Layer, Path, Schema } from "effect"
import { ScriptRunner } from "../script-runner/script-runner.ts"

export class ContactSheetError extends Schema.TaggedError<ContactSheetError>()("ContactSheetError", {
  code: Schema.String,
  message: Schema.String
}) {}

// Reports progress: a percentage (null when unknown) and an optional message for the person watching.
type Progress = (pct: number | null, message?: string) => Effect.Effect<void>

export interface ContactSheetOptions {
  // seconds between tiles
  readonly every: number
  readonly cols: number
  readonly rows: number
  readonly start?: number
  readonly end?: number
}

// The overview grid the skill uses to read a long video: a tile every 5s, 8×8 tiles per sheet.
export const OVERVIEW: ContactSheetOptions = { every: 5, cols: 8, rows: 8 }

// The artifact's data shape lives in contracts, since the app reads it too.
export { ContactSheetSet } from "@viral/contracts"

const Line = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), done: Schema.Int, total: Schema.Int }),
  Schema.Struct({
    type: Schema.Literal("done"),
    frames: Schema.Int,
    sheets: ContactSheetSet.fields.sheets,
    stills: Schema.Array(Schema.Struct({ file: Schema.String, t: Schema.Finite }))
  })
]))

// Timestamped frame grids of a video, so an agent (or a person) can pick b-roll by eye.
export class ContactSheets extends Context.Service<ContactSheets, {
  make(video: string, outDir: string, options: ContactSheetOptions, progress: Progress): Effect.Effect<ContactSheetSet, ContactSheetError>
}>()("@viral/server/contact-sheet/contact-sheets/ContactSheets") {
  static readonly layer = Layer.effect(
    ContactSheets,
    Effect.gen(function*() {
      const scripts = yield* ScriptRunner
      const path = yield* Path.Path

      const make = Effect.fn("ContactSheets.make")(
        function*(video: string, outDir: string, options: ContactSheetOptions, progress: Progress) {
          const args = [
            path.join(import.meta.dirname, "contact-sheet.py"), video, outDir,
            "--every", String(options.every), "--cols", String(options.cols), "--rows", String(options.rows),
            ...(options.start === undefined ? [] : ["--start", String(options.start)]),
            ...(options.end === undefined ? [] : ["--end", String(options.end)])
          ]
          return yield* scripts.run(
            args,
            Schema.decodeEffect(Line),
            (line): Effect.Effect<ContactSheetSet | undefined> =>
              line.type === "progress"
                ? progress(100 * line.done / line.total).pipe(Effect.as(undefined))
                : Effect.succeed({ every: options.every, cols: options.cols, rows: options.rows, frames: line.frames, sheets: line.sheets, stills: line.stills })
          ).pipe(Effect.mapError((error) => new ContactSheetError({ code: error.code, message: error.message })))
        }
      )

      return ContactSheets.of({ make })
    })
  ).pipe(Layer.provide([ScriptRunner.layer, NodeServices.layer]))
}
