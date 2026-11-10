import type { Preset, Script, ScriptLimits, StageRun } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Check } from "lucide-react"
import { useState } from "react"
import { InspectorBlock } from "../editor-frame.tsx"
import { VideoDot } from "../../sets/video-badge.tsx"
import { narratedWords, payoffSeconds, realLines, realsByVideo } from "../editor-values.ts"
import type { GateControls } from "../gate.ts"
import { StepDetails } from "../step-details.tsx"

// The Script panel's views: the lines themselves, or the rules they're checked against (and the headline)
export type ScriptTab = "lines" | "rules"

// How a count sits against what the approach wants: the wanted range shaded, the count marked.
function Meter({ label, value, range }: { readonly label: string; readonly value: number; readonly range: readonly [number, number] }) {
  const max = Math.max(range[1] * 1.4, value + 1)
  const ok = value >= range[0] && value <= range[1]
  return (
    <InspectorBlock title={label} action={<span className={ok ? "text-fg" : "text-wait"}>{value}</span>}>
      <span className="relative block h-1.5 rounded-full bg-ctl-active">
        <i
          className="absolute inset-y-0 rounded-full bg-[color-mix(in_srgb,var(--ok-dot)_28%,transparent)]"
          style={{ left: `${(range[0] / max) * 100}%`, width: `${((range[1] - range[0]) / max) * 100}%` }}
        />
        <b className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg" style={{ left: `${(Math.min(value, max) / max) * 100}%` }} />
      </span>
      <span className="text-xs text-fg-2">This approach wants {range[0]}–{range[1]}.</span>
    </InspectorBlock>
  )
}

// The Script panel's Rules view: the counts against what the approach wants, the real lines by video, what the server
// checks, and the headline pinned at the top (edited while the script waits for you).
export function ScriptRules({ script, limits, preset, videos, stages, gate }: {
  readonly script: Script
  // the short's videos' titles, the first one first
  readonly videos: ReadonlyArray<string>
  readonly limits: ScriptLimits | null
  readonly preset: Preset
  readonly stages: ReadonlyArray<StageRun>
  readonly gate: GateControls
}) {
  const [lines, setLines] = useState<readonly [string, string]>(script.headline ?? ["", ""])
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])
  const saveHeadline = () => {
    const headline = lines[0].trim() === "" && lines[1].trim() === "" ? null : [lines[0].trim(), lines[1].trim()] as const
    void gate.edit({ ...script, headline }).then(setProblems)
  }
  return (
    <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto px-3.5 pt-1 pb-4">
      {limits === null ? null : (
        <>
          <Meter label="Narrated words" value={narratedWords(script)} range={limits.narrationWords} />
          <Meter label="Real lines" value={realLines(script)} range={limits.reals} />
          {limits.ending === null ? null : (
            <Meter label="Payoff take (seconds)" value={Math.round(payoffSeconds(script))} range={limits.ending.seconds} />
          )}
        </>
      )}
      {videos.length < 2 ? null : (
        <InspectorBlock title="Real lines by video">
          {realsByVideo(script, videos.length).map((count, i) => (
            <span key={i} className="flex min-w-0 items-center gap-2 text-sm text-fg-1">
              <VideoDot index={i} />
              <span className="truncate">{videos[i]}</span>
              <span className="ml-auto text-fg-2 tabular-nums">{count}</span>
            </span>
          ))}
        </InspectorBlock>
      )}
      <InspectorBlock title="Checked by the server">
        {[
          videos.length < 2 ? "Every real line is in the transcript, at its times" : "Every real line is in its own video's transcript, at its times",
          "None inside an ad, a sponsor read or the end screen",
          ...(limits?.wholeSentences === true ? ["Every real line is whole sentences (a pause over 1.5 s ends one)"] : []),
          `Real lines ${limits?.realSeconds[0] ?? 0.8}–${limits?.realSeconds[1] ?? 8} s each${limits?.ending == null ? "" : `; the payoff one take of ${limits.ending.seconds[0]}–${limits.ending.seconds[1]} s`}`,
          ...(limits?.realsOnlyAtEnd ? ["Real lines only after the narration"] : []),
          "Headline under 8 words"
        ].map((rule) => (
          <span key={rule} className="flex items-start gap-1.5 text-sm text-fg-1"><Check className="mt-0.5 size-3.5 shrink-0 text-ok-dot" />{rule}</span>
        ))}
      </InspectorBlock>
      <InspectorBlock title="Headline">
        <span className="text-xs text-fg-2">
          {preset.config.headline === null
            ? `Pinned in styles with a headline. ${preset.name} doesn't show one.`
            : `Pinned at the top of the short in ${preset.name}.`}
        </span>
        <Input aria-label="Headline, first line" value={lines[0]} onChange={(e) => setLines([e.currentTarget.value, lines[1]])} disabled={gate.request === null} />
        <Input aria-label="Headline, second line" value={lines[1]} onChange={(e) => setLines([lines[0], e.currentTarget.value])} disabled={gate.request === null} />
        {problems.length === 0 ? null : <ul className="m-0 grid gap-1 pl-4 text-xs text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {gate.request === null ? null : (
          <div className="flex justify-end">
            <Button variant="primary" disabled={gate.busy} onClick={saveHeadline}>Save the headline</Button>
          </div>
        )}
      </InspectorBlock>
      <StepDetails stages={stages} names={["script"]} />
    </div>
  )
}
