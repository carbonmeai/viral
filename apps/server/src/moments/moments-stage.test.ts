import { RankingPlan, type RankingProposal, RankingRenderPlan, type RunUpdate, type SourceId } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession, type AgentTask } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { ShortWorkspaces } from "../projects/short-workspace.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { Sources } from "../sources/sources.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-moments-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

// Every video says "Here is sentence k." from k·5+1 s to k·5+2.9 s, so the gaps between sentences run from k·5+2.9 s
// to k·5+6 s; a shot from gap k1 to gap k2 never cuts a sentence.
const words = Array.from({ length: 12 }, (_, k) =>
  ["Here", "is", "sentence", `${k}.`].map((w, i) => ({ w, s: k * 5 + 1 + i * 0.5, e: k * 5 + 1.4 + i * 0.5 }))).flat()
const gap = (k1: number, k2: number) => ({ start: k1 * 5 + 3.2, end: k2 * 5 + 5.6 })

// #1 from V1 (the longest), #2 from V2, #3 from V3, whose after runs from its red half into its blue half
const entries = (framesChecked: boolean) => [
  {
    rank: 1,
    video: 1,
    label: "Horse who gave up",
    emoji: "🐴",
    shots: [
      { role: "before", ...gap(0, 0), note: "lying in mud" },
      { role: "care", ...gap(2, 3), note: "vet with IV" },
      { role: "after", ...gap(5, 6), note: "running in a field" }
    ]
  },
  {
    rank: 2,
    video: 2,
    label: "Puppy walks again",
    emoji: "🐶",
    shots: [{ role: "before", ...gap(0, 0), note: "can't stand" }, { role: "care", ...gap(2, 2), note: "therapy" }, {
      role: "after",
      ...gap(4, 4),
      note: "walking"
    }]
  },
  {
    rank: 3,
    video: 3,
    label: "Street cat glow-up",
    emoji: "🐱",
    shots: [{ role: "before", ...gap(0, 0), note: "matted" }, { role: "care", ...gap(2, 2), note: "shaved" }, {
      role: "after",
      ...gap(5, 6),
      note: "fluffy",
      ...(framesChecked ? { framesChecked: true } : {})
    }]
  }
]

// The replayed agent: #1 not played last, then a shot whose ends look like different scenes, then that shot looked at.
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  const title = { lead: "Ranking Animal ", accent: "Comebacks" }
  if (asked.length === 1) return { title, entries: entries(false), order: [1, 2, 3] }
  return { title, entries: entries(asked.length >= 3) }
})

const runtime = () =>
  ManagedRuntime.make(
    Layer.mergeAll(
      RunManager.layer.pipe(Layer.provideMerge(PipelineStagesLive)),
      ShortWorkspaces.layer
    ).pipe(
      Layer.provideMerge(Layer.mergeAll(
        RunStore.layer,
        Artifacts.layer,
        Sources.layer,
        Projects.layer,
        replay,
        ElevenLabs.replay(() => new Uint8Array()),
        Transcriber.layer
      ))
    )
  )

const ffmpeg = (...args: Array<string>) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args])

