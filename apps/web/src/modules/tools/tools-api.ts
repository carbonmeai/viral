import { Effect, Stream } from "effect"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../api/client.ts"
import { foldInstall, initialInstall } from "./tools-values.ts"

// Each tool's state; Settings and the first-run check share it.
export const toolsAtom = ViralClient.runtime.atom(Effect.gen(function*() {
  const client = yield* ViralClient
  return yield* client("ListTools", undefined)
})).pipe(Atom.keepAlive)

// Installs the missing tools while something shows it, folding the progress into one state per tool.
// Refreshing it tries again.
export const installAtom = ViralClient.runtime.atom(Stream.unwrap(Effect.gen(function*() {
  const client = yield* ViralClient
  const tools = yield* client("ListTools", undefined)
  return client("InstallTools", undefined).pipe(Stream.scan(() => initialInstall(tools), foldInstall))
})))
