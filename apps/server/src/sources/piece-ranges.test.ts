import assert from "node:assert/strict"
import { test } from "node:test"
import { covers, piecesFor, uncovered, wantedRanges } from "./piece-ranges.ts"

test("the stretches to fetch are padded a second either side, kept inside the video, and merged when close", () => {
  assert.deepEqual(wantedRanges([{ start: 10, end: 13 }], 100), [{ start: 9, end: 14 }])
  // at the very start and end of the video
  assert.deepEqual(wantedRanges([{ start: 0.4, end: 2 }, { start: 98, end: 99.8 }], 100), [{ start: 0, end: 3 }, { start: 97, end: 100 }])
  // 13–15 and 16–18: padded they're 1 s apart, so one piece; 40–41 stays its own
  assert.deepEqual(wantedRanges([{ start: 16, end: 18 }, { start: 13, end: 15 }, { start: 40, end: 41 }], 100), [
    { start: 12, end: 19 },
    { start: 39, end: 42 }
  ])
  // overlapping shots of one entry become one stretch; empty or backwards clips are ignored
  assert.deepEqual(wantedRanges([{ start: 5, end: 9 }, { start: 7, end: 12 }, { start: 30, end: 30 }, { start: 50, end: 49 }], null), [{ start: 4, end: 13 }])
})

test("only what no piece covers yet is fetched, and a short plays from every piece overlapping its stretches", () => {
  const have = [{ start: 9, end: 14 }, { start: 39, end: 42 }]
  assert.ok(covers(have[0]!, { start: 9.005, end: 13.995 }))
  assert.deepEqual(uncovered([{ start: 10, end: 12 }, { start: 39, end: 43 }, { start: 70, end: 72 }], have), [
    { start: 39, end: 43 },
    { start: 70, end: 72 }
  ])
  assert.deepEqual(piecesFor([{ start: 11, end: 13.5 }], [...have, { start: 13, end: 20 }]), [{ start: 9, end: 14 }, { start: 13, end: 20 }])
  assert.deepEqual(piecesFor([{ start: 60, end: 61 }], have), [])
})
