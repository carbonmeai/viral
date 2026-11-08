import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"

// Reads, each tagged so a save on the same topic refreshes it.
export const accountsAtom = ViralClient.query("GetAccounts", undefined, { reactivityKeys: ["accounts"] })
export const cliModelsAtom = ViralClient.query("GetCliModels", undefined, { reactivityKeys: ["accounts"] })
export const appSettingsAtom = ViralClient.query("GetSettings", undefined, { reactivityKeys: ["settings"] })
export const storageAtom = ViralClient.query("GetStorage", undefined, { reactivityKeys: ["storage"] })
export const modelEvalsAtom = ViralClient.query("GetModelEvals", undefined, { reactivityKeys: ["evals"] })
export const usageAtom = Atom.family((days: number) => ViralClient.query("GetUsage", { days }, { reactivityKeys: ["usage"] }))
// the ElevenLabs plan's characters left; the server keeps ElevenLabs' answer for a minute
export const elevenLabsPlanAtom = ViralClient.query("GetElevenLabsPlan", undefined, { reactivityKeys: ["usage", "accounts"] })

// Writes.
export const setSecret = ViralClient.mutation("SetSecret")
export const removeSecret = ViralClient.mutation("RemoveSecret")
export const setDefaultAgent = ViralClient.mutation("SetDefaultAgent")
export const setStageAgent = ViralClient.mutation("SetStageAgent")
export const setTranscriber = ViralClient.mutation("SetTranscriber")

