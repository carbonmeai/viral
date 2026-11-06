import {
  AdRanges,
  ApproachName,
  ContactSheetSet,
  type ProjectId,
  RenderedShort,
  Script,
  type SourceId,
  StoryMap,
  Transcript
} from "@viral/contracts"
import { Effect, FileSystem, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"

// The fixed inputs an eval runs every model on: one long video's transcript, ad ranges, story and overview
// contact sheets, and one approved short (its approach, angle and script). Stored as <dir>/fixture.json plus the
// sheet images in <dir>/sheets/, so evals never read or write a real library.
export const EvalFixture = Schema.Struct({
  name: Schema.String,
  source: Schema.Struct({
    title: Schema.NullOr(Schema.String),
    channel: Schema.NullOr(Schema.String),
    durationS: Schema.Finite
  }),
  transcript: Transcript,
  adRanges: AdRanges,
  story: StoryMap,
  // file names inside <dir>/sheets/ and the source seconds each covers
  sheets: Schema.Array(Schema.Struct({ file: Schema.String, start: Schema.Finite, end: Schema.Finite })),
  short: Schema.Struct({
    approach: ApproachName,
    title: Schema.String,
    durationS: Schema.Finite,
    angle: Schema.NullOr(Schema.Struct({ title: Schema.String, hook: Schema.String, why: Schema.String })),
    script: Script
  })
})
export type EvalFixture = typeof EvalFixture.Type
const FixtureJson = Schema.fromJsonString(EvalFixture)

export class EvalFixtureError extends Schema.TaggedError<EvalFixtureError>()("EvalFixtureError", { message: Schema.String }) {}
const fail = (message: string) => new EvalFixtureError({ message })

export const loadFixture = Effect.fn("loadFixture")(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const json = yield* fs.readFileString(path.join(dir, "fixture.json")).pipe(Effect.mapError((e) => fail(`no eval fixture in ${dir}: ${e.message}`)))
  return yield* Schema.decodeEffect(FixtureJson)(json).pipe(Effect.mapError((e) => fail(e.message)))
})

// Copies a processed source and one of its approved narrated shorts out of a library (read-only) into a
// fixture folder.
export const exportFixture = Effect.fn("exportFixture")(function*(input: {
  readonly sourceId: SourceId
  readonly projectId: ProjectId
  readonly out: string
  readonly name: string
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const sources = yield* Sources
  const projects = yield* Projects
  const artifacts = yield* Artifacts
  const transcripts = yield* Transcripts
  const sourceOwner = { _tag: "Source", id: input.sourceId } as const
  const projectOwner = { _tag: "Project", id: input.projectId } as const

  const data = <A, I>(owner: typeof sourceOwner | typeof projectOwner, kind: "ad-ranges" | "story-map" | "contact-sheet" | "script" | "render", schema: Schema.Codec<A, I>) =>
    Effect.flatMap(artifacts.latest(owner, kind), (a) =>
      Effect.fromOption(Option.flatMap(a, (x) => Schema.decodeUnknownOption(schema)(x.data))).pipe(
        Effect.mapError(() => fail(`the library has no ${kind} to export`))
      ))

  const source = yield* sources.get(input.sourceId).pipe(Effect.mapError((e) => fail(e.message)))
  const project = yield* projects.get(input.projectId).pipe(Effect.mapError((e) => fail(e.message)))
  const transcript = yield* transcripts.forSource(input.sourceId).pipe(Effect.mapError(() => fail("the source has no transcript")))
  const adRanges = yield* data(sourceOwner, "ad-ranges", AdRanges)
  const story = yield* data(sourceOwner, "story-map", StoryMap)
  const script = yield* data(projectOwner, "script", Script)
  const render = yield* data(projectOwner, "render", RenderedShort)
  const sheetSet = yield* data(sourceOwner, "contact-sheet", ContactSheetSet)
  const sheetsDir = Option.flatMapNullishOr(yield* artifacts.latest(sourceOwner, "contact-sheet"), artifacts.resolve)
  if (Option.isNone(sheetsDir)) return yield* fail("the source's contact sheets have no folder")

  const outSheets = path.join(input.out, "sheets")
  yield* fs.makeDirectory(outSheets, { recursive: true }).pipe(Effect.mapError((e) => fail(e.message)))
  for (const sheet of sheetSet.sheets) {
    yield* fs.copyFile(path.join(sheetsDir.value, sheet.file), path.join(outSheets, path.basename(sheet.file))).pipe(
      Effect.mapError((e) => fail(e.message))
    )
  }
  const proposal = story.proposals.find((p) => p.approach === project.approach)
  const fixture: EvalFixture = {
    name: input.name,
    source: { title: source.title, channel: source.channel, durationS: source.durationS ?? transcript.segments.at(-1)?.end ?? 0 },
    transcript,
    adRanges,
    story,
    sheets: sheetSet.sheets.map((s) => ({ file: path.basename(s.file), start: s.start, end: s.end })),
    short: {
      approach: project.approach,
      title: project.title,
      durationS: render.durationS,
      angle: proposal === undefined ? null : { title: proposal.title, hook: proposal.hook, why: proposal.why },
      script
    }
  }
  const json = yield* Schema.encodeEffect(FixtureJson)(fixture).pipe(Effect.mapError((e) => fail(e.message)))
  yield* fs.writeFileString(path.join(input.out, "fixture.json"), json).pipe(Effect.mapError((e) => fail(e.message)))
  return fixture
})
