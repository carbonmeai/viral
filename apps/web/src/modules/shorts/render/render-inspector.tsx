import type { ProjectFormat, RenderedShort, StageName, StageRun } from "@viral/contracts"
import { Detail } from "../../system/detail.tsx"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import { StepDetails } from "../step-details.tsx"
import { footageLines, footageSummary } from "./footage-values.ts"

// Where a render's problem is fixed: a wrong shot (or section) goes back to that step's agent; a style problem
// (captions, headline, framing, music) is laid out again with the short's current style.
export const sendBackTargets = (format: ProjectFormat): ReadonlyArray<{ readonly to: StageName; readonly label: string; readonly help: string }> => [
  format === "ranking"
    ? { to: "moments", label: "Ranking", help: "The moments agent gets your note in the same conversation. Then the ranking is assembled and rendered again (about 2 minutes)." }
    : format === "cut-down"
    ? { to: "sections", label: "Sections", help: "The sections agent gets your note in the same conversation. Then the short is assembled and rendered again (about 2 minutes)." }
    : { to: "shots", label: "Shots", help: "The shots agent gets your note in the same conversation. Then the short is assembled and rendered again (about 2 minutes). The script and voice stay as they are." },
  { to: "assemble", label: "Style", help: "The short is laid out again with its style as it is now (change it in the Style panel first), then rendered. Nothing is regenerated, so it costs nothing." }
]

// Checking a render: the check sheet (a frame a second, so every shot can be checked against what's said), the
// render's numbers, where its footage came from and what Viral checked in the mp4. It opens under the player; sending
// the render back with a note is the chat column's.
export function RenderCheck({ render, checkSheetUrl, checkFrameUrl, stages }: {
  readonly render: RenderedShort
  readonly checkSheetUrl: string | null
  // a ranking's check frame (an absolute path next to the render) as a URL, when the render's file is in the library
  readonly checkFrameUrl?: ((file: string) => string) | null
  readonly stages: ReadonlyArray<StageRun>
}) {
  return (
    <div className="grid content-start gap-5">
      <InspectorBlock title="Check it" action={<span className="font-normal text-fg-3">a frame a second</span>}>
        {checkSheetUrl === null
          ? <span className="text-xs text-fg-2">This render has no check sheet.</span>
          : (
            <a href={checkSheetUrl} target="_blank" rel="noreferrer" title="Open the check sheet full size">
              <img src={checkSheetUrl} alt="A frame for every second of the short" className="w-full rounded-[8px] bg-ctl" />
            </a>
          )}
        <span className="text-xs text-fg-2">
          Every frame should show what's being said. If one doesn't, send it back with a note.
        </span>
      </InspectorBlock>
      <InspectorBlock title="The short">
        <Facts rows={[["Length", `${render.durationS.toFixed(1)}s`], ["Shots", String(render.shots)]]} />
      </InspectorBlock>
      {render.footage === undefined || render.footage.length === 0 ? null : <FootageBlock footage={render.footage} />}
      {render.checks === undefined ? null : <RenderChecksBlock checks={render.checks} frameUrl={checkFrameUrl ?? null} />}
      <Detail>
        <InspectorBlock title="Files">
          <span className="text-xs break-all text-fg-2">{render.video.split("/").pop()}</span>
        </InspectorBlock>
      </Detail>
      <StepDetails stages={stages} names={["assemble", "render"]} />
    </div>
  )
}

// Where the footage came from, for videos found by research: they were read from 480p copies and only the seconds
// this short plays were fetched in 1080p. A clip that played from the 480p copy is said plainly, with why.
function FootageBlock({ footage }: { readonly footage: NonNullable<RenderedShort["footage"]> }) {
  const lines = footageLines(footage, footage.length > 1)
  const low = lines.some((l) => l.problem !== null)
  return (
    <InspectorBlock title="Footage" action={<span className={low ? "font-normal text-danger" : "font-normal text-fg-3"}>{footageSummary(footage)}</span>}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-sm">
        {lines.map((l) => (
          <div key={l.video} className="contents">
            <span className="min-w-0 truncate text-fg-2" title={l.video}>{l.video}</span>
            <span className={l.problem === null ? "shrink-0 whitespace-nowrap" : "shrink-0 whitespace-nowrap text-danger"}>{l.quality}</span>
          </div>
        ))}
      </div>
      {lines.filter((l) => l.problem !== null).map((l) => (
        <span key={l.video} className="text-xs text-danger">{l.video}: {l.problem}. Look closely before approving, or send it back to try again.</span>
      ))}
      <span className="text-xs text-fg-2">
        Found videos are read from small 480p copies; only the seconds this short plays are fetched in 1080p.
      </span>
    </InspectorBlock>
  )
}

// What Viral checked in a ranking's mp4: its loudness, any black frames, and the first and last frame of every shot
// (long shots drift into another animal or a recap).
function RenderChecksBlock({ checks, frameUrl }: { readonly checks: NonNullable<RenderedShort["checks"]>; readonly frameUrl: ((file: string) => string) | null }) {
  const loud = checks.lufs === null ? "Not measured" : `${checks.lufs.toFixed(1)} LUFS${Math.abs(checks.lufs + 14) > 1.5 ? " (aimed for −14)" : ""}`
  const black = checks.black.length === 0 ? "No black frames" : checks.black.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)}s`).join(", ")
  return (
    <InspectorBlock title="Checked">
      <Facts rows={[["Loudness", loud], ["Black frames", <span key="b" className={checks.black.length === 0 ? undefined : "text-danger"}>{black}</span>]]} />
      {frameUrl === null || checks.frames.length === 0 ? null : (
        <>
          <span className="text-xs text-fg-2">Each shot’s first and last frame. Both should show the same animal.</span>
          <div className="grid grid-cols-2 gap-1">
            {checks.frames.map((f) => (
              <div key={`${f.rank}-${f.shot}`} className="grid grid-cols-2 gap-0.5" title={`#${f.rank} shot ${f.shot + 1} · ${f.start.toFixed(1)}–${f.end.toFixed(1)}s`}>
                <img src={frameUrl(f.first)} alt={`#${f.rank} shot ${f.shot + 1}, first frame`} className="aspect-[9/16] w-full rounded-[4px] bg-ctl object-cover" loading="lazy" />
                <img src={frameUrl(f.last)} alt={`#${f.rank} shot ${f.shot + 1}, last frame`} className="aspect-[9/16] w-full rounded-[4px] bg-ctl object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </>
      )}
    </InspectorBlock>
  )
}
