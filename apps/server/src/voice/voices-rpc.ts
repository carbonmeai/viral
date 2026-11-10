import { VoicesRpcs } from "@viral/contracts"
import { Clock, Effect, FileSystem, Path } from "effect"
import { ViralHome } from "../home/viral-home.ts"
import { UsageRecords } from "../usage/usage-records.ts"
import { ElevenLabs } from "./eleven-labs.ts"
import { designVoices } from "./voice-design.ts"
import { VoicePreviews } from "./voice-previews.ts"

const SAMPLE = "This guy made a candy that hits every single taste at the exact same time."

export const VoicesRpcLive = VoicesRpcs.toLayer(Effect.gen(function*() {
  const eleven = yield* ElevenLabs
  const previews = yield* VoicePreviews
  const home = yield* ViralHome
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const usage = yield* UsageRecords

  // Previews use the default model and land in ~/.viral/voice-previews/, named by voice and time. Their characters
  // are recorded for Settings › Usage.
  const preview = Effect.fn("VoicesRpc.preview")(function*(voiceId: string, text: string | null) {
    const model = "eleven_v4"
    const speech = yield* eleven.speak({ voiceId, model, text: text ?? SAMPLE })
    yield* previews.record(voiceId, model, speech.characters)
    const file = path.join(home.voicePreviews, `${voiceId}-${yield* Clock.currentTimeMillis}.mp3`)
    yield* fs.writeFile(file, speech.audio).pipe(Effect.orDie)
    return { path: file, characters: speech.characters }
  })

  return VoicesRpcs.of({
    ListVoices: () => eleven.voices,
    ExploreVoices: (query) => eleven.explore(query),
    AddLibraryVoice: ({ publicOwnerId, voiceId, name }) => eleven.addShared(publicOwnerId, voiceId, name),
    RemoveVoice: ({ voiceId }) => eleven.remove(voiceId),
    PreviewVoice: ({ voiceId, text }) => preview(voiceId, text),
    DesignVoice: ({ description, text, projectId }) =>
      designVoices(description, text, projectId).pipe(
        Effect.provideService(ElevenLabs, eleven),
        Effect.provideService(UsageRecords, usage),
        Effect.provideService(ViralHome, home),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path)
      ),
    SaveDesignedVoice: ({ previewId, name, description }) => eleven.saveDesigned(previewId, name.trim() || "Designed voice", description.trim())
  })
}))
