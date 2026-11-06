import type { Voice } from "@viral/contracts"
import { Console, Effect } from "effect"
import { positionals } from "./args.ts"
import { Client } from "./client.ts"

export const VOICE_USAGE = `  voices                          (your ElevenLabs voices; play a preview link for free)
  voices preview <voice-id> ["line"]   (speaks a sample line; costs its characters)`

const describe = (voice: Voice) => {
  const labels = Object.values(voice.labels).join(", ")
  return `${voice.voiceId}  ${voice.name}${voice.category === null ? "" : `  [${voice.category}]`}${labels === "" ? "" : `  ${labels}`}` +
    (voice.previewUrl === null ? "" : `\n    ${voice.previewUrl}`)
}

export const voiceCommand = Effect.fn("voiceCommand")(function*() {
  const client = yield* Client
  const [, sub = "list", voiceId, line] = positionals
  switch (sub) {
    case "list":
      return yield* Effect.forEach(yield* client.ListVoices(), (v) => Console.log(describe(v)), { discard: true })
    case "preview": {
      if (voiceId === undefined) return yield* Console.error(VOICE_USAGE)
      const preview = yield* client.PreviewVoice({ voiceId, text: line ?? null })
      return yield* Console.log(`${preview.path}  (${preview.characters} characters)`)
    }
    default:
      return yield* Console.error(VOICE_USAGE)
  }
})
