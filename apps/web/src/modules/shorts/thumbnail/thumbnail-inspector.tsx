import { useAtomValue } from "@effect/atom-react"
import type { SourceId, StageRun, ThumbConfig } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Image, MessageSquare } from "lucide-react"
import { AskBox } from "../ask-box.tsx"
import { ClipBadge } from "../clip-badge.tsx"
import { clockOf } from "../editor-values.ts"
import { Facts, InspectorBlock } from "../editor-frame.tsx"
import type { GateControls } from "../gate.ts"
import { type InspectorTab, InspectorTabs } from "../inspector-tabs.tsx"
import { framesAroundAtom, framesKey } from "../shorts-api.ts"
import { StepDetails } from "../step-details.tsx"
import { changedLines, momentsOf, type ThumbnailWords } from "./thumbnail-values.ts"

export type ThumbnailTab = "thumbnail" | "ask"
const TABS: ReadonlyArray<InspectorTab<ThumbnailTab>> = [
  { id: "thumbnail", label: "Thumbnail", icon: Image },
  { id: "ask", label: "Ask the thumbnail agent", icon: MessageSquare }
]

// The still of a video at one moment, small; in a short from several videos, with that video's colour and name.
function Moment({ sourceId, name, t, source, videos, stillUrl }: {
  readonly sourceId: SourceId
  readonly name: string
  readonly t: number
  // which of the short's videos (by position), and how many it has
  readonly source: number
  readonly videos: number
  readonly stillUrl: (path: string, source: number) => string
}) {
  const frames = Option.getOrNull(AsyncResult.value(useAtomValue(framesAroundAtom(framesKey(sourceId, t, 0)))))
  const frame = frames?.frames[0] ?? null
  return (
    <div className="grid gap-1">
      <div className="aspect-video overflow-hidden rounded-[6px] bg-ctl-active">
        {frame === null ? null : <img src={stillUrl(frame.path, source)} alt={`${name} at ${clockOf(t)}`} className="size-full object-cover" />}
      </div>
      <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-fg-2">
        {name} · {clockOf(t)}
        <ClipBadge source={source} videos={videos} />
      </span>
    </div>
  )
}

// The thumbnail step's inspector: its words (edit them and send the edit, checked first), the moments it's made from
// (each from its own video, in a short from several), and a note to the thumbnail agent.
export function ThumbnailInspector({ config, sourceIds, stillUrl, words, onWords, problems, onRevert, onSend, stages, gate, tab, onTab }: {
  readonly config: ThumbConfig
  // the short's videos, by position (the first first)
  readonly sourceIds: ReadonlyArray<SourceId>
  // a still's file of one of the short's videos (by position)
  readonly stillUrl: (path: string, source: number) => string
  readonly words: ThumbnailWords
  readonly onWords: (words: ThumbnailWords) => void
  readonly problems: ReadonlyArray<string>
  readonly onRevert: () => void
  readonly onSend: () => void
  readonly stages: ReadonlyArray<StageRun>
  readonly gate: GateControls
  readonly tab: ThumbnailTab
  readonly onTab: (tab: ThumbnailTab) => void
}) {
  const editable = gate.request !== null
  const changes = changedLines(config, words)
  return (
    <>
      <InspectorTabs tabs={TABS} open={tab} onOpen={onTab} />
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto p-4">
        {tab === "ask" ? (
          <AskBox gate={gate} who="thumbnail agent" placeholder="e.g. Use a face where his eyes are open, and make the words a question." />
        ) : (
          <>
            <InspectorBlock title="Words">
              <div className="grid gap-1.5">
                {config.lines.map((line, i) => (
                  <Input
                    key={i}
                    aria-label={`Line ${i + 1}`}
                    value={words[i] ?? line.text}
                    disabled={!editable}
                    onChange={(e) => onWords(config.lines.map((l, j) => (j === i ? e.currentTarget.value : words[j] ?? l.text)))}
                  />
                ))}
              </div>
              <span className="text-xs text-fg-2">
                {editable
                  ? `${config.layout === "bold" ? "2–5" : "2–4"} words in all. A tease the short delivers on, never a lie.`
                  : "The words can be edited while the thumbnail is waiting for you."}
              </span>
            </InspectorBlock>
            <InspectorBlock title="Made from">
              <div className="grid grid-cols-2 gap-2">
                {momentsOf(config).map((m) => (
                  <Moment
                    key={m.name}
                    sourceId={sourceIds[m.source] ?? sourceIds[0]!}
                    name={m.name}
                    t={m.t}
                    source={m.source}
                    videos={sourceIds.length}
                    stillUrl={stillUrl}
                  />
                ))}
              </div>
            </InspectorBlock>
            <InspectorBlock title="Layout">
              <Facts
                rows={[
                  ["Style", config.layout === "bold" ? "Bold: cut-outs on colour" : "Classic: framed insets"],
                  ["Arrow", config.arrow === true ? "Yes" : "No"],
                  ["Emoji", config.emoji?.char ?? "None"]
                ]}
              />
            </InspectorBlock>
            <StepDetails stages={stages} names={["thumbnail"]} />
          </>
        )}
      </div>
      {changes === 0 && problems.length === 0 ? null : (
        <div className="grid shrink-0 gap-2 px-4 py-2.5 shadow-[inset_0_1px_0_var(--line)]">
          {problems.length === 0 ? null : (
            <ul className="m-0 grid max-h-[120px] gap-1 overflow-auto pl-4 text-xs text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm">{changes} {changes === 1 ? "change" : "changes"}</span>
            <Button className="ml-auto" variant="ghost" disabled={gate.busy} onClick={onRevert}>Revert</Button>
            <Button variant="primary" disabled={!editable || gate.busy || changes === 0} onClick={onSend}>Send edit</Button>
          </div>
        </div>
      )}
    </>
  )
}
