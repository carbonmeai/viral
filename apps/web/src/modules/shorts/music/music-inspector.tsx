import type { MusicBed, MusicTrack, MusicTrackId, StageRun, TranscriptWord } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Pause, Play, Shuffle } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Detail, useDetailed } from "../../system/detail.tsx"
import { clockOf } from "../editor-values.ts"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import { StepDetails } from "../step-details.tsx"
import { AddSong } from "./music-stage.tsx"
import { fittable, partName, rightsName, songSpans } from "./music-values.ts"
import { MusicWaveform } from "./music-waveform.tsx"

// The Music panel's views: the song and its drop word, or (Detailed, once a song is fitted) the arrangement
export type MusicTab = "song" | "arrange"

// What a change costs and does, said before it's applied.
const REFIT_HELP = "The short is laid out and rendered again with it. Nothing is regenerated, so it costs nothing."

// The Music panel: the short's song (tempo, rights, which part of it plays) with Change song, and the word of the
// narration the drop lands on. Applying a change fits a new bed and re-runs the short from assemble. In Detailed mode,
// `arrange` (the arrangement editor, once a song is fitted) is the panel's second view.
export function MusicInspector({
  track,
  bed,
  tracks,
  trackUrl,
  words,
  defaultWord,
  picking,
  onPicking,
  busy,
  error,
  running,
  onApply,
  stages,
  tab: openTab,
  arrange
}: {
  readonly track: MusicTrack | null
  readonly bed: MusicBed | null
  readonly tracks: ReadonlyArray<MusicTrack>
  readonly trackUrl: (track: MusicTrack) => string
  readonly words: ReadonlyArray<TranscriptWord>
  // the word the drop lands on when you haven't picked one
  readonly defaultWord: number | null
  // the song picker is open
  readonly picking: boolean
  readonly onPicking: (picking: boolean) => void
  readonly busy: boolean
  readonly error: string | null
  // a run is going (it's stopped first when a change is applied)
  readonly running: boolean
  // trackId null: no music; dropWord undefined: keep it, null: back to the default
  readonly onApply: (trackId: MusicTrackId | null, dropWord: number | null | undefined) => void
  readonly stages: ReadonlyArray<StageRun>
  readonly tab: MusicTab
  readonly arrange: ReactNode
}) {
  const detailed = useDetailed()
  const [voiceOnly, setVoiceOnly] = useState(false)
  if (openTab === "arrange" && detailed && arrange !== null) return <>{arrange}</>
  return (
    <>
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto px-3.5 pt-1 pb-4">
        {picking ? (
            <SongPicker
              current={track?.id ?? null}
              tracks={tracks}
              trackUrl={trackUrl}
              busy={busy}
              running={running}
              onCancel={() => onPicking(false)}
              onPick={(id) => onApply(id, undefined)}
            />
          ) : track === null ? (
            <InspectorBlock title="Song">
              <span className="text-sm">Voice only</span>
              <span className="text-xs text-fg-2">This short plays without music.</span>
              <div><AddSong hasSongs={tracks.length > 0} onPick={() => onPicking(true)} /></div>
            </InspectorBlock>
          ) : (
            <>
              <InspectorBlock title="Song" action={<Button onClick={() => onPicking(true)}><Shuffle />Change song</Button>}>
                <span className="truncate text-sm font-medium">{track.title}</span>
                <Facts
                  rows={[
                    ["Tempo", track.bpm === null ? "Not known yet" : `${track.bpm.toFixed(1)} BPM`],
                    ["Rights", rightsName(track.rights)],
                    ...(track.dropS === null ? [] : [["Drop in the song", clockOf(track.dropS)] as const])
                  ]}
                />
              </InspectorBlock>
              <InspectorBlock title="What plays" action={<span className="font-normal text-fg-3">the bright part</span>}>
                <MusicWaveform
                  url={trackUrl(track)}
                  durationS={track.durationS}
                  dropS={track.dropS}
                  time={null}
                  lit={bed === null || bed.trackId !== track.id ? undefined : songSpans(bed)}
                />
                {bed === null || bed.trackId !== track.id ? (
                  <span className="text-xs text-fg-2">Shown once the song is fitted to this short.</span>
                ) : (
                  <span className="text-xs text-fg-2">
                    {songSpans(bed).map((s) => `${clockOf(s.from)}–${clockOf(s.to)}`).join(", ")} of the song, fitted so its drop lands on “{bed.dropWordText ?? "the drop word"}”.
                  </span>
                )}
              </InspectorBlock>
              {bed === null || bed.trackId !== track.id ? null : (
                <Detail>
                  <InspectorBlock title="The bed, part by part">
                    <Facts
                      rows={bed.segments.map((s, i) => [
                        `${partName(s.kind)}${bed.segments.filter((x) => x.kind === s.kind).length > 1 ? ` ${bed.segments.slice(0, i + 1).filter((x) => x.kind === s.kind).length}` : ""}`,
                        `song ${s.from.toFixed(1)}–${s.to.toFixed(1)}s at ${s.at.toFixed(1)}s`
                      ] as const)}
                    />
                  </InspectorBlock>
                </Detail>
              )}
              {error === null ? null : <span className="text-xs text-danger">{error}</span>}
            </>
          )}
        {picking || track === null ? null : (
          <DropPicker bed={bed} words={words} defaultWord={defaultWord} busy={busy} running={running} error={error} onApply={(w) => onApply(track.id, w)} />
        )}
        {picking || track === null ? null : voiceOnly ? (
          <InspectorBlock title="Voice only">
            <span className="text-xs text-fg-2">{REFIT_HELP}{running ? " The run going now is stopped first." : ""}</span>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setVoiceOnly(false)}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={() => onApply(null, undefined)}>Use voice only</Button>
            </div>
          </InspectorBlock>
        ) : (
          <Button variant="ghost" className="justify-self-start" disabled={busy} onClick={() => setVoiceOnly(true)}>Voice only, no song</Button>
        )}
        <StepDetails stages={stages} names={["assemble"]} />
      </div>
    </>
  )
}

