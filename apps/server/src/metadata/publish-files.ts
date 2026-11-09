import type { Artifact, PostText, PublishedShort, RenderedShort, ShortMetadata } from "@viral/contracts"
import { Effect, FileSystem, Path } from "effect"
import type { Artifacts } from "../artifacts/artifacts.ts"
import { otherTitles, postNotes } from "./metadata-rules.ts"

export interface PublishInput {
  readonly slug: string
  readonly rendersDir: string
  // the render to publish, and its artifact (where its files are now)
  readonly render: RenderedShort
  readonly renderArtifact: Artifact
  // the agent's metadata (its titles stay as the alternates) and the text you post with
  readonly metadata: ShortMetadata
  readonly post: PostText
  readonly credit: string | null
  readonly approach: string
  readonly style: string
  // the version published before, whose files are removed when the new ones have other names
  readonly previous: PublishedShort | null
}

// The published files' names for a short.
export const publishedNames = (slug: string) => [`${slug}.mp4`, `${slug}.srt`, `${slug}.md`]

// Writes a short's files side by side into the renders folder (<slug>.mp4, .srt and .md), replacing the ones
// there, and removes the files published before under other names. Returns what to record as the metadata
// artifact and the notes' markdown.
export const writePublished = Effect.fn("writePublished")(function*(
  { artifacts, fs, path }: { readonly artifacts: Artifacts["Service"]; readonly fs: FileSystem.FileSystem; readonly path: Path.Path },
  input: PublishInput
) {
  // stages record absolute paths, which go stale when the library moves; the files are in the render's own folder
  const inRender = Effect.fn("writePublished.inRender")(function*(file: string) {
    const own = artifacts.resolve(input.renderArtifact)
    if (own === null) return file
    const moved = path.join(path.dirname(own), path.basename(file))
    return (yield* fs.exists(moved).pipe(Effect.orElseSucceed(() => false))) ? moved : file
  })
  const notes = postNotes({
    post: input.post,
    alternates: otherTitles(input.metadata, input.post.title),
    credit: input.credit,
    approach: input.approach,
    style: input.style,
    durationS: input.render.durationS
  })
  const [videoName, captionsName, notesName] = publishedNames(input.slug)
  const video = path.join(input.rendersDir, videoName!)
  const captions = path.join(input.rendersDir, captionsName!)
  const notesFile = path.join(input.rendersDir, notesName!)
  yield* fs.makeDirectory(input.rendersDir, { recursive: true })
  yield* fs.copyFile(yield* inRender(input.render.video), video)
  yield* fs.copyFile(yield* inRender(input.render.captions), captions)
  yield* fs.writeFileString(notesFile, notes)
  if (input.previous !== null) {
    const now = new Set([videoName, captionsName, notesName])
    const old = [input.previous.video, input.previous.captions, input.previous.notes].map((f) => path.basename(f)).filter((f) => !now.has(f))
    yield* Effect.forEach(old, (f) => fs.remove(path.join(input.rendersDir, f), { force: true }), { discard: true })
  }
  const published: PublishedShort = {
    title: input.metadata.title,
    alternates: input.metadata.alternates,
    description: input.metadata.description,
    hashtags: input.metadata.hashtags,
    credit: input.credit,
    video,
    captions,
    notes: notesFile,
    posted: input.post,
    renderVersion: input.renderArtifact.version
  }
  return { published, notes }
})
