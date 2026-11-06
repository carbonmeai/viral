import { ViralClient } from "../../api/client.ts"

// Reads, each tagged so a save on the same topic refreshes it (Settings › Voice shares "presets" and "voices").
export const presetsAtom = ViralClient.query("ListPresets", undefined, { reactivityKeys: ["presets"] })
export const tracksAtom = ViralClient.query("ListMusicTracks", undefined, { reactivityKeys: ["music"] })
export const voicesAtom = ViralClient.query("ListVoices", undefined, { reactivityKeys: ["voices"] })

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
