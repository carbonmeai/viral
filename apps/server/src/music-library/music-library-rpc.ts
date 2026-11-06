import { MusicLibraryRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { MusicLibrary } from "./music-library.ts"

export const MusicLibraryRpcLive = MusicLibraryRpcs.toLayer(Effect.gen(function*() {
  const music = yield* MusicLibrary
  return MusicLibraryRpcs.of({
    AddMusicTrack: ({ file, title, rights }) => music.add(file, title, rights),
    AddMusicFolder: ({ folder, rights }) => music.addFolder(folder, rights),
    SetMusicTrackKind: ({ id, kind }) => music.setKind(id, kind),
    SetMusicTrackRights: ({ id, rights }) => music.setRights(id, rights),
    SetMusicTrackBeat: ({ id, bpm, dropS }) => music.setBeat(id, bpm, dropS),
    AnalyseMusicTrack: ({ id }) => music.analyse(id),
    ListMusicTracks: () => music.list,
    GetMusicTrack: ({ id }) => music.get(id),
    RemoveMusicTrack: ({ id }) => music.remove(id)
  })
}))
