import { serverUrl } from "../../../config/server-url.ts"
import { homeFileUrl } from "../../../lib/media-url.ts"
import { StageBar } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { ArrangeInspector, ArrangeUnavailable } from "./music-arrange.tsx"
import { MusicInspector } from "./music-inspector.tsx"
import { MusicStage } from "./music-stage.tsx"
import { defaultDropWord, withBlock } from "./music-values.ts"

// The short's song, when it has one.
const trackOf = (e: EditorState) => e.tracks.find((t) => t.id === e.ws.project.musicTrackId) ?? null

// The Music step (narrated shorts): the bed under the voice on the stage; the song, the drop word and (Detailed) the
// arrangement in the inspector.
export function MusicStepStage({ e }: { readonly e: EditorState }) {
  const { ws, fitted, arrange } = e
  const fitting = e.state === "running"
  const bed = fitted?.bed ?? null
  return (
    <>
      <StageBar e={e} left={ws.project.musicTrackId === null ? "Voice only" : fitting ? "Fitting the song…" : bed === null ? "Not fitted" : `${bed.durationS.toFixed(1)}s of music under the voice`} />
      <MusicStage
        bed={arrange.heard?.bed ?? bed}
        bedUrl={arrange.heard !== null ? homeFileUrl(serverUrl, arrange.heard.media) : fitted === null ? null : homeFileUrl(serverUrl, fitted.media)}
        track={trackOf(e)}
        fitting={fitting}
        voiceUrl={e.voiceUrl}
        words={ws.voiceover?.words ?? []}
        layout={e.layout}
        hasSongs={e.tracks.length > 0}
        onAddSong={() => {
          e.setMusicTab("song")
          e.setPickingSong(true)
        }}
        onTime={e.setBedTime}
        pins={e.musicPins}
        onPickWord={e.pickingWord && arrange.blocks !== null ? (word) => {
          arrange.edit(withBlock(arrange.blocks ?? [], arrange.selected, { start: { word } }))
          e.setPickingWord(false)
        } : null}
        preview={arrange.heard !== null}
      />
    </>
  )
}

export function MusicStepPanel({ e }: { readonly e: EditorState }) {
  const { ws, fitted, arrange } = e
  const track = trackOf(e)
  const words = ws.voiceover?.words ?? []
  const fitting = e.state === "running"
  const bed = fitted?.bed ?? null
  return (
    <MusicInspector
      track={track}
      bed={bed}
      tracks={e.tracks}
      trackUrl={(t) => homeFileUrl(serverUrl, `music/${t.path}`)}
      words={words}
      defaultWord={ws.script === null ? null : defaultDropWord(ws.script.script, words)}
      picking={e.pickingSong}
      onPicking={e.setPickingSong}
      busy={e.busy}
      error={e.error}
      running={e.runGoing}
      onApply={(trackId, dropWord) => void e.applyMusic(trackId, dropWord)}
      stages={e.stages}
      tab={e.musicTab}
      onTab={(t) => {
        e.setMusicTab(t)
        e.setPickingWord(false)
      }}
      arrange={track === null || bed === null || bed.trackId !== track.id || fitting ? null
        : e.musicGrid === null || e.musicPlace === null ? <ArrangeUnavailable busy={arrange.busy !== null} onStart={arrange.resetToAutomatic} />
        : (
          <ArrangeInspector
            arrange={arrange}
            bed={bed}
            grid={e.musicGrid}
            track={track}
            trackUrl={homeFileUrl(serverUrl, `music/${track.path}`)}
            words={words}
            place={e.musicPlace}
            placed={e.draftPlaced}
            picking={e.pickingWord}
            onPicking={e.setPickingWord}
            running={e.runGoing}
          />
        )}
    />
  )
}
