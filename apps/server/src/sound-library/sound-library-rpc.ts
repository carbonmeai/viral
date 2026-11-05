import { SoundLibraryRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { SoundLibrary } from "./sound-library.ts"

export const SoundLibraryRpcLive = SoundLibraryRpcs.toLayer(Effect.gen(function*() {
  const sounds = yield* SoundLibrary
  return SoundLibraryRpcs.of({
    ListSoundEffects: ({ category }) => sounds.list(category),
    GetSoundEffect: ({ id }) => sounds.get(id)
  })
}))
