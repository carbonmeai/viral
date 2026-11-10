import type { MusicBed, MusicTrackId } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { describeMusicChange } from "./music-changes.ts"

const bed = (word: string, trackTitle = "Viral drop song"): MusicBed => ({
  trackId: trackTitle as MusicTrackId, trackTitle, durationS: 40, dropAtS: 20, dropWord: 12, dropWordText: word, songDropS: 30, barS: 2, segments: []
})

test("a moved drop word, a new song and voice only", () => {
  assert.equal(describeMusicChange(bed("But"), bed("worked"))!.headline, "The drop lands on “worked” now")
  assert.deepEqual(describeMusicChange(bed("But"), bed("But", "Other"))!.lines.map((l) => [l.old, l.new]), [["Viral drop song", "Other"]])
  assert.equal(describeMusicChange(bed("But"), null)!.lines[0]!.new, "Voice only")
  assert.equal(describeMusicChange(bed("But"), bed("But")), null)
})
