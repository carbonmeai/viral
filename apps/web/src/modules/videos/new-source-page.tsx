import { useAtomSet } from "@effect/atom-react"
import type { SourceRights } from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Panel } from "@viral/ui/primitives/panel"
import { Check, FolderOpen } from "lucide-react"
import { useState } from "react"
import { desktop } from "../../config/server-url.ts"
import { Page } from "../layout/page.tsx"
import { Detail } from "../system/detail.tsx"
import { createSource, startSourceRun } from "./videos-api.ts"
import { isVideoLink, RIGHTS_CHOICES } from "./video-values.ts"

// Adding a video: a link or a file, who owns the footage, then Start reads it (transcript, frames, ads,
// story) and opens its page to follow along.
export function NewSourcePage() {
  const navigate = useNavigate()
  const create = useAtomSet(createSource, { mode: "promise" })
  const startRun = useAtomSet(startSourceRun, { mode: "promise" })
  const [input, setInput] = useState("")
  const [rights, setRights] = useState<SourceRights>("unconfirmed")
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = input.trim()
  const isLink = isVideoLink(value)
  // a link, or (outside a link) a file path: chosen with the open panel in the app, typed in a browser
  const ready = value !== "" && (isLink || value.startsWith("/"))

  const choose = () => {
    void desktop?.openFile().then((path) => path === null ? undefined : setInput(path))
  }
  const start = () => {
    setStarting(true)
    setError(null)
    create({ payload: { origin: isLink ? { _tag: "Url", url: value } : { _tag: "File", path: value }, rights, rightsNote: null } })
      .then((source) => startRun({ payload: { sourceId: source.id } }).then(() => source))
      .then((source) => navigate({ to: "/videos/$sourceId", params: { sourceId: source.id } }))
      .catch(() => setError("Couldn't add that video. Is the server running?"))
      .finally(() => setStarting(false))
  }

  return (
    <Page title="New source" description="Paste a link or choose a file. Viral transcribes it, maps the story and suggests three shorts.">
      <div className="grid gap-2">
        <Panel title="Video">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ready && !starting && start()}
              placeholder={desktop === undefined ? "https://www.youtube.com/watch?v=…  or  /path/to/video.mp4" : "https://www.youtube.com/watch?v=…"}
              aria-label="Video link or file"
              className="flex-1"
            />
            {desktop === undefined ? null : <Button onClick={choose}><FolderOpen />Choose a file</Button>}
            <Button variant="primary" disabled={!ready || starting} onClick={start}>{starting ? "Starting…" : "Start"}</Button>
          </div>
          <div className="mt-2 text-xs text-fg-2">
            YouTube, TikTok, Instagram or a direct link{desktop === undefined ? ", or the full path of a video file on this computer." : ", or a video file on this Mac."}
          </div>
          {error === null ? null : <div className="mt-1 text-xs text-danger">{error}</div>}
        </Panel>

        <Panel title="Who owns this footage?">
          <p className="m-0 mb-2 text-xs text-fg-2">Sets the credit line, and how firmly Viral reminds you before you post.</p>
          {RIGHTS_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => setRights(choice.value)}
              className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-ctl bg-item px-3 py-2 text-left hover:bg-item-hover ${rights === choice.value ? "shadow-[inset_0_0_0_1px_var(--lemon)]" : ""}`}
            >
              <span>
                <span className="block font-medium">{choice.title}</span>
                <span className="block text-xs text-fg-2">{choice.sub}</span>
              </span>
              {rights === choice.value ? <Check className="size-4 text-lemon-fg" /> : null}
            </button>
          ))}
        </Panel>

        <Detail>
          <Panel title="How it runs" actions="a few minutes for a long video">
            <div className="grid gap-1.5 text-xs">
              {[
                ["Transcription", "Grok when an xAI key is saved, otherwise local Whisper"],
                ["Ads and sponsor reads", "Haiku"],
                ["Story and proposals", "Your Claude CLI default"]
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-fg-2">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </Panel>
        </Detail>
      </div>
    </Page>
  )
}
