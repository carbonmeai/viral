import { useAtomSet } from "@effect/atom-react"
import { MAX_SHORT_SOURCES, type Project } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Menu, MenuItem, MenuNote, MenuSeparator, MenuSub } from "@viral/ui/primitives/menu"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { VideoDot } from "../sets/video-badge.tsx"
import { AddVideoDialog } from "./add-video-dialog.tsx"
import { refusalText } from "./add-video-values.ts"
import { removeSourceFromProject } from "./shorts-api.ts"
import { nameOf, useShortVideos } from "./short-videos.tsx"

// The short's videos, in the title bar: their colours and how many, and a menu to add a video (from the library, a
// link or a file) or take one out. Every step can use any of them: real lines and shots, sections, the thumbnail's
// pictures, each marked with its video's colour and short name. Taking one out is refused while a step's current
// work uses it; the refusal names the steps.
export function VideosMenu({ project, running, onChanged }: {
  readonly project: Project
  // a run is going now
  readonly running: boolean
  readonly onChanged: () => void
}) {
  const videos = useShortVideos()
  const remove = useAtomSet(removeSourceFromProject, { mode: "promise" })
  const [adding, setAdding] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const count = project.sourceIds.length
  const cutDown = project.format === "cut-down"

  const takeOut = (index: number) => {
    const sourceId = project.sourceIds[index]
    if (sourceId === undefined) return
    remove({ payload: { id: project.id, sourceId } })
      .then(onChanged)
      .catch((e: unknown) => setRefused(refusalText(e, "Couldn't remove the video. Is the server running?")))
  }

  return (
    <>
      <Menu
        label="This short's videos"
        align="start"
        triggerClassName="no-drag h-7 gap-1.5 bg-ctl px-2 text-xs text-fg-1"
        trigger={
          <>
            <span className="flex items-center gap-0.5">{project.sourceIds.map((id, i) => <VideoDot key={id} index={i} />)}</span>
            {count === 1 ? "1 video" : `${count} videos`}
          </>
        }
      >
        <MenuNote>
          {count === 1
            ? "Made from one video. Add another to mix clips from both."
            : `${cutDown ? "Sections" : "Real lines and shots"} and the thumbnail's pictures can come from any of them.`}
        </MenuNote>
        {project.sourceIds.map((id, i) => (
          <MenuSub
            key={id}
            label={
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <VideoDot index={i} />
                <span className="truncate">{videos.titles[i] ?? nameOf(videos, i)}</span>
              </span>
            }
          >
            <MenuItem tone="danger" disabled={count === 1} onClick={() => takeOut(i)}>
              <Trash2 />Remove from this short
            </MenuItem>
            {count === 1 ? <MenuNote>A short needs a video.</MenuNote> : null}
          </MenuSub>
        ))}
        <MenuSeparator />
        <MenuItem disabled={count >= MAX_SHORT_SOURCES} onClick={() => setAdding(true)}>
          <Plus />Add a video to this short…
        </MenuItem>
      </Menu>
      <AddVideoDialog project={project} open={adding} onOpenChange={setAdding} running={running} onAdded={onChanged} />
      <Dialog
        open={refused !== null}
        onOpenChange={(open) => !open && setRefused(null)}
        title="The video stays in this short"
        footer={<Button variant="primary" onClick={() => setRefused(null)}>OK</Button>}
      >
        <p className="m-0 text-sm">{refused}</p>
      </Dialog>
    </>
  )
}
