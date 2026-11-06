import type { RunId, SourceId } from "@viral/contracts"
import { Effect, Stream } from "effect"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"
import { emptyProgress, foldRun } from "./run-progress.ts"

// A video's page; a save on it refreshes it (key `source:<id>`).
export const sourceOverviewAtom = Atom.family((sourceId: SourceId) =>
  ViralClient.query("GetSourceOverview", { sourceId }, { reactivityKeys: [`source:${sourceId}`] })
)

// A run as it happens: its stored history first, then live events and progress, folded into one state.
export const runProgressAtom = Atom.family((runId: RunId) =>
  ViralClient.runtime.atom(Stream.unwrap(Effect.gen(function*() {
    const client = yield* ViralClient
    return client("SubscribeRun", { runId, afterSeq: 0 }).pipe(Stream.scan(() => emptyProgress, foldRun))
  })))
)

// Writes.
export const createSource = ViralClient.mutation("CreateSource")
export const startSourceRun = ViralClient.mutation("StartSourceRun")
export const setSourceDetails = ViralClient.mutation("SetSourceDetails")
export const createProjectFromProposal = ViralClient.mutation("CreateProjectFromProposal")
export const startProjectRun = ViralClient.mutation("StartProjectRun")
