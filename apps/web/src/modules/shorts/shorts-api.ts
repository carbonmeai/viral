import type { ProjectId } from "@viral/contracts"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"

export const projectAtom = Atom.family((id: ProjectId) => ViralClient.query("GetProject", { id }, { reactivityKeys: [`project:${id}`] }))
export const projectRunsAtom = Atom.family((id: ProjectId) =>
  ViralClient.query("ListRuns", { owner: { _tag: "Project", id } }, { reactivityKeys: [`project:${id}`] })
)
