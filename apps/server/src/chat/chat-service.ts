import {
  ChatFailed,
  type ChatAction,
  type ChatEntry,
  type ChatIntentAction,
  type ChatItem,
  type ChatSent,
  type ChatStep,
  type ChatUpdate,
  MusicTrackId,
  PresetId,
  type Project,
  type ProjectId,
  type ProjectNotFound,
  type Run,
  type RunEvent,
  type RunOwner,
  type RunRequest,
  type StageName,
  type StageRun,
  Transcript
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, PubSub, Schema, Semaphore, Stream } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { MusicBeds } from "../music-bed/music-beds.ts"
import { Presets } from "../presets/presets.ts"
import { Projects } from "../projects/projects.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { StageRegistry } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { type IntentContext, runIntent } from "./chat-intent.ts"
import { type ChatRefs, ChatStore } from "./chat-store.ts"
import { AGENT_STAGE_NAMES, describeStep } from "./describe-step.ts"

// The stage each step of the editor is about. Music and style are fitted and applied in assemble.
export const STAGE_OF_STEP: Record<ChatStep, StageName> = {
  script: "script",
  sections: "sections",
  moments: "moments",
  voice: "voice",
  shots: "shots",
  music: "assemble",
  render: "render",
  publish: "metadata",
  thumbnail: "thumbnail",
  style: "assemble"
}

// The editor's step for a stage, for items written from run events.
export const STEP_OF_STAGE: Partial<Record<StageName, ChatStep>> = {
  script: "script",
  sections: "sections",
  moments: "moments",
  voice: "voice",
  shots: "shots",
  assemble: "music",
  render: "render",
  metadata: "publish",
  thumbnail: "thumbnail"
}

const STEP_NAMES: Record<ChatStep, string> = {
  script: "Script",
  sections: "Sections",
  moments: "Ranking",
  voice: "Voice",
  shots: "Shots",
  music: "Music",
  render: "Render",
  publish: "Post",
  thumbnail: "Thumbnail",
  style: "Style"
}
const stepName = (stage: StageName) => STEP_NAMES[STEP_OF_STAGE[stage] ?? "script"]

const TranscriptJson = Schema.fromJsonString(Transcript)

interface Posted {
  readonly projectId: ProjectId
  readonly entry: ChatEntry
}

