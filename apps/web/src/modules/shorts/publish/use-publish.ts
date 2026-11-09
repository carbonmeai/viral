import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { PostText, PublishStatus, ShortWorkspace } from "@viral/contracts"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useState } from "react"
import { publishAgain as publishAgainRpc, publishStatusAtom, setPostText } from "./publish-api.ts"

// The server's problems with what you typed, or one plain line when it gave none.
const refused = (error: unknown, fallback: string): ReadonlyArray<string> => {
  const tagged = (typeof error === "object" && error !== null ? error : {}) as { readonly problems?: unknown; readonly message?: unknown }
  if (Array.isArray(tagged.problems)) return tagged.problems.filter((p): p is string => typeof p === "string")
  return [typeof tagged.message === "string" && tagged.message !== "" ? tagged.message : fallback]
}

export interface Publish {
  // null until the short is published (or while it loads)
  readonly status: PublishStatus | null
  // saving or publishing
  readonly busy: boolean
  readonly problems: ReadonlyArray<string>
  // saves the text to post with (null: back to the agent's); resolves true when it was saved
  readonly save: (post: PostText | null) => Promise<boolean>
  readonly publishAgain: () => Promise<void>
  readonly clearProblems: () => void
}

// The Publish step's state: the post text you chose and edited, saved on the short, and publishing it again. It
// reloads when the short's published version or its run changes (a re-render publishes when its run is done).
export function usePublish(ws: ShortWorkspace, refresh: () => void): Publish {
  const projectId = ws.project.id
  const result = useAtomValue(publishStatusAtom(projectId))
  const reload = useAtomRefresh(publishStatusAtom(projectId))
  const saveRpc = useAtomSet(setPostText, { mode: "promise" })
  const publishRpc = useAtomSet(publishAgainRpc, { mode: "promise" })
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])
  const version = ws.metadata?.version ?? null
  const runState = ws.run === null ? null : `${ws.run.id}:${ws.run.status}`
  useEffect(() => {
    if (version !== null) reload()
  }, [version, runState, reload])

  const status = ws.metadata === null ? null : Option.getOrNull(AsyncResult.value(result))

  const save = (post: PostText | null) => {
    setBusy(true)
    setProblems([])
    return saveRpc({ payload: { projectId, post }, reactivityKeys: [`publish:${projectId}`] })
      .then(() => true)
      .catch((e: unknown) => {
        setProblems(refused(e, "Couldn't save that. Is the server running?"))
        return false
      })
      .finally(() => setBusy(false))
  }

  const publishAgain = () => {
    setBusy(true)
    setProblems([])
    return publishRpc({ payload: { projectId }, reactivityKeys: [`short:${projectId}`] })
      .then(() => refresh())
      .catch((e: unknown) => setProblems(refused(e, "Couldn't publish. Is the server running?")))
      .finally(() => setBusy(false))
  }

  return { status, busy, problems, save, publishAgain, clearProblems: () => setProblems([]) }
}