// The song picker: every song in the library (a sample plays on ▶), plus No music.
function SongPicker({ current, tracks, trackUrl, busy, running, onCancel, onPick }: {
  readonly current: MusicTrackId | null
  readonly tracks: ReadonlyArray<MusicTrack>
  readonly trackUrl: (track: MusicTrack) => string
  readonly busy: boolean
  readonly running: boolean
  readonly onCancel: () => void
  readonly onPick: (id: MusicTrackId | null) => void
}) {
  const [picked, setPicked] = useState<MusicTrackId | null>(current)
  const sample = useRef<HTMLAudioElement | null>(null)
  const [sampling, setSampling] = useState<MusicTrackId | null>(null)
  useEffect(() => () => sample.current?.pause(), [])
  const play = (track: MusicTrack) => {
    sample.current?.pause()
    if (sampling === track.id) return setSampling(null)
    const el = new Audio(trackUrl(track))
    // from a little before the drop, where a song shows what it is
    if (track.dropS !== null) el.currentTime = Math.max(0, track.dropS - 6)
    el.onended = () => setSampling(null)
    sample.current = el
    setSampling(track.id)
    void el.play().catch(() => setSampling(null))
  }
  const row = (id: MusicTrackId | null, title: string, line: string, enabled: boolean, track: MusicTrack | null) => (
    <div
      key={id ?? "none"}
      role="radio"
      aria-checked={picked === id}
      aria-disabled={!enabled}
      tabIndex={enabled ? 0 : -1}
      onClick={() => enabled && setPicked(id)}
      onKeyDown={(e) => enabled && (e.key === "Enter" || e.key === " ") && setPicked(id)}
      title={enabled ? undefined : "Set its tempo and drop in Library › Music first"}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-ctl px-2.5 py-1.5 outline-none",
        enabled ? "cursor-pointer hover:bg-ctl focus-visible:bg-ctl" : "opacity-50",
        picked === id && "shadow-[inset_0_0_0_1px_var(--lemon)]"
      )}
    >
      <div className="grid min-w-0">
        <span className="truncate text-sm">{title}{id === current ? <span className="ml-1.5 text-xs text-fg-3">now</span> : null}</span>
        <span className="truncate text-xs text-fg-2">{line}</span>
      </div>
      {track === null ? <span className="size-7" /> : (
        <IconButton label={sampling === track.id ? "Stop" : `Play ${track.title}`} onClick={(e) => (e.stopPropagation(), play(track))}>
          {sampling === track.id ? <Pause /> : <Play />}
        </IconButton>
      )}
    </div>
  )
  return (
    <InspectorBlock title="Change song">
      <div role="radiogroup" aria-label="Songs" className="grid gap-px">
        {row(null, "No music", "Voice only", true, null)}
        {tracks.map((t) => row(t.id, t.title, fittable(t) ? `${t.bpm!.toFixed(0)} BPM · ${rightsName(t.rights)}` : "Tempo and drop not known yet", fittable(t), t))}
      </div>
      <span className="text-xs text-fg-2">{REFIT_HELP}{running ? " The run going now is stopped first." : ""}</span>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={busy || picked === current} onClick={() => onPick(picked)}>
          {picked === null ? "Use voice only" : "Use this song"}
        </Button>
      </div>
    </InspectorBlock>
  )
}

