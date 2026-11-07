import { type ArtifactOwner, type Project, SetStory, type SetStoryBeat, type SourceIndex, StoryMap, type VideoSet } from "@viral/contracts"
import { Effect, Option, Schema } from "effect"
import type { Artifacts } from "../artifacts/artifacts.ts"
import type { VideoSets } from "./video-sets.ts"

// What a short made from a video set takes from the set's story: the proposal it was made from (its angle) and the
// beats in the short's own videos, with `source` turned from a set position into the short's (a short may use
// only some of the set's videos, so V3 of the set can be the short's V2).
export interface ShortStory {
  readonly angle: { readonly title: string; readonly hook: string; readonly why: string } | null
  readonly beats: ReadonlyArray<SetStoryBeat>
}

export const shortStory = (project: Project, set: VideoSet, story: SetStory): ShortStory => {
  const position = (setIndex: number) => {
    const id = set.sourceIds[setIndex]
    return id === undefined ? -1 : project.sourceIds.indexOf(id)
  }
  // the proposal it was made from: same approach, best with the same title (a short keeps its proposal's title
  // until renamed)
  const sameApproach = story.proposals.filter((p) => p.approach === project.approach)
  const proposal = sameApproach.find((p) => p.title === project.title) ?? sameApproach[0] ?? null
  const beats = story.beats.flatMap((beat) => {
    const source = position(beat.source)
    return source < 0 ? [] : [{ ...beat, source: source as SourceIndex }]
  })
  return {
    angle: proposal === null ? null : { title: proposal.title, hook: proposal.hook, why: proposal.why },
    beats
  }
}

const fmt = (t: number) => t.toFixed(1)

// "[V2 12.0–40.0] goal: he tries the gum. "It's like glue." (12.3s)"
export const beatLine = (beat: SetStoryBeat) =>
  `[V${beat.source + 1} ${fmt(beat.start)}–${fmt(beat.end)}] ${beat.beat}: ${beat.summary}${
    beat.quotes.length === 0 ? "" : ` ${beat.quotes.map((q) => `"${q.text}" (${fmt(q.start)}s)`).join(" ")}`
  }`

// A short's story from what's been mapped: a short from a set takes its proposal and beats from the set's story;
// any other short from several videos takes each video's own story beats (and no angle). Single-video shorts keep
// reading their video's story map as before.
export const loadShortStory = Effect.fn("loadShortStory")(function*(
  project: Project,
  artifacts: Artifacts["Service"],
  sets: VideoSets["Service"]
) {
  const decoded = <A, I>(owner: ArtifactOwner, kind: "set-story" | "story-map", schema: Schema.Codec<A, I>) =>
    Effect.map(artifacts.latest(owner, kind), Option.flatMap((a) => Schema.decodeUnknownOption(schema)(a.data)))
  if (project.setId !== null) {
    const set = yield* sets.get(project.setId).pipe(Effect.option)
    const story = yield* decoded({ _tag: "Set", id: project.setId }, "set-story", SetStory)
    if (Option.isSome(set) && Option.isSome(story)) return shortStory(project, set.value, story.value)
  }
  const beats = yield* Effect.forEach(project.sourceIds, (id, i) =>
    Effect.map(decoded({ _tag: "Source", id }, "story-map", StoryMap), (map) =>
      Option.match(map, { onNone: () => [], onSome: (m) => m.beats.map((b) => ({ ...b, source: i as SourceIndex })) })))
  return { angle: null, beats: beats.flat() } satisfies ShortStory
})
