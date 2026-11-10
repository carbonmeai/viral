import { ChatRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { ShortChat } from "./chat-service.ts"

export const ChatRpcLive = ChatRpcs.toLayer(Effect.gen(function*() {
  const chat = yield* ShortChat
  return ChatRpcs.of({
    GetChat: ({ projectId }) => chat.get(projectId),
    SubscribeChat: ({ projectId, afterSeq }) => chat.subscribe(projectId, afterSeq),
    SendChat: ({ projectId, step, text, stopRun }) => chat.send(projectId, step, text, stopRun ?? false),
    DoChatAction: ({ projectId, step, label, action, stopRun }) => chat.act(projectId, step, label, action, stopRun ?? false)
  })
}))
