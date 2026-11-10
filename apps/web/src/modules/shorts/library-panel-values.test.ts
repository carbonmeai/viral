import assert from "node:assert/strict"
import { test } from "node:test"
import { clock, filterItems, type LibraryItem, NO_FILTER, typesOf, usesLine } from "./library-panel-values.ts"

const item = (key: string, type: LibraryItem["type"], over: Partial<LibraryItem> = {}): LibraryItem => ({
  key,
  type,
  name: key,
  sub: "",
  picture: null,
  badge: null,
  video: 0,
  used: true,
  rights: null,
  ...over
})

test("the type chips are All and the types that have an item", () => {
  assert.deepEqual(typesOf([item("a", "Videos"), item("b", "Frames"), item("c", "Frames")]), ["All", "Videos", "Frames"])
  assert.deepEqual(typesOf([]), ["All"])
})

test("filters by type, video, use, rights and words in the name or the line under it", () => {
  const items = [
    item("Candy", "Videos", { sub: "21 shots", rights: "owned" }),
    item("Heidi", "Videos", { video: 1, sub: "6 shots", rights: "unconfirmed" }),
    item("Shot 1", "Frames", { sub: "Candy · 27:12" }),
    item("Song", "Music", { used: false, video: null, rights: "licensed" })
  ]
  assert.deepEqual(filterItems(items, { ...NO_FILTER, type: "Videos" }).map((i) => i.key), ["Candy", "Heidi"])
  assert.deepEqual(filterItems(items, { ...NO_FILTER, video: 1 }).map((i) => i.key), ["Heidi"])
  assert.deepEqual(filterItems(items, { ...NO_FILTER, used: false }).map((i) => i.key), ["Song"])
  assert.deepEqual(filterItems(items, { ...NO_FILTER, rights: "owned" }).map((i) => i.key), ["Candy"])
  assert.deepEqual(filterItems(items, { ...NO_FILTER, query: "candy" }).map((i) => i.key), ["Candy", "Shot 1"])
})

test("moments and what a short takes from a video, in words", () => {
  assert.equal(clock(1632.4), "27:12")
  assert.equal(clock(3725), "1:02:05")
  assert.equal(usesLine(21, 2), "21 shots · 2 real lines")
  assert.equal(usesLine(1, 0, "section"), "1 section")
  assert.equal(usesLine(0, 0), "Not used yet")
})
