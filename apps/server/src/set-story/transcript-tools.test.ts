import type { Transcript } from "@viral/contracts"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { readTranscript, searchTranscripts, transcriptTools } from "./transcript-tools.ts"

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
const segment = (start: number, text: string) => ({
  start,
  end: start + 2,
  text,
  words: text.split(" ").map((word, i) => w(word, start + i * 0.4))
})
const transcript = (...segments: ReadonlyArray<ReturnType<typeof segment>>): Transcript => ({ source: "x.mp4", language: "en", segments })
const videos = [
  { transcript: transcript(segment(10, "The candy finally worked."), segment(400, "It never worked again, honestly.")) },
  { transcript: transcript(segment(5, "Worked? Not even close."), segment(60, "The candy finally, finally worked!")) },
  { transcript: null }
]

test("search finds phrases first, across videos, labelled with the video and its seconds", () => {
  const hits = searchTranscripts(videos, "candy finally worked", null)
  assert.deepEqual(hits, ["[V1 10.0–12.0] The candy finally worked.", "[V2 60.0–62.0] The candy finally, finally worked!"])
  assert.deepEqual(searchTranscripts(videos, "WORKED", [2]), ["[V2 5.0–7.0] Worked? Not even close.", "[V2 60.0–62.0] The candy finally, finally worked!"])
  assert.deepEqual(searchTranscripts(videos, "!!", null), [])
})

test("read gives one video's lines in a window", () => {
  assert.deepEqual(readTranscript(videos[0]!, 1, 300, 500), ["[V1 400.0–402.0] It never worked again, honestly."])
})

test("the tools answer bad requests in words the agent can act on", async () => {
  const [search, read] = transcriptTools(videos)
  const answer = (tool: typeof search, input: unknown) => Effect.runPromise(Effect.map(tool!.run(input), (a) => a.text))
  assert.equal(search!.name, "search_transcript")
  assert.equal(read!.name, "read_transcript")
  assert.match(await answer(search, { query: "banana" }), /nothing matches "banana"/)
  assert.match(await answer(read, { video: 4, from: 0, to: 10 }), /there's no V4; the set's videos are V1–V3/)
  assert.match(await answer(read, { video: 1, from: 0, to: 900 }), /ask for 1–300 seconds/)
  assert.match(await answer(read, { video: 0, from: 0, to: 10 }), /invalid input/)
  assert.equal(await answer(read, { video: 1, from: 0, to: 30 }), "[V1 10.0–12.0] The candy finally worked.")
})
