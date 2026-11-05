import type { JobEvent } from "@viral/contracts"
import { Console, Effect, Schema } from "effect"

const EventJson = Schema.fromJsonString(Schema.Unknown)

// One readable line per streamed event. Progress is printed in whole-percent steps to keep output short.
export const printEvent = (): ((event: JobEvent) => Effect.Effect<void>) => {
  let lastPct = -1
  return (event) => {
    switch (event._tag) {
      case "Progress": {
        const pct = Math.floor(event.pct / 10) * 10
        if (pct === lastPct) return Effect.void
        lastPct = pct
        return Console.log(`  ${event.stage} ${event.pct.toFixed(0)}%`)
      }
      case "Log":
        return Console.log(`  ${event.stage}: ${event.message}`)
      case "AgentText":
        return Console.log(`  claude: ${event.text}`)
      case "ScriptProposed":
        return Console.log(`  script:\n    ${[event.script.hook, ...event.script.lines].join("\n    ")}`)
      case "StageStarted":
        lastPct = -1
        return Console.log(`▶ ${event.stage}`)
      case "StageSkipped":
        return Console.log(`⏭ ${event.stage}: ${event.reason}`)
      case "Completed":
        return Console.log(`✔ ${event.output}`)
      case "Failed":
        return Console.error(`✖ ${event.message}`)
      default: {
        const { _tag, ...rest } = event
        return Schema.encodeEffect(EventJson)(rest).pipe(
          Effect.flatMap((json) => Console.log(`[${_tag}] ${json}`)),
          Effect.orDie
        )
      }
    }
  }
}