// One running conversation per short. It follows every run of the short (RunManager.events, so the run loop itself
// is unchanged) and writes what happened: each agent's version with its change card and checks, notes from the steps
// without an agent, gates, approvals and failures. Your messages go where the open step says (decision 9): at a gate
// they're a rejection with your note; on an approved agent step the short runs again from it with the note; on a step
// without an agent the intent agent turns them into an existing action. An older short's conversation is rebuilt once
// from its runs. All writes go through one semaphore, so items stay in order and are written once.
export class ShortChat extends Context.Service<ShortChat, {
  get(projectId: ProjectId): Effect.Effect<{ readonly items: ReadonlyArray<ChatEntry>; readonly lastSeq: number }, ProjectNotFound>
  subscribe(projectId: ProjectId, afterSeq: number): Stream.Stream<ChatUpdate, ProjectNotFound>
  send(projectId: ProjectId, step: ChatStep, text: string, stopRun: boolean): Effect.Effect<ChatSent, ProjectNotFound | ChatFailed>
  act(projectId: ProjectId, step: ChatStep, label: string, action: ChatIntentAction, stopRun: boolean): Effect.Effect<ChatSent, ProjectNotFound | ChatFailed>
}>()("@viral/server/chat/chat-service/ShortChat") {
  static readonly layer = Layer.effect(
    ShortChat,
    Effect.gen(function*() {
      const store = yield* ChatStore
      const runStore = yield* RunStore
      const runs = yield* RunManager
      const registry = yield* StageRegistry
      const projects = yield* Projects
      const artifacts = yield* Artifacts
      const sources = yield* Sources
      const agent = yield* AgentSession
      const presets = yield* Presets
      const library = yield* MusicLibrary
      const beds = yield* MusicBeds
      const eleven = yield* ElevenLabs
      const fs = yield* FileSystem.FileSystem
      const posted = yield* PubSub.unbounded<Posted>()
      const lock = yield* Semaphore.make(1)

      const describe = (project: Project, stageRun: StageRun, earlier: boolean) =>
        describeStep(project, stageRun, earlier).pipe(
          Effect.provideService(Artifacts, artifacts),
          Effect.provideService(RunStore, runStore),
          Effect.provideService(Sources, sources)
        )

      const append = Effect.fn("ShortChat.append")(function*(projectId: ProjectId, role: ChatEntry["role"], item: ChatItem, refs: ChatRefs = {}) {
        const entry = yield* store.append(projectId, role, item, refs)
        yield* PubSub.publish(posted, { projectId, entry })
        return entry
      })

      // Writes an item from a run once (by its stage run or request).
      const once = Effect.fn("ShortChat.once")(function*(
        projectId: ProjectId,
        role: ChatEntry["role"],
        item: ChatItem,
        refs: ChatRefs & { readonly key: { readonly stageRunId?: StageRun["id"]; readonly requestId?: RunRequest["id"] } }
      ) {
        if (yield* store.has(projectId, item._tag, refs.key)) return
        yield* append(projectId, role, item, refs)
      })

      const hasStepItem = (projectId: ProjectId, stageRunId: StageRun["id"]) =>
        Effect.map(
          Effect.all([store.has(projectId, "AgentMade", { stageRunId }), store.has(projectId, "StepNote", { stageRunId })]),
          ([a, b]) => a || b
        )

      const writeStep = Effect.fn("ShortChat.writeStep")(function*(project: Project, stageRun: StageRun, earlier: boolean) {
        if (yield* hasStepItem(project.id, stageRun.id)) return
        const item = yield* describe(project, stageRun, earlier)
        if (item === null) return
        // a gate asked again after a restart shows the same version: said once
        if (item._tag === "AgentMade" && item.version !== null) {
          const said = (yield* store.list(project.id)).some((e) =>
            e.item._tag === "AgentMade" && e.item.stage === item.stage && e.item.version === item.version)
          if (said) return
        }
        yield* append(project.id, "agent", item, { stage: stageRun.stage, runId: stageRun.runId, stageRunId: stageRun.id })
      })

      const writeAnswer = Effect.fn("ShortChat.writeAnswer")(function*(projectId: ProjectId, request: RunRequest) {
        const response = request.response
        if (response === null) return
        const refs = { stage: request.stage, runId: request.runId, stageRunId: request.stageRunId, requestId: request.id, key: { requestId: request.id } }
        if (response._tag === "Reject") {
          // your words from the waiting bar or the CLI (the chat writes its own before answering)
          const step = STEP_OF_STAGE[request.stage] ?? "script"
          const action: ChatAction = response.to !== undefined && response.to !== request.stage
            ? { _tag: "Action", kind: "SendBack", summary: `Sent back to ${stepName(response.to)} with your note` }
            : { _tag: "Revise", stage: request.stage }
          yield* once(projectId, "you", { _tag: "YouSaid", step, text: response.note, action }, refs)
        } else {
          yield* once(projectId, "app", { _tag: "Approved", stage: request.stage, how: response._tag === "Edit" ? "edit" : "approve" }, refs)
        }
      })

      // An older short's conversation, rebuilt once from its runs: each step's current version (no change cards), your
      // notes at its gates and your approvals, in the order they happened.
      const backfill = Effect.fn("ShortChat.backfill")(function*(project: Project) {
        const owner: RunOwner = { _tag: "Project", id: project.id }
        // finished runs only: a run going now writes its own items as its events come
        const all = [...(yield* runStore.listRuns(owner))].reverse().filter((r) => r.status !== "running" && r.status !== "waiting")
        if (all.length === 0) return
        const stageRuns = (yield* Effect.forEach(all, (r) => runStore.listStageRuns(r.id))).flat()
        const requests = (yield* Effect.forEach(all, (r) => runStore.listRequests(r.id))).flat()
        // the latest attempt of each stage that made something
        const latest = new Map<StageName, StageRun>()
        for (const s of stageRuns) if (s.status === "succeeded" || s.status === "waiting") latest.set(s.stage, s)
        for (const s of stageRuns) {
          if (latest.get(s.stage)?.id === s.id) yield* writeStep(project, s, true)
          for (const request of requests.filter((r) => r.stageRunId === s.id)) {
            if (request.status === "pending") {
              yield* once(project.id, "app", { _tag: "Gate", stage: request.stage, title: request.title }, {
                stage: request.stage, runId: request.runId, stageRunId: request.stageRunId, requestId: request.id, key: { requestId: request.id }
              })
            } else yield* writeAnswer(project.id, request)
          }
        }
        // a short whose runs made nothing yet (its first run just started) has nothing earlier to show
        if ((yield* store.lastSeq(project.id)) > 0) {
          yield* append(project.id, "app", { _tag: "Earlier", text: "Earlier work on this short, from before the chat" })
        }
      })

      // shorts whose thread exists or was rebuilt since the server started
      const ensured = new Set<ProjectId>()
      const ensure = Effect.fn("ShortChat.ensure")(function*(project: Project) {
        if (ensured.has(project.id)) return
        if ((yield* store.lastSeq(project.id)) === 0) yield* backfill(project)
        ensured.add(project.id)
      })

      // What a run event adds to the short's conversation.
      const onEvent = Effect.fn("ShortChat.onEvent")(function*(projectId: ProjectId, event: RunEvent) {
        const project = yield* projects.get(projectId).pipe(Effect.option)
        if (Option.isNone(project)) return
        yield* ensure(project.value)
        switch (event._tag) {
          case "StageFinished": {
            const s = event.stageRun
            if (s.status === "succeeded") yield* writeStep(project.value, s, false)
            else if (s.status === "failed" && s.error !== null && !s.error.startsWith("rejected")) {
              yield* once(projectId, "app", { _tag: "Failed", stage: s.stage, message: s.error }, {
                stage: s.stage, runId: s.runId, stageRunId: s.id, key: { stageRunId: s.id }
              })
            }
            return
          }
          case "RequestRaised": {
            const request = event.request
            const stageRun = yield* runStore.getStageRun(request.stageRunId)
            if (Option.isSome(stageRun)) yield* writeStep(project.value, stageRun.value, false)
            yield* once(projectId, "app", { _tag: "Gate", stage: request.stage, title: request.title }, {
              stage: request.stage, runId: request.runId, stageRunId: request.stageRunId, requestId: request.id, key: { requestId: request.id }
            })
            return
          }
          case "RequestAnswered":
            return yield* writeAnswer(projectId, event.request)
          default:
            return
        }
      })

      // the writer: one fiber, so items are written in the order the runs' events happen
      yield* runs.events.pipe(
        Stream.runForEach((p) =>
          p.owner._tag !== "Project" || p.update._tag !== "Event"
            ? Effect.void
            : lock.withPermits(1)(onEvent(p.owner.id, p.update.event)).pipe(
              Effect.catchCause((cause) => Effect.logWarning("chat: couldn't write an item", cause))
            )
        ),
        Effect.forkScoped
      )

      const thread = Effect.fn("ShortChat.thread")(function*(projectId: ProjectId) {
        const project = yield* projects.get(projectId)
        yield* lock.withPermits(1)(ensure(project))
        return project
      })

      const get = Effect.fn("ShortChat.get")(function*(projectId: ProjectId) {
        yield* thread(projectId)
        const items = yield* store.list(projectId)
        return { items, lastSeq: items.at(-1)?.seq ?? 0 }
      })

      const subscribe = (projectId: ProjectId, afterSeq: number): Stream.Stream<ChatUpdate, ProjectNotFound> =>
        Stream.unwrap(Effect.gen(function*() {
          // subscribed before the snapshot is read, so nothing written in between is lost
          const live = yield* PubSub.subscribe(posted)
          yield* thread(projectId)
          const items = yield* store.list(projectId, afterSeq)
          const lastSeq = items.at(-1)?.seq ?? Math.max(afterSeq, yield* store.lastSeq(projectId))
          const snapshot: ChatUpdate = { _tag: "Snapshot", items, lastSeq }
          return Stream.concat(
            Stream.make(snapshot),
            Stream.fromSubscription(live).pipe(
              Stream.filter((p) => p.projectId === projectId && p.entry.seq > lastSeq),
              Stream.map((p): ChatUpdate => ({ _tag: "Item", entry: p.entry }))
            )
          )
        }))

      // Where the short's run stands: the run going (running or waiting), and the gate it waits at.
      const standing = Effect.fn("ShortChat.standing")(function*(projectId: ProjectId) {
        const owner: RunOwner = { _tag: "Project", id: projectId }
        const going = (yield* runStore.listRuns(owner)).find((r) => r.status === "running" || r.status === "waiting") ?? null
        const pending = going === null ? null : (yield* runStore.listPendingRequests).find((r) => r.runId === going.id) ?? null
        const current = going === null ? null : (yield* runStore.listStageRuns(going.id)).at(-1)?.stage ?? null
        return { owner, going, pending, current }
      })

      const approved = Effect.fn("ShortChat.approved")(function*(owner: RunOwner, stage: StageName) {
        const stages = yield* registry.stagesFor(owner).pipe(Effect.orElseSucceed(() => []))
        const definition = stages.find((s) => s.name === stage)
        if (definition === undefined) return false
        const latest = yield* runStore.latestArtifact(owner, definition.artifact)
        return Option.isSome(latest) && (latest.value.stageRunStatus === null || latest.value.stageRunStatus === "succeeded" || latest.value.stageRunStatus === "reused")
      })

      const hasStage = Effect.fn("ShortChat.hasStage")(function*(owner: RunOwner, stage: StageName) {
        const stages = yield* registry.stagesFor(owner).pipe(Effect.orElseSucceed(() => []))
        return stages.some((s) => s.name === stage)
      })

      const said = (projectId: ProjectId, step: ChatStep, text: string, action: ChatAction, refs: ChatRefs = {}) =>
        append(projectId, "you", { _tag: "YouSaid", step, text, action }, { stage: STAGE_OF_STEP[step], ...refs })

      const busyReason = (current: StageName | null, stage: StageName) =>
        `The run is on ${current === null ? "another step" : stepName(current)}. Stop it and redo from ${stepName(stage)}?`

      const start = (owner: RunOwner, from: StageName, note?: string) =>
        runs.start(owner, from, note === undefined ? {} : { note }).pipe(Effect.mapError((e) => new ChatFailed({ message: e.message })))

      // A message to an agent step: its gate, a redo with the note, or not now.
      const toAgent = Effect.fn("ShortChat.toAgent")(function*(project: Project, step: ChatStep, stage: StageName, text: string, stopRun: boolean) {
        const { owner, going, pending, current } = yield* standing(project.id)
        if (pending !== null && pending.stage === stage) {
          const entry = yield* said(project.id, step, text, { _tag: "Revise", stage }, { runId: pending.runId, stageRunId: pending.stageRunId, requestId: pending.id })
          yield* runs.respond(pending.id, { _tag: "Reject", note: text }).pipe(Effect.mapError(() => new ChatFailed({ message: "That step isn't waiting any more." })))
          return { said: entry, replies: [], run: going } satisfies ChatSent
        }
        if (!(yield* approved(owner, stage))) {
          const entry = yield* said(project.id, step, text, { _tag: "NotDone", reason: `${STEP_NAMES[step]} opens when the run gets there.`, offer: null, retry: null })
          return { said: entry, replies: [], run: going } satisfies ChatSent
        }
        if (going !== null) {
          if (!stopRun) {
            const entry = yield* said(project.id, step, text, { _tag: "NotDone", reason: busyReason(current, stage), offer: stage, retry: null })
            return { said: entry, replies: [], run: going } satisfies ChatSent
          }
          yield* runs.cancel(going.id)
        }
        // your words first, then the run they start, so the thread reads in order
        const entry = yield* said(project.id, step, text, { _tag: "Redo", from: stage })
        const run = yield* start(owner, stage, text)
        return { said: entry, replies: [], run } satisfies ChatSent
      })

      // What the intent agent gets to choose from.
      const intentContext = Effect.fn("ShortChat.intentContext")(function*(project: Project, step: ChatStep, text: string) {
        const owner = { _tag: "Project", id: project.id } as const
        const voices = yield* eleven.voices.pipe(Effect.orElseSucceed(() => []))
        const preset = project.presetId === null
          ? Option.fromNullishOr((yield* presets.list).find((p) => p.isDefault))
          : yield* presets.get(project.presetId).pipe(Effect.option)
        const presetVoice = Option.match(preset, { onNone: () => null, onSome: (p) => p.config.voice?.voiceId ?? null })
        const voiceId = project.voiceId ?? presetVoice
        const words = yield* Effect.gen(function*() {
          const file = Option.flatMapNullishOr(yield* artifacts.latest(owner, "voiceover-transcript"), artifacts.resolve)
          if (Option.isNone(file)) return []
          const transcript = yield* fs.readFileString(file.value).pipe(Effect.flatMap(Schema.decodeEffect(TranscriptJson)))
          return transcript.segments.flatMap((s) => s.words.map((w) => w.w))
        }).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
        const bed = yield* beds.get(project.id).pipe(Effect.orElseSucceed(() => null))
        const styles = yield* presets.list
        return {
          step,
          text,
          format: project.format,
          voices: voices.map((v) => ({ id: v.voiceId, name: v.name, current: v.voiceId === voiceId })),
          songs: (yield* library.list).map((t) => ({ id: t.id, title: t.title, fittable: t.bpm !== null && t.dropS !== null, current: t.id === project.musicTrackId })),
          words,
          dropWord: bed?.bed.dropWord ?? null,
          styles: styles.map((s) => ({
            id: s.id,
            name: s.name,
            current: Option.match(preset, { onNone: () => false, onSome: (p) => p.id === s.id })
          }))
        } satisfies IntentContext
      })

      // Checks one of the existing actions for a step without an agent and makes its settings; `go` then answers the
      // gate or starts the run (written after your message, so the thread reads in order).
      const perform = Effect.fn("ShortChat.perform")(function*(
        project: Project,
        action: ChatIntentAction,
        stopRun: boolean
      ): Effect.fn.Return<{ readonly action: ChatAction; readonly refs: ChatRefs; readonly go: Effect.Effect<Run | null, ChatFailed> }, ChatFailed> {
        const fail = (message: string) => new ChatFailed({ message })
        const { owner, going, pending, current } = yield* standing(project.id)
        const notDone = (reason: string, offer: StageName | null) =>
          ({ action: { _tag: "NotDone", reason, offer, retry: offer === null ? null : action } as ChatAction, refs: {}, go: Effect.succeed(going) })
        const done = (kind: string, summary: string, go: Effect.Effect<Run | null, ChatFailed>, refs: ChatRefs = {}) =>
          ({ action: { _tag: "Action", kind, summary } as ChatAction, refs, go })
        const answer = (note: string, to?: StageName) =>
          runs.respond(pending!.id, to === undefined ? { _tag: "Reject", note } : { _tag: "Reject", note, to }).pipe(
            Effect.as(going),
            Effect.mapError(() => fail("That step isn't waiting any more."))
          )
        const gateRefs = pending === null ? {} : { requestId: pending.id, runId: pending.runId, stageRunId: pending.stageRunId }
        // the run going is stopped first when you said so; otherwise the action waits for your yes
        const busy = going !== null && !stopRun
        const stopThen = (go: Effect.Effect<Run | null, ChatFailed>) =>
          going === null ? go : runs.cancel(going.id).pipe(Effect.andThen(go))
        switch (action._tag) {
          case "CantDo":
            return notDone("Nothing to do for that here.", null)
          case "SetVoice":
          case "NewTake": {
            const voiceAt = pending !== null && pending.stage === "voice"
            const reached = yield* approved(owner, "voice")
            if (!voiceAt && reached && busy) return notDone(busyReason(current, "voice"), "voice")
            if (action._tag === "SetVoice") {
              const voices = yield* eleven.voices.pipe(Effect.orElseSucceed(() => []))
              const voice = voices.find((v) => v.voiceId === action.voiceId)
              if (voice === undefined) return yield* fail("That voice isn't one of yours.")
              yield* projects.setVoice(project.id, voice.voiceId).pipe(Effect.mapError((e) => fail(e.message)))
            }
            const what = action._tag === "SetVoice" ? "New voice; a new take is being made" : "A new take is being made"
            if (voiceAt) return done(action._tag, what, answer(action._tag === "SetVoice" ? "Use the new voice." : "Another take, please."), gateRefs)
            if (!reached) {
              return action._tag === "SetVoice"
                ? done("SetVoice", "The voice is set for when the run gets to it", Effect.succeed(going))
                : notDone("Voice opens when the run gets there.", null)
            }
            return done(action._tag, what, stopThen(start(owner, "voice")))
          }
          case "Refit":
          case "AutoArrangement": {
            if (project.format !== "narrated") return notDone("Cut-downs and rankings play their videos' own sound, with no song.", null)
            const trackId = action._tag === "Refit" && action.trackId !== undefined ? action.trackId : project.musicTrackId
            if (trackId !== null) {
              const track = yield* library.get(MusicTrackId.make(trackId)).pipe(Effect.mapError(() => fail("That song isn't in your library.")))
              if (track.bpm === null || track.dropS === null) return yield* fail(`“${track.title}” can't be fitted yet: its tempo and drop aren't known.`)
            }
            if (!(yield* approved(owner, "voice"))) {
              if (action._tag === "Refit") yield* projects.setMusic(project.id, trackId === null ? null : MusicTrackId.make(trackId)).pipe(Effect.mapError((e) => fail(e.message)))
              return done(action._tag, "Set for when the short is laid out", Effect.succeed(going))
            }
            if (busy) return notDone(busyReason(current, "assemble"), "assemble")
            if (action._tag === "AutoArrangement") {
              return done("AutoArrangement", "The arrangement is automatic again; refitting the music", stopThen(
                beds.arrange(project.id, null).pipe(Effect.mapError((e) => fail(e._tag === "MusicArrangementInvalid" ? e.problems.join("; ") : "That short is gone.")))
              ))
            }
            const summary = trackId === null
              ? "Voice only now, no song"
              : action.dropWord !== undefined && action.dropWord !== null
              ? "Moving the drop; refitting the music"
              : "Refitting the music"
            return done("Refit", summary, stopThen(
              beds.refit(project.id, trackId === null ? null : MusicTrackId.make(trackId), action.dropWord).pipe(Effect.mapError((e) => fail(e.message)))
            ))
          }
          case "SetStyle": {
            const preset = yield* presets.get(PresetId.make(action.presetId)).pipe(Effect.mapError(() => fail("That style doesn't exist.")))
            const renderAt = pending !== null && pending.stage === "render"
            const reached = yield* approved(owner, "assemble")
            if (!renderAt && reached && busy) return notDone(busyReason(current, "assemble"), "assemble")
            yield* projects.setPreset(project.id, preset.id).pipe(Effect.mapError((e) => fail(e.message)))
            if (renderAt) return done("SetStyle", `Style ${preset.name}; re-rendering`, answer(`Use the style ${preset.name}.`, "assemble"), gateRefs)
            if (!reached) return done("SetStyle", `Style ${preset.name}, for when the short is laid out`, Effect.succeed(going))
            return done("SetStyle", `Style ${preset.name}; re-rendering, no agent cost`, stopThen(start(owner, "assemble")))
          }
          case "SendBack": {
            if (!(yield* hasStage(owner, action.to))) return notDone(`This short has no ${action.to} step.`, null)
            if (pending !== null && pending.stage === "render") {
              return done("SendBack", `Sent back to ${stepName(action.to)} with your note`, answer(action.note, action.to), gateRefs)
            }
            if (!(yield* approved(owner, "render"))) return notDone("Render opens when the run gets there.", null)
            if (busy) return notDone(busyReason(current, action.to), action.to)
            return done("SendBack", `Redoing from ${stepName(action.to)} with your note`, stopThen(start(owner, action.to, action.note)))
          }
        }
      })

      // A message to a step without an agent: the intent agent picks the action, the server checks it and runs it.
      const toIntent = Effect.fn("ShortChat.toIntent")(function*(project: Project, step: ChatStep, text: string, stopRun: boolean) {
        const ctx = yield* intentContext(project, step, text)
        const intent = yield* runIntent(agent, ctx).pipe(Effect.mapError((e) => new ChatFailed({ message: `The agent couldn't read that: ${e.message}` })))
        const result = yield* perform(project, intent.answer.action, stopRun)
        const entry = yield* said(project.id, step, text, result.action, result.refs)
        const reply = yield* append(project.id, "agent", {
          _tag: "AgentSaid",
          step,
          text: intent.answer.reply,
          model: intent.model,
          provider: intent.provider,
          billing: intent.billing,
          costUsd: intent.costUsd
        }, { stage: STAGE_OF_STEP[step] })
        const run = yield* result.go
        return { said: entry, replies: [reply], run } satisfies ChatSent
      })

      const send = Effect.fn("ShortChat.send")(function*(projectId: ProjectId, step: ChatStep, text: string, stopRun: boolean) {
        const project = yield* thread(projectId)
        const words = text.trim()
        if (words === "") return yield* new ChatFailed({ message: "Say what you'd like changed." })
        const stage = STAGE_OF_STEP[step]
        // free text at an agent step goes straight to its agent (decision 9)
        if (AGENT_STAGE_NAMES.includes(stage) && step !== "style") return yield* toAgent(project, step, stage, words, stopRun)
        return yield* toIntent(project, step, words, stopRun)
      })

      // A suggestion chip's own action (or "Stop and redo" with the action the intent agent chose).
      const act = Effect.fn("ShortChat.act")(function*(projectId: ProjectId, step: ChatStep, label: string, action: ChatIntentAction, stopRun: boolean) {
        const project = yield* thread(projectId)
        const result = yield* perform(project, action, stopRun)
        const entry = yield* said(project.id, step, label, result.action, result.refs)
        const run = yield* result.go
        return { said: entry, replies: [], run } satisfies ChatSent
      })

      return ShortChat.of({ get, subscribe, send, act })
    })
  )
}
