import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"

// Reads, each tagged so a save on the same topic refreshes it.
export const accountsAtom = ViralClient.query("GetAccounts", undefined, { reactivityKeys: ["accounts"] })
export const appSettingsAtom = ViralClient.query("GetSettings", undefined, { reactivityKeys: ["settings"] })
export const storageAtom = ViralClient.query("GetStorage", undefined, { reactivityKeys: ["storage"] })
export const voicesAtom = ViralClient.query("ListVoices", undefined, { reactivityKeys: ["voices"] })
export const presetsAtom = ViralClient.query("ListPresets", undefined, { reactivityKeys: ["presets"] })
export const usageAtom = Atom.family((days: number) => ViralClient.query("GetUsage", { days }, { reactivityKeys: ["usage"] }))

// Writes.
export const setSecret = ViralClient.mutation("SetSecret")
export const removeSecret = ViralClient.mutation("RemoveSecret")
export const setStageModel = ViralClient.mutation("SetStageModel")
export const setStageProvider = ViralClient.mutation("SetStageProvider")
export const setTranscriber = ViralClient.mutation("SetTranscriber")
export const setDefaultVoice = ViralClient.mutation("SetDefaultVoice")

