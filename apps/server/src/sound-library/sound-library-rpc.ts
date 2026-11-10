import { SoundLibraryRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { UsageRecords } from "../usage/usage-records.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { generateSoundEffects } from "./sound-generator.ts"
import { SoundLibrary } from "./sound-library.ts"

export const SoundLibraryRpcLive = SoundLibraryRpcs.toLayer(Effect.gen(function*() {
  const sounds = yield* SoundLibrary
  const eleven = yield* ElevenLabs
  const usage = yield* UsageRecords
  return SoundLibraryRpcs.of({
    ListSoundEffects: ({ category }) => sounds.list(category),
    GetSoundEffect: ({ id }) => sounds.get(id),
    GenerateSoundEffect: (request) =>
      generateSoundEffects(request).pipe(
        Effect.provideService(ElevenLabs, eleven),
        Effect.provideService(SoundLibrary, sounds),
        Effect.provideService(UsageRecords, usage)
      ),
    DeleteSoundEffect: ({ id }) => sounds.remove(id)
  })
}))
