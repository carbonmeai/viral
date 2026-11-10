import assert from "node:assert/strict"
import { test } from "node:test"
import { fromNewPage, validateHomeSearch, WAITING_SEARCH } from "./home-search.ts"
import { matchesMadeAs } from "./made-as.ts"

test("Home's URL keeps the status filter and the starting card, and drops anything else", () => {
  assert.deepEqual(validateHomeSearch({ status: "waiting" }), { status: "waiting" })
  assert.deepEqual(validateHomeSearch({ status: "published", start: "ranking" }), { status: "published", start: "ranking" })
  assert.deepEqual(validateHomeSearch({ status: "everything", start: "podcast", q: "x" }), {})
})

test("the old pages land on Home: /waiting filtered to waiting, /videos/new on the matching card", () => {
  assert.deepEqual(WAITING_SEARCH, { status: "waiting" })
  assert.deepEqual(fromNewPage({ kind: "idea" }), { start: "idea" })
  assert.deepEqual(fromNewPage({ kind: "several" }), {})
  assert.deepEqual(fromNewPage({}), {})
})

test("a format card's hint matches the suggestions made that way", () => {
  assert.ok(matchesMadeAs("ranking", "ranking"))
  assert.ok(matchesMadeAs("narrated", "claim-interleaved"))
  assert.ok(matchesMadeAs("narrated", "question-recap"))
  assert.ok(!matchesMadeAs("cut-down", "question-recap"))
  assert.ok(!matchesMadeAs(null, "ranking"))
})
