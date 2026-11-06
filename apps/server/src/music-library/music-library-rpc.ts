import { MusicLibraryRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { MusicLibrary } from "./music-library.ts"

export const MusicLibraryRpcLive = MusicLibraryRpcs.toLayer(Effect.gen(function*() {
  const music = yield* MusicLibrary
  return MusicLibraryRpcs.of({
    AddMusicTrack: ({ file, title, rights }) => music.add(file, title, rights),
    SetMusicTrackRights: ({ id, rights }) => music.setRights(id, rights),
    SetMusicTrackBeat: ({ id, bpm, dropS }) => music.setBeat(id, bpm, dropS),
    ListMusicTracks: () => music.list,
    GetMusicTrack: ({ id }) => music.get(id),
    RemoveMusicTrack: ({ id }) => music.remove(id)
  })
}))
