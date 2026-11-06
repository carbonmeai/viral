import { VoicesRpcs } from "@viral/contracts"
import { Clock, Effect, FileSystem, Path } from "effect"
import { ViralHome } from "../home/viral-home.ts"
import { ElevenLabs } from "./eleven-labs.ts"

const SAMPLE = "This guy made a candy that hits every single taste at the exact same time."

export const VoicesRpcLive = VoicesRpcs.toLayer(Effect.gen(function*() {
  const eleven = yield* ElevenLabs
  const home = yield* ViralHome
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  // Previews use the default model and land in ~/.viral/voice-previews/, named by voice and time.
  const preview = Effect.fn("VoicesRpc.preview")(function*(voiceId: string, text: string | null) {
    const speech = yield* eleven.speak({ voiceId, model: "eleven_v4", text: text ?? SAMPLE })
    const file = path.join(home.voicePreviews, `${voiceId}-${yield* Clock.currentTimeMillis}.mp3`)
    yield* fs.writeFile(file, speech.audio).pipe(Effect.orDie)
    return { path: file, characters: speech.characters }
  })

  return VoicesRpcs.of({
    ListVoices: () => eleven.voices,
    ExploreVoices: (query) => eleven.explore(query),
    AddLibraryVoice: ({ publicOwnerId, voiceId, name }) => eleven.addShared(publicOwnerId, voiceId, name),
    RemoveVoice: ({ voiceId }) => eleven.remove(voiceId),
    PreviewVoice: ({ voiceId, text }) => preview(voiceId, text)
  })
}))
