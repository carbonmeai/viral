import type { Source } from "@viral/contracts"
import { useAtomSet } from "@effect/atom-react"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { useState } from "react"
import { setSourceDetails } from "./videos-api.ts"

// The video's own name and its channel, yours to set (a local file only knows its file name). The channel is
// credited ("Video: <channel>") when the footage isn't yours.
export function VideoDetails({ source, onDone }: { readonly source: Source; readonly onDone: () => void }) {
  const save = useAtomSet(setSourceDetails, { mode: "promise" })
  const [title, setTitle] = useState(source.title ?? "")
  const [channel, setChannel] = useState(source.channel ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    setSaving(true)
    setError(null)
    save({
      payload: { id: source.id, title: title.trim() === "" ? null : title, channel: channel.trim() === "" ? null : channel },
      reactivityKeys: [`source:${source.id}`]
    }).then(onDone, () => setError("Couldn't save. Is the server running?")).finally(() => setSaving(false))
  }
  return (
    <section className="mb-2 grid gap-3 rounded-panel bg-panel px-4 py-3.5">
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs text-fg-2">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the video is called" /></label>
        <label className="grid gap-1 text-xs text-fg-2">Channel<Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Who made it" /></label>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-fg-2">The channel is credited as “Video: {channel.trim() === "" ? "<channel>" : channel.trim()}” when the footage isn't yours.</span>
        {error === null ? null : <span className="text-xs text-danger">{error}</span>}
        <Button className="ml-auto" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={saving} onClick={submit}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </section>
  )
}
