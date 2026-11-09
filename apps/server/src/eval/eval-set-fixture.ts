import { AdRanges, type ArtifactOwner, ContactSheetSet, SetStory, type SourceSetId, StoryMap, Transcript } from "@viral/contracts"
import { Effect, FileSystem, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { EvalFixtureError } from "./eval-fixture.ts"

// The fixed inputs a set-story eval runs every model on: a video set's brief and, per video (V1 first), its short
// name, transcript, ad ranges, overview contact sheets and its own story summary when it had one, plus the set
// story the library made (the reference). Stored as <dir>/fixture.json plus each video's sheet images in
// <dir>/sheets/v<N>/, so the eval runs only the set-story agent and never reads or writes a real library.
export const SetFixtureVideo = Schema.Struct({
  // what the eval page calls the video ("Heidi Klum", "Extreme candy"), never "V1"
  name: Schema.String,
  title: Schema.NullOr(Schema.String),
  channel: Schema.NullOr(Schema.String),
  durationS: Schema.Finite,
  transcript: Transcript,
  adRanges: AdRanges,
  // file names inside <dir>/sheets/v<N>/ and the seconds each covers
  sheets: Schema.Array(Schema.Struct({ file: Schema.String, start: Schema.Finite, end: Schema.Finite })),
  storySummary: Schema.NullOr(Schema.String)
})
export type SetFixtureVideo = typeof SetFixtureVideo.Type

export const SetEvalFixture = Schema.Struct({
  kind: Schema.Literal("set"),
  name: Schema.String,
  brief: Schema.String,
  videos: Schema.Array(SetFixtureVideo),
  // the set story the library made for the set, to compare against
  reference: Schema.NullOr(SetStory)
})
export type SetEvalFixture = typeof SetEvalFixture.Type
const FixtureJson = Schema.fromJsonString(SetEvalFixture)

const fail = (message: string) => new EvalFixtureError({ message })

// The folder holding V<number>'s contact sheets inside a fixture.
export const sheetsDirOf = (path: Path.Path, dir: string, number: number) => path.join(dir, "sheets", `v${number}`)

export const loadSetFixture = Effect.fn("loadSetFixture")(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const json = yield* fs.readFileString(path.join(dir, "fixture.json")).pipe(Effect.mapError((e) => fail(`no set fixture in ${dir}: ${e.message}`)))
  return yield* Schema.decodeEffect(FixtureJson)(json).pipe(Effect.mapError((e) => fail(`${dir} isn't a set fixture: ${e.message}`)))
})

// Words a short name leaves out: small words, and the filler video titles are full of (as the web's set page does).
const FILLER = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "as", "by", "from", "into", "about",
  "vs", "is", "are", "was", "were", "be", "it", "its", "this", "that", "my", "your", "his", "her", "their", "our", "he",
  "she", "they", "we", "i", "you", "me", "him", "them", "us", "how", "why", "what", "when", "who", "which", "made",
  "make", "built", "build", "tried", "try", "just", "very", "really", "most", "world's", "worlds", "ever", "best",
  "official", "video", "full", "episode", "part", "new"
])
const NAME_MAX = 18
const capitalized = (word: string) => /^\p{Lu}/u.test(word)

