import type { KeyName, KeyProvider } from "@viral/contracts"
import { Effect } from "effect"
import { Atom, Reactivity } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"

// Reads, each tagged so a save on the same topic refreshes it.
export const accountsAtom = ViralClient.query("GetAccounts", undefined, { reactivityKeys: ["accounts"] })
export const cliModelsAtom = ViralClient.query("GetCliModels", undefined, { reactivityKeys: ["accounts"] })
export const appSettingsAtom = ViralClient.query("GetSettings", undefined, { reactivityKeys: ["settings"] })
export const storageAtom = ViralClient.query("GetStorage", undefined, { reactivityKeys: ["storage"] })
// the models a key can use, from the vendor's own list (the server keeps it for a day); refreshed with Accounts
export const keyModelsAtom = Atom.family((provider: KeyProvider) => ViralClient.query("ListKeyModels", { provider }, { reactivityKeys: ["accounts"] }))
export const modelEvalsAtom = ViralClient.query("GetModelEvals", undefined, { reactivityKeys: ["evals"] })
export const usageAtom = Atom.family((days: number) => ViralClient.query("GetUsage", { days }, { reactivityKeys: ["usage"] }))
// the ElevenLabs plan's characters left; the server keeps ElevenLabs' answer for a minute
export const elevenLabsPlanAtom = ViralClient.query("GetElevenLabsPlan", undefined, { reactivityKeys: ["usage", "accounts"] })

// Writes.
// Key writes, one atom per key: a mutation atom interrupts its own previous call, so with one per key, checking one
// key never cuts short another's check. Each refreshes Accounts.
const refreshAccounts = <A, E, R>(effect: Effect.Effect<A, E, R>) => Reactivity.mutation(effect, ["accounts"])
export const setSecret = Atom.family((name: KeyName) =>
  ViralClient.runtime.fn(Effect.fnUntraced(function*(value: string) {
    const client = yield* ViralClient
    return yield* refreshAccounts(client("SetSecret", { name, value }))
  }))
)
export const removeSecret = Atom.family((name: KeyName) =>
  ViralClient.runtime.fn(Effect.fnUntraced(function*(_: void) {
    const client = yield* ViralClient
    return yield* refreshAccounts(client("RemoveSecret", { name }))
  }))
)
// a pasted value, or null for the key in use
export const testSecret = Atom.family((name: KeyName) =>
  ViralClient.runtime.fn(Effect.fnUntraced(function*(value: string | null) {
    const client = yield* ViralClient
    return yield* refreshAccounts(client("TestSecret", { name, value }))
  }))
)
export const setDefaultAgent = ViralClient.mutation("SetDefaultAgent")
export const setStageAgent = ViralClient.mutation("SetStageAgent")
export const setTranscriber = ViralClient.mutation("SetTranscriber")

