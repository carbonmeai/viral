import assert from "node:assert/strict"
import { test } from "node:test"
import { captionsExcerpt, classifyFailure, parseDetails, parseSearch, viewsLabel } from "./youtube-values.ts"

test("a flat search keeps each video's id, title, channel, length, views and live state, and drops non-videos", () => {
  const json = JSON.stringify({
    entries: [
      { id: "ksuKEz9YJvw", title: "This Rescue Dog's Transformation", channel: "The Dodo", duration: 185, view_count: 759937, live_status: null },
      { id: "LIVELIVELIV", title: "24/7 kitten cam", uploader: "Kitten Rescue", duration: null, view_count: 10, live_status: "is_live" },
      { id: "UCchannel-not-a-video", title: "A channel" },
      { title: "no id" }
    ]
  })
  assert.deepEqual(parseSearch(json), [
    { videoId: "ksuKEz9YJvw", title: "This Rescue Dog's Transformation", channel: "The Dodo", durationS: 185, views: 759937, live: null },
    { videoId: "LIVELIVELIV", title: "24/7 kitten cam", channel: "Kitten Rescue", durationS: null, views: 10, live: true }
  ])
  assert.deepEqual(parseSearch("not json"), [])
})

test("a lookup reads the upload date, description and chapters", () => {
  const details = parseDetails(JSON.stringify({
    id: "ksuKEz9YJvw",
    title: "T",
    channel: "The Dodo",
    duration: 184,
    live_status: "not_live",
    upload_date: "20260207",
    description: "From fragile to fluffy",
    chapters: [{ start_time: 0, title: "The heartbreaking rescue" }, { start_time: 23, title: "First days at the vet" }]
  }), "[0:01] hi")
  assert.equal(details?.uploadDate, "2026-02-07")
  assert.equal(details?.live, false)
  assert.deepEqual(details?.chapters, [{ start: 0, title: "The heartbreaking rescue" }, { start: 23, title: "First days at the vet" }])
  assert.equal(details?.captions, "[0:01] hi")
})

test("automatic captions are read once per line, in timed lines of about 15 seconds, within a limit", () => {
  const vtt = [
    "WEBVTT", "Kind: captions", "Language: en", "",
    "00:00:00.000 --> 00:00:01.954 align:start position:0%", " ", "Is<00:00:00.280><c> that</c><00:00:00.560><c> tail</c><00:00:00.920><c> going?</c>", "",
    "00:00:01.954 --> 00:00:01.964 align:start position:0%", "Is that tail going?", " ", "",
    "00:00:01.964 --> 00:00:02.790 align:start position:0%", "Is that tail going?", "&gt;&gt; [laughter]", "",
    "00:00:20.000 --> 00:00:22.000", "At the vet.", "",
    "00:01:40.000 --> 00:01:42.000", "Look at her now.", ""
  ].join("\n")
  assert.equal(captionsExcerpt(vtt), "[0:00] Is that tail going? >> [laughter]\n[0:20] At the vet.\n[1:40] Look at her now.")
  assert.match(captionsExcerpt(vtt, 50)!, /^\[0:00\] Is that tail going\? >> \[laughter\]\n\(captions continue\)$/)
  assert.equal(captionsExcerpt("WEBVTT\n\n"), null)
})

test("yt-dlp failures read as YouTube refusing, a video that's gone, or anything else", () => {
  assert.equal(classifyFailure("ERROR: [youtube] abc: HTTP Error 403: Forbidden").kind, "blocked")
  assert.equal(classifyFailure("ERROR: [youtube] abc: Sign in to confirm you’re not a bot").kind, "blocked")
  assert.equal(classifyFailure("ERROR: [youtube] abc: Private video. Sign in if you've been granted access").kind, "unavailable")
  assert.equal(classifyFailure("ERROR: [youtube] abc: Video unavailable").message, "Video unavailable")
  assert.equal(classifyFailure("ERROR: something odd").kind, "failed")
  assert.equal(viewsLabel(12574061), "13M views")
  assert.equal(viewsLabel(759937), "760k views")
  assert.equal(viewsLabel(572), "572 views")
})
