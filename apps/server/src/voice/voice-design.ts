import { DESIGN_TEXT_MAX, DESIGN_TEXT_MIN, VoiceError } from "@viral/contracts"
import { Effect, FileSystem, Path } from "effect"
import { ViralHome } from "../home/viral-home.ts"
import { UsageRecords } from "../usage/usage-records.ts"
import { ElevenLabs, VOICE_DESIGN_MODEL } from "./eleven-labs.ts"

// Voice design (Library › Create › Voice): three voices from a description, each speaking the line. Their samples land
// in ~/.viral/voice-previews/ named by ElevenLabs' preview id; the characters go to Settings › Usage (step
// "voice-design", under the short it was made from). Nothing is added to your account until you save one; voices are
// only ever designed from words, never cloned from a clip (decision 18).
export const designVoices = Effect.fn("designVoices")(function*(description: string, text: string, projectId: string | null) {
  const eleven = yield* ElevenLabs
  const usage = yield* UsageRecords
  const home = yield* ViralHome
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const words = description.trim()
  const line = text.trim()
  if (words.length < 20) return yield* new VoiceError({ code: "prompt", message: "Describe the voice in a sentence or two (at least 20 characters)." })
  if (line.length < DESIGN_TEXT_MIN || line.length > DESIGN_TEXT_MAX) {
    return yield* new VoiceError({ code: "prompt", message: `The line to speak needs ${DESIGN_TEXT_MIN}–${DESIGN_TEXT_MAX} characters (it has ${line.length}).` })
  }
  const made = yield* eleven.design({ description: words, text: line })
  yield* usage.record({ projectId, step: "voice-design", provider: "elevenlabs", model: VOICE_DESIGN_MODEL, billing: "billed", characters: made.characters })
  yield* fs.makeDirectory(home.voicePreviews, { recursive: true }).pipe(Effect.orDie)
  const previews = yield* Effect.forEach(made.previews, (p) =>
    Effect.gen(function*() {
      const file = path.join(home.voicePreviews, `designed-${p.generatedVoiceId.replace(/[^A-Za-z0-9_-]/g, "")}.mp3`)
      yield* fs.writeFile(file, p.audio).pipe(Effect.orDie)
      return { previewId: p.generatedVoiceId, path: file, durationS: p.durationS, language: p.language }
    }))
  return { text: made.text, previews, characters: Math.round(made.characters) }
})
