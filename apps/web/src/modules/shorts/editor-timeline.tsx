import { shortTimeOf } from "./editor-values.ts"
import { bedBlocks } from "./music/music-values.ts"
import { RankingTimeline } from "./ranking/ranking-timeline.tsx"
import { entryBlocks } from "./ranking/ranking-values.ts"
import { CutTimeline } from "./sections/cut-timeline.tsx"
import { sectionBlocks } from "./sections/sections-values.ts"
import { Timeline } from "./timeline.tsx"
import type { EditorState } from "./use-editor-state.ts"

// The short's timeline under the stage, by format: a ranking's entries, a cut-down's sections, or a narrated short's
// narration, shots, real lines, captions and music. Clicking a block selects it and opens its step; the playhead
// follows what's playing.
export function EditorTimeline({ e }: { readonly e: EditorState }) {
  const { ws, open, onStep } = e
  const captions = ws.preset.config.captions
  const captionsLine = `${captions.enabled ? `${captions.mode === "chunk" ? `${captions.maxWords} words at a time` : "One word at a time"} · ${captions.case}` : "No captions (finish in an editor from the .srt)"}`
  if (ws.project.format === "ranking") {
    const ranking = e.ranking
    if (e.rankingPlanDraft === null || ranking === null) {
      return <div className="grid h-[120px] place-items-center text-xs text-fg-2">The timeline appears once the moments are picked.</div>
    }
    return (
      <RankingTimeline
        draft={ranking}
        videos={ws.videos.length}
        selected={open === "moments" ? e.rankingRank : null}
        onSelect={(rank) => {
          e.setRankingRank(rank)
          if (open !== "moments") onStep("moments")
        }}
        head={open === "moments"
          ? entryBlocks(ranking).find((b) => b.rank === e.rankingRank)?.start ?? null
          : (open === "render" || open === "publish") && e.playTime !== null
          ? e.playTime
          : null}
      />
    )
  }
  if (ws.project.format === "cut-down") {
    const sections = e.timelineSections
    if (sections === null || ws.cutSource === null) {
      return <div className="grid h-[120px] place-items-center text-xs text-fg-2">The timeline appears once the sections are planned.</div>
    }
    return (
      <CutTimeline
        sections={sections.sections}
        videos={ws.cutSource.videos}
        stillOf={e.stillOf(sections)}
        selected={open === "sections" ? Math.min(e.sectionK, sections.sections.length - 1) : null}
        onSelect={(k) => {
          e.setSectionK(k)
          e.setSectionPlaying(false)
          if (open !== "sections") onStep("sections")
        }}
        head={open === "sections"
          ? sectionBlocks(sections.sections)[Math.min(e.sectionK, sections.sections.length - 1)]?.start ?? null
          : (open === "render" || open === "publish") && e.playTime !== null
          ? e.playTime
          : null}
        captions={captionsLine}
      />
    )
  }
  const { layout, fitted, shotBlocks } = e
  return (
    <Timeline
      layout={layout}
      head={open === "voice" && e.voTime !== null && layout !== null
        ? shortTimeOf(layout, e.voTime)
        : open === "shots" && shotBlocks !== null
        ? shotBlocks.find((b) => b.k === e.shotK)?.start ?? null
        : (open === "render" || open === "publish") && e.playTime !== null
        ? e.playTime
        : open === "music" && e.bedTime !== null
        ? e.bedTime
        : null}
      drop={ws.project.musicTrackId === null ? null : fitted?.bed.dropAtS ?? layout?.narration.at(-1)?.start ?? null}
      musicBlocks={ws.project.musicTrackId === null || fitted === null ? null : bedBlocks(fitted.bed)}
      musicParts={e.musicParts}
      marks={e.musicMarks}
      captions={captionsLine}
      music={ws.project.musicTrackId === null ? "No music · voice only" : "Music · fitted when the short is laid out"}
      shots={ws.shotPlan !== null ? `${ws.shotPlan.plan.shots.length} shots` : "Shots are planned in step 3"}
      videos={ws.videos.length}
      shotBlocks={shotBlocks === null ? null : {
        blocks: shotBlocks,
        frameOf: e.shotFrame,
        sourceOf: (k) => e.draft.get(k)?.source ?? ws.shotPlan?.plan.shots[k]?.source ?? 0,
        selected: open === "shots" ? e.shotK : null,
        onSelect: (k) => {
          e.selectShot(k)
          if (open !== "shots") onStep("shots")
        }
      }}
    />
  )
}