// A short name for a video from its title (or file name): a name in it when it has one ("Heidi Klum"), else its first
// meaningful words ("Extreme candy"), at most ~18 characters; "Video 2" when the title gives nothing.
export const shortVideoName = (title: string | null, index: number): string => {
  const words = (title ?? "")
    .replace(/\.(mp4|mov|m4v|webm|mkv)$/i, "")
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[_|#:-]+/g, " ")
    .replace(/’/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, ""))
    .filter((w) => w.length > 0)
  const meaningful = (w: string) => !FILLER.has(w.toLowerCase())
  const titleCase = words.length > 0 && words.filter(capitalized).length / words.length > 0.6
  let picked: ReadonlyArray<string> = []
  if (!titleCase) {
    for (let i = 0; i < words.length && picked.length === 0; i++) {
      let j = i
      while (j < words.length && capitalized(words[j]!) && meaningful(words[j]!)) j++
      if (j - i >= 2) picked = words.slice(i, j)
    }
  }
  if (picked.length === 0) picked = words.filter(meaningful)
  if (picked.length === 0) return `Video ${index + 1}`
  let name = ""
  for (const word of picked.slice(0, 3)) {
    const next = name === "" ? word : `${name} ${word}`
    if (next.length > NAME_MAX) break
    name = next
  }
  if (name === "") name = `${picked[0]!.slice(0, NAME_MAX - 1)}…`
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Copies a video set whose videos have all been read (transcript, contact sheets, ads) out of a library
// (read-only) into a fixture folder, with its set story as the reference when it has one. `names` overrides the
// short names, in set order.
export const exportSetFixture = Effect.fn("exportSetFixture")(function*(input: {
  readonly setId: SourceSetId
  readonly out: string
  readonly name: string
  readonly names: ReadonlyArray<string>
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const sets = yield* VideoSets
  const projectSources = yield* ProjectSources
  const artifacts = yield* Artifacts

  const set = yield* sets.get(input.setId).pipe(Effect.mapError(() => fail(`the library has no video set ${input.setId}`)))
  const members = yield* projectSources.ofSources(set.sourceIds).pipe(Effect.mapError((e) => fail(`a video in the set is gone (${e.id})`)))
  const latest = <A, I>(owner: ArtifactOwner, kind: "ad-ranges" | "story-map" | "contact-sheet" | "set-story", schema: Schema.Codec<A, I>) =>
    Effect.map(artifacts.latest(owner, kind), (a) => Option.flatMap(a, (x) => Schema.decodeUnknownOption(schema)(x.data)))

  const videos: Array<SetFixtureVideo> = []
  for (const member of members) {
    const number = member.index + 1
    const label = `Video ${number} (${member.source.title ?? member.source.id})`
    if (Option.isNone(member.transcript)) return yield* fail(`${label} has no transcript: run the set first`)
    const ads = yield* latest(member.owner, "ad-ranges", AdRanges)
    if (Option.isNone(ads)) return yield* fail(`${label} has no ads result: run the set first`)
    const sheetSet = yield* latest(member.owner, "contact-sheet", ContactSheetSet)
    const sheetsDir = Option.flatMapNullishOr(yield* artifacts.latest(member.owner, "contact-sheet"), artifacts.resolve)
    if (Option.isNone(sheetSet) || Option.isNone(sheetsDir)) return yield* fail(`${label} has no contact sheets: run the set first`)
    const story = yield* latest(member.owner, "story-map", StoryMap)

    const outSheets = sheetsDirOf(path, input.out, number)
    yield* fs.makeDirectory(outSheets, { recursive: true }).pipe(Effect.mapError((e) => fail(e.message)))
    for (const sheet of sheetSet.value.sheets) {
      yield* fs.copyFile(path.join(sheetsDir.value, sheet.file), path.join(outSheets, path.basename(sheet.file))).pipe(
        Effect.mapError((e) => fail(e.message))
      )
    }
    const fileName = member.source.origin._tag === "File" ? path.basename(member.source.origin.path) : null
    videos.push({
      name: input.names[member.index] ?? shortVideoName(member.source.title ?? fileName, member.index),
      title: member.source.title ?? fileName,
      channel: member.source.channel,
      durationS: member.seconds,
      transcript: member.transcript.value,
      adRanges: ads.value,
      sheets: sheetSet.value.sheets.map((s) => ({ file: path.basename(s.file), start: s.start, end: s.end })),
      storySummary: Option.match(story, { onNone: () => null, onSome: (s) => s.summary })
    })
  }
  const reference = yield* latest({ _tag: "Set", id: input.setId }, "set-story", SetStory)
  const fixture: SetEvalFixture = { kind: "set", name: input.name, brief: set.brief, videos, reference: Option.getOrNull(reference) }
  const json = yield* Schema.encodeEffect(FixtureJson)(fixture).pipe(Effect.mapError((e) => fail(e.message)))
  yield* fs.writeFileString(path.join(input.out, "fixture.json"), json).pipe(Effect.mapError((e) => fail(e.message)))
  return fixture
})
