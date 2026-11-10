import { useAtomRefresh, useAtomSet } from "@effect/atom-react"
import { serverUrl } from "../../config/server-url.ts"
import { homeFileUrl } from "../../lib/media-url.ts"
import { overviewAtom } from "../home/overview.ts"
import { videoColor } from "../sets/set-values.ts"
import { renameVideo } from "../videos/videos-api.ts"
import { shortTimeOf } from "./editor-values.ts"
import { bedBlocks } from "./music/music-values.ts"
import { MultiTrack } from "./multi-track.tsx"
import { entryBlocks } from "./ranking/ranking-values.ts"
import { sectionBlocks } from "./sections/sections-values.ts"
import { nameOf, useShortVideos } from "./short-videos.tsx"
import { type TracksInput, tracksFor, type TrackVideo } from "./track-values.ts"
import type { EditorState } from "./use-editor-state.ts"

// The lanes' inputs from what the editor has loaded, by format.
const inputOf = (e: EditorState, videos: ReadonlyArray<TrackVideo>): TracksInput => {
  const { ws } = e
  if (ws.project.format === "ranking") {
    return { format: "ranking", videos, captions: e.captions, ranking: e.ranking, stillOf: e.rankingStillOf }
  }
  if (ws.project.format === "cut-down") {
    const sections = e.timelineSections
    // the end card's question (the style's comment question): the approved plan's, shown after the last section
    const question = ws.preset.config.commentQuestion === true ? ws.cutPlan?.plan.question ?? null : null
    return { format: "cut-down", videos, captions: e.captions, sections: sections?.sections ?? null, stillOf: e.stillOf(sections), endCard: question }
  }
  const { fitted, shotBlocks } = e
  const bed = fitted?.bed ?? null
  return {
    format: "narrated",
    videos,
    captions: e.captions,
    layout: e.layout,
    beats: ws.script?.script.beats ?? [],
    shots: shotBlocks === null ? null : {
      blocks: shotBlocks,
      sourceOf: (k) => e.draft.get(k)?.source ?? ws.shotPlan?.plan.shots[k]?.source ?? 0,
      frameOf: e.shotFrame
    },
    realFrame: e.realFrame,
    voiceUrl: e.voiceUrl,
    music: ws.project.musicTrackId === null
      ? { _tag: "None" }
      : bed === null || fitted === null
      ? { _tag: "NotFitted" }
      : {
        _tag: "Bed",
        url: homeFileUrl(serverUrl, fitted.media),
        song: bed.trackTitle,
        parts: e.musicParts !== null && e.musicParts.parts.length > 0
          ? e.musicParts.parts.map((p) => ({ index: p.index, start: p.start, end: p.end, label: p.label }))
          : bedBlocks(bed).map((b) => ({ index: null, ...b })),
        drop: { at: bed.dropAtS, word: bed.dropWordText }
      }
  }
}

// The short's multi-track timeline under the player (display only): a lane per video, then its sound, music and
// captions. The playhead follows the open step's player (or the selected shot, section or entry), the play button and
// seeking drive that player, and clicking a clip opens it where it's edited.
export function EditorTimeline({ e }: { readonly e: EditorState }) {
  const { ws, open } = e
  const named = useShortVideos()
  const rename = useAtomSet(renameVideo, { mode: "promise" })
  const refreshOverview = useAtomRefresh(overviewAtom)
  const videos: ReadonlyArray<TrackVideo> = ws.videos.map((v, i) => ({ id: v.source.id, name: nameOf(named, i), title: v.source.title, color: videoColor(i) }))
  const timeline = tracksFor(inputOf(e, videos))
  const playerTime = e.hasTransport
    ? open === "voice" && e.voTime !== null && e.layout !== null
      ? shortTimeOf(e.layout, e.voTime)
      : open === "music" ? e.bedTime
      : e.playTime
    : null
  const head = e.hasTransport ? playerTime ?? 0 : (
    open === "shots" && e.shotBlocks !== null
      ? e.shotBlocks.find((b) => b.k === e.shotK)?.start ?? null
      : open === "sections" && e.timelineSections !== null
      ? sectionBlocks(e.timelineSections.sections)[Math.min(e.sectionK, e.timelineSections.sections.length - 1)]?.start ?? null
      : open === "moments" && e.ranking !== null
      ? entryBlocks(e.ranking).find((b) => b.rank === e.rankingRank)?.start ?? null
      : null
  )
  return (
    <MultiTrack
      timeline={timeline}
      head={head}
      playing={e.transportPlaying}
      canPlay={e.hasTransport}
      onToggle={e.toggleTransport}
      onSeek={e.seekTransport}
      selected={e.timelineSelected}
      onSelect={(clip) => e.selectClip(clip.target, clip.start)}
      captionsFrom={e.captions?.from ?? null}
      onRename={(video, name) => {
        const source = ws.videos[video]?.source
        if (source === undefined) return Promise.resolve(null)
        return rename({ payload: { id: source.id, shortName: name } })
          .then(() => {
            e.refresh()
            refreshOverview()
            return null
          })
          .catch(() => "Couldn't rename it. Is the server running?")
      }}
    />
  )
}
