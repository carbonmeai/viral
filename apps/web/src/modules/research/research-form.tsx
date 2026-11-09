import { useAtomSet } from "@effect/atom-react"
import { DEFAULT_RESEARCH_VIDEOS, RESEARCH_SEARCHES, RESEARCH_VIDEO_COUNTS, type ResearchLength, type ResearchVideoCount } from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@viral/ui/primitives/button"
import { Panel } from "@viral/ui/primitives/panel"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Textarea } from "@viral/ui/primitives/textarea"
import { Search } from "lucide-react"
import { useState } from "react"
import { Detail } from "../system/detail.tsx"
import { startResearch } from "./research-api.ts"
import { COPYRIGHT_SHORT, defaultLength, estimateLine, IDEA_EXAMPLES, LENGTH_CHOICES } from "./research-values.ts"

// New › From an idea: what the short is about, how many videos and how long. Find videos makes a set with no videos
// yet and opens its page, where the search shows live; nothing is downloaded until you approve the shortlist.
export function ResearchForm() {
  const navigate = useNavigate()
  const start = useAtomSet(startResearch, { mode: "promise" })
  const [idea, setIdea] = useState("")
  const [videos, setVideos] = useState<ResearchVideoCount>(DEFAULT_RESEARCH_VIDEOS)
  // null until you choose: follows the idea (a ranking starts at Up to 3 min)
  const [chosenLength, setLength] = useState<ResearchLength | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const length = chosenLength ?? defaultLength(idea)
  const ready = idea.trim() !== "" && !starting

  const find = () => {
    setStarting(true)
    setError(null)
    start({ payload: { idea: idea.trim(), videos, length } })
      .then((set) => navigate({ to: "/sets/$setId", params: { setId: set.id } }))
      .catch(() => setError("Couldn't start the search. Is the server running?"))
      .finally(() => setStarting(false))
  }

  return (
    <div className="grid gap-2">
      <Panel title="The idea">
        <Textarea
          aria-label="The idea"
          placeholder="e.g. Top 5 animal rescue comebacks, before and after"
          value={idea}
          maxLength={300}
          onChange={(e) => setIdea(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready && find()}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {IDEA_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setIdea(example)}
              className="h-7 cursor-pointer rounded-chip bg-item px-2.5 text-xs text-fg-1 hover:bg-item-hover hover:text-fg"
            >
              {example}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="The short">
        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
          <span className="text-fg-2">How many videos</span>
          <Segmented
            label="How many videos"
            value={String(videos)}
            onChange={(v) => setVideos(Number(v) as ResearchVideoCount)}
            options={RESEARCH_VIDEO_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
            className="w-fit"
          />
          <span className="text-fg-2">How long</span>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Segmented label="How long a short" value={length} onChange={setLength} options={LENGTH_CHOICES} className="w-fit" />
            <span className="text-xs text-fg-2">{estimateLine(videos, length)}</span>
          </div>
        </div>
      </Panel>

      <Detail>
        <Panel title="How it runs" actions="a minute or two of searching">
          <div className="grid gap-1.5 text-xs">
            {[
              ["Who searches", "Haiku, unless Settings › Agents says otherwise"],
              ["YouTube", `Only searched: titles, channels, lengths, descriptions and captions (up to ${RESEARCH_SEARCHES} searches). Nothing is downloaded.`],
              ["After you approve", "The videos download (1080p at most), Viral reads them and suggests three shorts across them"]
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                <span className="text-fg-2">{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </Panel>
      </Detail>

      <div className="flex items-center justify-end gap-3 pt-1">
        <span className={error === null ? "mr-auto text-xs text-fg-2" : "mr-auto text-xs text-danger"}>{error ?? COPYRIGHT_SHORT}</span>
        <Button variant="primary" size="md" disabled={!ready} onClick={find}><Search />{starting ? "Starting…" : "Find videos"}</Button>
      </div>
    </div>
  )
}
