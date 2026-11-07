import type { SourceSetId } from "@viral/contracts"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"

// A video set's page; a change to the set refreshes it (key `set:<id>`).
export const videoSetOverviewAtom = Atom.family((id: SourceSetId) =>
  ViralClient.query("GetVideoSetOverview", { id }, { reactivityKeys: [`set:${id}`] })
)

// Writes.
export const createVideoSet = ViralClient.mutation("CreateVideoSet")
export const startSetRun = ViralClient.mutation("StartSetRun")
export const renameVideoSet = ViralClient.mutation("RenameVideoSet")
export const deleteVideoSet = ViralClient.mutation("DeleteVideoSet")
export const createProjectFromSetProposal = ViralClient.mutation("CreateProjectFromSetProposal")
