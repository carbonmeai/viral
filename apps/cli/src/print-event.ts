import { type RunUpdate, Script } from "@viral/contracts"
import { Console, Effect, Option, Schema } from "effect"

const ScriptPayload = Schema.Struct({ script: Script, narrationWords: Schema.NullOr(Schema.Int) })

// What a gate is asking you to approve, in readable form; empty when there's nothing to show.
const describePayload = (payload: unknown): string =>
  Option.match(Schema.decodeUnknownOption(ScriptPayload)(payload), {
    onNone: () => "",
    onSome: ({ script, narrationWords }) => {
      const headline = script.headline === null ? "" : `  HEADLINE  ${script.headline.join(" / ")}\n`
      const beats = script.beats.map((beat) =>
        beat._tag === "Narration"
          ? `  NARRATOR  ${beat.text}`
          : `    REAL    "${beat.quote}"  (${beat.start.toFixed(1)}–${beat.end.toFixed(1)}s)`
      ).join("\n")
      return `${headline}${beats}\n  ${narrationWords ?? "?"} narrated words\n`
    }
  })

// One readable line per run update. Progress prints in 10% steps; agent messages print as they come.
export const printUpdate = (): ((update: RunUpdate) => Effect.Effect<void>) => {
  let lastPct = -1
  return (update) => {
    switch (update._tag) {
      case "Snapshot":
        return Console.log(`run ${update.run.id}  ${update.run.status}`)
      case "Progress": {
        if (update.pct === null) return update.message === null ? Effect.void : Console.log(`    ${update.message}`)
        const step = Math.floor(update.pct / 10) * 10
        if (step === lastPct) return Effect.void
        lastPct = step
        return Console.log(`    ${update.stage} ${update.pct.toFixed(0)}%${update.message === null ? "" : `  ${update.message}`}`)
      }
      case "Event": {
        const event = update.event
        switch (event._tag) {
          case "RunStarted":
            return Effect.void
          case "StageStarted":
            lastPct = -1
            return Console.log(`▶ ${event.stageRun.stage}${event.stageRun.attempt > 1 ? ` (attempt ${event.stageRun.attempt})` : ""}`)
          case "StageFinished": {
            const s = event.stageRun
            const mark = s.status === "succeeded" ? "✔" : s.status === "reused" ? "↺" : s.status === "failed" ? "✖" : "■"
            return Console.log(`${mark} ${s.stage} ${s.status}${s.error === null ? "" : `: ${s.error}`}`)
          }
          case "RequestRaised":
            return Console.log(
              `${describePayload(event.request.payload)}? ${event.request.title}  →  approve ${event.request.id}  |  reject ${event.request.id} "note"`
            )
          case "RequestAnswered":
            return Console.log(`  answered: ${event.request.response?._tag ?? ""}`)
          case "RunFinished":
            return Console.log(`run ${event.run.status}${event.run.error === null ? "" : `: ${event.run.error}`}`)
        }
      }
    }
  }
}
