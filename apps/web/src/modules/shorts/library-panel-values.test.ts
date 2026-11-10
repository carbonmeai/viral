import assert from "node:assert/strict"
import { test } from "node:test"
import { clock, exploreItems, filterItems, type LibraryItem, NO_FILTER, soundItems, typesOf, usesLine } from "./library-panel-values.ts"

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
  assert.deepEqual(typesOf([item("a", "Videos")], ["Frames"]), ["All", "Videos", "Frames"], "a short's Frames show before there are any")
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

const sound = (id: string, origin: unknown, name = id) => ({ id, category: "whoosh", name, path: `whoosh/${name}.mp3`, durationS: 1.5, loudnessLufs: null, origin, rights: "licensed", createdAt: null }) as never

test("Your library's sounds are the ones you made; Explore's are the ones that come with Viral", () => {
  const sounds = [sound("a", { _tag: "Generated", provider: "elevenlabs", prompt: "x", settings: {} }), sound("b", { _tag: "Bundled" })]
  const mine = soundItems(sounds, false, (p) => `/media/sounds/${p}`)
  assert.deepEqual(mine.map((i) => [i.key, i.type, i.sub, i.target]), [["sound-a", "Sounds", "1.5s · made with ElevenLabs", { _tag: "Play", url: "/media/sounds/whoosh/a.mp3" }]])
  assert.deepEqual(soundItems(sounds, true, (p) => p).map((i) => i.key), ["sound-b"])
})

test("Explore: shared voices with free samples, Viral's own songs and sounds, and the references you kept", () => {
  const items = exploreItems({
    voices: [{ voiceId: "v1", publicOwnerId: "o", name: "Brian - Deep narrator", description: "Deep, calm", language: "en", locale: null, accent: null, gender: null, age: null, extraLanguages: 0, createdAt: null, users: 1_200_000, useCase: null, category: null, previewUrl: "https://s/v1.mp3", featured: false, inMyVoices: false }],
    tracks: [
      { id: "t1", title: "Pulse drop", origin: { _tag: "Bundled", plan: null }, bpm: 128, durationS: 95, rights: "licensed" } as never,
      { id: "t2", title: "My song", origin: { _tag: "Upload", file: "x" }, bpm: 100, durationS: 60, rights: "owned" } as never
    ],
    sounds: [sound("b", { _tag: "Bundled" }, "record-scratch-01")],
    references: [{ id: "r1", url: "https://youtu.be/r", platform: "youtube", title: "Retired & Prancing", creator: "Rescue", durationS: 61, notes: null } as never],
    songId: "t1",
    songs: true,
    soundUrl: (p) => p
  })
  assert.deepEqual(items.map((i) => [i.type, i.name]), [["Voices", "Brian · deep"], ["Music", "Pulse drop"], ["Sounds", "record-scratch-01"], ["References", "Retired & Prancing"]])
  assert.equal(items[0]!.sub, "Shared · 1.2M uses")
  assert.deepEqual(items[0]!.target, { _tag: "Play", url: "https://s/v1.mp3" })
  assert.deepEqual([items[1]!.used, items[1]!.target], [true, { _tag: "Song", trackId: "t1" }], "the short's song is marked used, and picking it opens the song picker")
  assert.deepEqual(items[3]!.target, { _tag: "Link", url: "https://youtu.be/r" })
  assert.deepEqual(typesOf(items), ["All", "Voices", "Music", "Sounds", "References"])
})
