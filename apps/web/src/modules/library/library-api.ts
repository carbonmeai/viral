import type { ExploreVoicesQuery } from "@viral/contracts"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"

// Reads, each tagged so a save on the same topic refreshes it.
export const presetsAtom = ViralClient.query("ListPresets", undefined, { reactivityKeys: ["presets"] })
export const tracksAtom = ViralClient.query("ListMusicTracks", undefined, { reactivityKeys: ["music"] })
export const voicesAtom = ViralClient.query("ListVoices", undefined, { reactivityKeys: ["voices"] })
// One page of ElevenLabs' shared library per query; keyed by the query's JSON so each page is fetched once.
export const exploreVoicesAtom = Atom.family((key: string) =>
  ViralClient.query("ExploreVoices", JSON.parse(key) as ExploreVoicesQuery, { reactivityKeys: ["voices"] })
)

// Writes.
export const createPreset = ViralClient.mutation("CreatePreset")
export const updatePreset = ViralClient.mutation("UpdatePreset")
export const renamePreset = ViralClient.mutation("RenamePreset")
export const setDefaultPreset = ViralClient.mutation("SetDefaultPreset")
export const deletePreset = ViralClient.mutation("DeletePreset")
export const addMusicTrack = ViralClient.mutation("AddMusicTrack")
export const setMusicTrackRights = ViralClient.mutation("SetMusicTrackRights")
export const setMusicTrackBeat = ViralClient.mutation("SetMusicTrackBeat")
export const analyseMusicTrack = ViralClient.mutation("AnalyseMusicTrack")
export const addMusicFolder = ViralClient.mutation("AddMusicFolder")
export const setMusicTrackKind = ViralClient.mutation("SetMusicTrackKind")
export const removeMusicTrack = ViralClient.mutation("RemoveMusicTrack")
export const previewVoice = ViralClient.mutation("PreviewVoice")
export const addLibraryVoice = ViralClient.mutation("AddLibraryVoice")
export const removeVoice = ViralClient.mutation("RemoveVoice")
// The default style's voice and pace (Library › Voices › Set as default).
export const setDefaultVoice = ViralClient.mutation("SetDefaultVoice")
// The generators (Library › Create): voices designed from a description (previews until one is saved), and sound
// effects kept in the sound library.
export const designVoice = ViralClient.mutation("DesignVoice")
export const saveDesignedVoice = ViralClient.mutation("SaveDesignedVoice")
export const generateSoundEffect = ViralClient.mutation("GenerateSoundEffect")
export const deleteSoundEffect = ViralClient.mutation("DeleteSoundEffect")
export const soundEffectsAtom = ViralClient.query("ListSoundEffects", { category: null }, { reactivityKeys: ["sounds"] })
// Viral videos kept to learn from (Library panel › Explore).
export const referencesAtom = ViralClient.query("ListReferenceVideos", undefined, { reactivityKeys: ["references"] })
