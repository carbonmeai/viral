import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { locateQuote } from "./quote-match.ts"

const w = (word: string, s: number, e: number) => ({ w: word, s, e })

const words = [
  w("My", 10.0, 10.2), w("gosh,", 10.2, 10.6), w("it", 10.6, 10.7), w("worked.", 10.7, 11.2),
  w("Later", 40.0, 40.3), w("it", 40.3, 40.4), w("worked.", 40.4, 40.9)
]

test("finds a quote word for word, ignoring case and punctuation, and pads the clip", () => {
  assert.deepEqual(locateQuote(words, "my gosh it WORKED", 9), { start: 9.95, end: 11.35, words: "My gosh, it worked." })
})

test("picks the occurrence nearest the stated time", () => {
  assert.equal(locateQuote(words, "it worked", 38)?.start, 40.25)
  assert.equal(locateQuote(words, "it worked", 11)?.start, 10.55)
})

test("rejects words that aren't there, or are too far from the stated time", () => {
  assert.equal(locateQuote(words, "it failed", 10), null)
  assert.equal(locateQuote(words, "my gosh", 100), null)
})

const CANDY = join(homedir(), ".viral/fixtures/candy/transcript.json")
test("locates the validation short's real lines in the candy transcript", { skip: !existsSync(CANDY) }, () => {
  const transcript = JSON.parse(readFileSync(CANDY, "utf8")) as { segments: Array<{ words: Array<{ w: string; s: number; e: number }> }> }
  const all = transcript.segments.flatMap((s) => s.words)
  const pain = locateQuote(all, "Right now, it's just pain.", 1140)
  assert.ok(pain !== null && Math.abs(pain.start - 1143.67) < 0.1, JSON.stringify(pain))
  assert.ok(locateQuote(all, "It literally is all the taste at the same time", 1990) !== null)
})
