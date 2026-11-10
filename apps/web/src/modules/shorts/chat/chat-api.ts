import type { ProjectId } from "@viral/contracts"
import { Effect, Stream } from "effect"
import { Atom } from "effect/reactivity"
import { ViralClient } from "../../../api/client.ts"
import { emptyThread, foldChat } from "./chat-values.ts"

// The short's conversation, followed live: the thread so far, then each item as the server writes it.
export const chatAtom = Atom.family((projectId: ProjectId) =>
  ViralClient.runtime.atom(Stream.unwrap(Effect.gen(function*() {
    const client = yield* ViralClient
    return client("SubscribeChat", { projectId, afterSeq: 0 }).pipe(Stream.scan(() => emptyThread, foldChat))
  })))
)

// Writes.
export const sendChat = ViralClient.mutation("SendChat")
export const doChatAction = ViralClient.mutation("DoChatAction")