// The narration's words; the drop lands on one. Pick another and apply it.
function DropPicker({ bed, words, defaultWord, busy, running, error, onApply }: {
  readonly bed: MusicBed | null
  readonly words: ReadonlyArray<TranscriptWord>
  readonly defaultWord: number | null
  readonly busy: boolean
  readonly running: boolean
  readonly error: string | null
  readonly onApply: (word: number | null) => void
}) {
  const current = bed?.dropWord ?? null
  const [picked, setPicked] = useState<number | null>(current)
  useEffect(() => setPicked(current), [current])
  if (bed === null) {
    return (
      <InspectorBlock title="Drop word">
        <span className="text-xs text-fg-2">With a song, its drop lands on a word of the narration, and you can pick which.</span>
      </InspectorBlock>
    )
  }
  const word = (i: number | null) => (i === null ? "" : words[i]?.w.replace(/[^\p{L}\p{N}'’-]/gu, "") ?? "")
  return (
    <>
      <InspectorBlock title="Drop word">
        <span className="text-xs text-fg-2">
          The drop lands on “{word(current)}” at {clockOf(bed.dropAtS)}{current === defaultWord ? ", the start of the last line" : ""}. Pick another word.
        </span>
        <p className="m-0 text-sm leading-[1.9]">
          {words.map((w, i) => (
            <span key={i}>
              <button
                type="button"
                onClick={() => setPicked(i)}
                title={`${w.s.toFixed(1)}s in the voiceover`}
                className={cn(
                  "cursor-pointer rounded-[4px] px-[2px] outline-none hover:bg-ctl",
                  i === current ? "bg-lemon text-lemon-ink hover:bg-lemon" : "text-fg-1",
                  i === picked && i !== current && "shadow-[inset_0_0_0_1px_var(--lemon)]"
                )}
              >
                {w.w}
              </button>{" "}
            </span>
          ))}
        </p>
      </InspectorBlock>
      <div className="grid gap-2">
        <span className="text-xs text-fg-2">{REFIT_HELP}{running ? " The run going now is stopped first." : ""}</span>
        <div className="flex flex-wrap justify-end gap-2">
          {current === defaultWord || defaultWord === null ? null : (
            <Button variant="ghost" disabled={busy} onClick={() => onApply(null)}>Back to the last line</Button>
          )}
          <Button variant="primary" disabled={busy || picked === null || picked === current} onClick={() => onApply(picked)}>
            {picked === null || picked === current ? "Drop here" : `Drop on “${word(picked)}”`}
          </Button>
        </div>
        {error === null ? null : <span className="text-xs text-danger">{error}</span>}
      </div>
    </>
  )
}
