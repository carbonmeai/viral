import type { ShortWorkspace } from "@viral/contracts"
import { useEffect, useMemo, useState } from "react"
import { serverUrl } from "../../config/server-url.ts"
import { homeFileUrl } from "../../lib/media-url.ts"
import { cuesFromSrt, narratedShortCues, rankingCues, sectionCues } from "./caption-cues.ts"
import type { EditorStepState, TimelineLayout } from "./editor-values.ts"
import type { RankingDraft } from "./ranking/ranking-values.ts"
import type { SectionsDraft } from "./sections/sections-values.ts"
import type { TimelineCaptions } from "./track-values.ts"

// A render's .srt by url, fetched once per page.
const fetched = new Map<string, Promise<string>>()
const srtOf = (url: string) => {
  const known = fetched.get(url)
  if (known !== undefined) return known
  const text = fetch(url).then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
  text.catch(() => fetched.delete(url))
  fetched.set(url, text)
  return text
}

// The short's captions as they're shown, on its own clock: the render's .srt once the render is current (it's exact),
// else worked out from the voiceover's words (narrated) or the videos' words (cut-down sections, ranking shots) the
// way the renderer groups them. Null when the style shows no captions.
export function useCaptionCues({ ws, layout, sections, ranking, render }: {
  readonly ws: ShortWorkspace
  readonly layout: TimelineLayout | null
  readonly sections: SectionsDraft | null
  readonly ranking: RankingDraft | null
  // where the Render step stands: a render that's done (or waiting for you) matches the short
  readonly render: EditorStepState
}): TimelineCaptions | null {
  const style = ws.preset.config.captions
  const captionsPath = ws.render?.media.captions ?? null
  const current = ws.render !== null && captionsPath !== null && (render === "done" || render === "waiting")
  const url = current && captionsPath !== null ? `${homeFileUrl(serverUrl, captionsPath)}?v=${ws.render!.version}` : null
  const [srt, setSrt] = useState<{ readonly url: string; readonly text: string } | null>(null)
  useEffect(() => {
    if (url === null) return
    let live = true
    srtOf(url).then((text) => live && setSrt({ url, text })).catch(() => undefined)
    return () => {
      live = false
    }
  }, [url])
  const total = ws.render?.render.durationS ?? layout?.total ?? 0
  const srtText = url !== null && srt?.url === url ? srt.text : null
  return useMemo((): TimelineCaptions | null => {
    if (!style.enabled) return null
    if (srtText !== null) return { cues: cuesFromSrt(srtText, style, total), from: "render" }
    if (ws.project.format === "narrated") {
      return layout === null || ws.voiceover === null ? { cues: [], from: "words" } : { cues: narratedShortCues(layout, ws.voiceover.words, style), from: "words" }
    }
    if (ws.project.format === "cut-down") {
      const videos = ws.cutSource?.videos ?? []
      return { cues: sections === null ? [] : sectionCues(sections.sections, (v) => videos[v]?.words ?? [], style), from: "words" }
    }
    const videos = ws.rankingSource?.videos ?? []
    return { cues: ranking === null ? [] : rankingCues(ranking, (v) => videos[v]?.words ?? [], style), from: "words" }
  }, [srtText, style, total, ws.project.format, layout, ws.voiceover, ws.cutSource, ws.rankingSource, sections, ranking])
}