test("the moments stage ranks the videos, snaps and checks the shots, catches drift, and assemble plans the render", { timeout: 120_000 }, async () => {
  const rt = runtime()
  const projectId = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const artifacts = yield* Artifacts
    const ids: Array<SourceId> = []
    // V1 green, V2 yellow with an end screen from 55 s, V3 red for 30 s then blue
    for (const [i, colours] of [["green"], ["yellow"], ["red", "blue"]].entries()) {
      const source = yield* sources.create({ origin: { _tag: "Url", url: `https://youtu.be/video${i}` }, rights: "unconfirmed", rightsNote: null })
      yield* sources.setDetails(source.id, `Rescue ${i + 1}`, `Channel ${i + 1}`)
      const owner = { _tag: "Source", id: source.id } as const
      const video = yield* artifacts.allocate(owner, "source-video")
      const file = join(video.dir, "source.mp4")
      if (colours.length === 1) {
        ffmpeg("-f", "lavfi", "-i", `color=c=${colours[0]}:s=320x180:d=60:r=10`, "-f", "lavfi", "-i", "sine=f=400:d=60", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file)
      } else {
        ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x180:d=30:r=10", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=30:r=10", "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", file)
      }
      yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
      const tx = yield* artifacts.allocate(owner, "transcript")
      writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify({ source: "x", language: "en", segments: [{ start: 0, end: 60, text: "x", words }] }))
      yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })
      yield* artifacts.record(yield* artifacts.allocate(owner, "ad-ranges"), {
        data: { ranges: i === 1 ? [{ start: 55, end: 60, kind: "end-screen", evidence: "x" }] : [] },
        path: null
      })
      ids.push(source.id)
    }
    const project = yield* (yield* Projects).create({
      sourceIds: [ids[0]!, ids[1]!, ids[2]!],
      title: "Top 3 Animal Comebacks",
      approach: "ranking",
      presetId: null,
      musicTrackId: null,
      brief: "rank the comebacks"
    })
    assert.equal(project.format, "ranking")
    return project.id
  }))

  await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Project", id: projectId }, null)
    const gate = yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && (u.event._tag === "RequestRaised" || u.event._tag === "RunFinished")),
      Stream.runHead,
      Effect.map(Option.getOrThrow)
    )
    assert.ok(gate._tag === "Event" && gate.event._tag === "RequestRaised", JSON.stringify(gate._tag === "Event" && gate.event._tag === "RunFinished" ? gate.event.run.error : gate))
    assert.equal(gate.event.request.title, "Approve the moments?")
    assert.equal(gate.event.request.payload?._tag, "RankingGate")
    yield* runs.respond(gate.event.request.id, { _tag: "Approve" })
    // assemble runs next; the render has its own test, so this one stops there
    yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && u.event._tag === "StageStarted" && u.event.stageRun.stage === "render"),
      Stream.runHead
    )
    yield* runs.cancel(run.id)
  }))

  assert.equal(asked.length, 3)
  assert.deepEqual(asked[0]!.tools?.map((t) => t.name), ["contact_sheet", "preview_moments", "tell_creator"], "a short's agent can speak to you in its chat")
  assert.match(asked[0]!.message, /\[V1 1\.0–2\.9\] Here is sentence 0\./, "the brief lists whole sentences")
  assert.match(asked[1]!.message, /#1 plays last/)
  assert.match(asked[2]!.message, /#3 shot 3 \(after, V3 28\.2–35\.6s\): its first and last frames look like different scenes/)
  assert.match(asked[2]!.message, /framesChecked: true/)

  const { plan, storyboard, rendered } = await rt.runPromise(Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const owner = { _tag: "Project", id: projectId } as const
    const moments = Option.getOrThrow(yield* artifacts.latest(owner, "ranking-plan"))
    const render = Option.getOrThrow(yield* artifacts.latest(owner, "ranking-render-plan"))
    return {
      plan: yield* Schema.decodeUnknownEffect(RankingPlan)(moments.data),
      storyboard: artifacts.resolve(moments),
      rendered: yield* Schema.decodeUnknownEffect(RankingRenderPlan)(render.data)
    }
  }))
  // shuffled with #1 last; framing detected (flat colour: landscape, the window); the drift stays flagged for you
  assert.equal(plan.order.at(-1), 1)
  assert.equal(plan.entries[0]!.shots[0]!.framing, "window")
  assert.equal(plan.entries[0]!.shots[0]!.text, "")
  assert.equal(plan.entries[0]!.shots[1]!.text, "Here is sentence 3.")
  assert.match(plan.warnings.join("\n"), /#3 shot 3.*different scenes/)
  assert.ok(storyboard !== null && existsSync(storyboard), "the storyboard was drawn")
  assert.ok(existsSync(join(dirname(storyboard), plan.entries[2]!.shots[2]!.lastFrame!)), "each shot has its last frame")
  // the renderer's plan: each entry's shots from its own video, no "via" line by default, V2's end screen kept out
  assert.deepEqual(rendered.title, ["Ranking Animal ", "Comebacks"])
  assert.deepEqual(rendered.order, plan.order)
  assert.equal(rendered.items.length, 3)
  assert.deepEqual(rendered.items[1]!.shots.map((s) => s.source), [1, 1, 1])
  assert.equal(rendered.items[0]!.channel, "Channel 1")
  assert.equal(rendered.via, false)
  assert.deepEqual(rendered.exclude_by_source, { "1": [[55, 60]] })
  assert.equal(rendered.videos.length, 3)

  // the editor's check: a moved shot is snapped to whole sentences and comes back that way
  const edit: RankingProposal = {
    title: plan.title,
    order: plan.order,
    entries: plan.entries.map((e) => ({ ...e, shots: e.shots.map(({ text: _t, firstFrame: _f, lastFrame: _l, ...s }) => s) }))
  }
  const moved: RankingProposal = {
    ...edit,
    entries: edit.entries.map((e) => e.rank === 2 ? { ...e, shots: [{ ...e.shots[0]!, start: 1.5, end: 5.6 }, ...e.shots.slice(1)] } : e)
  }
  const checked = await rt.runPromise(ShortWorkspaces.use((w) => w.checkRanking(projectId, moved)))
  assert.deepEqual(checked.problems, [])
  assert.equal(checked.proposal.entries.find((e) => e.rank === 2)!.shots[0]!.start, 0.92)
  const tooLong = await rt.runPromise(ShortWorkspaces.use((w) =>
    w.checkRanking(projectId, { ...edit, entries: edit.entries.map((e) => e.rank === 2 ? { ...e, label: "A label far too long for the list" } : e) })
  ))
  assert.match(tooLong.problems.join("\n"), /label is \d+ characters/)
  const workspace = await rt.runPromise(ShortWorkspaces.use((w) => w.get(projectId)))
  assert.equal(workspace.rankingPlan?.plan.entries.length, 3)
  assert.equal(workspace.rankingSource?.maxSeconds, 180)
  assert.equal(workspace.rankingSource?.videos[1]!.excluded.length, 1)
  await rt.dispose()
})
