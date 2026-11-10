import { useAtom, useAtomSet } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Menu, MenuItem, MenuNote, MenuSeparator } from "@viral/ui/primitives/menu"
import { Tooltip } from "@viral/ui/primitives/tooltip"
import { ArrowLeft, Check, Download, Eye, FolderOpen, MessageSquare, Moon, RefreshCw, Sun, Target, Video } from "lucide-react"
import { type KeyboardEvent, useState } from "react"
import { desktop } from "../../config/server-url.ts"
import { useWindowControlsInset } from "../layout/window-controls.ts"
import { modeAtom, themeAtom } from "../system/preferences.ts"
import { BriefDialog } from "./brief-dialog.tsx"
import { primaryButtons } from "./editor-values.ts"
import { renameProject } from "./shorts-api.ts"
import { StepBar } from "./step-bar.tsx"
import type { EditorState } from "./use-editor-state.ts"
import { VideosMenu } from "./videos-menu.tsx"

// The theme the window shows now: the one you picked, else the Mac's.
const shownTheme = (theme: "system" | "dark" | "light") =>
  theme !== "system" ? theme : typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"

// The short's title; click it to rename the short (Enter saves, Esc cancels). The post's title is chosen at Publish.
function Title({ e }: { readonly e: EditorState }) {
  const rename = useAtomSet(renameProject, { mode: "promise" })
  const [editing, setEditing] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const title = e.ws.project.title
  const save = () => {
    const next = editing?.trim() ?? ""
    setEditing(null)
    if (next === "" || next === title) return
    rename({ payload: { id: e.ws.project.id, title: next } })
      .then(() => e.refresh())
      .catch(() => setFailed(true))
  }
  const keys = (k: KeyboardEvent) => {
    if (k.key === "Enter") save()
    if (k.key === "Escape") setEditing(null)
  }
  if (editing !== null) {
    return (
      <input
        autoFocus
        aria-label="The short's title"
        value={editing}
        onChange={(x) => setEditing(x.currentTarget.value)}
        onBlur={save}
        onKeyDown={keys}
        className="no-drag h-7 w-[240px] min-w-0 rounded-ctl bg-ctl px-2 text-base font-medium text-fg outline-none shadow-[inset_0_0_0_1px_var(--lemon)]"
      />
    )
  }
  return (
    <Tooltip content={failed ? "Couldn't rename it. Is the server running?" : "Click to rename. The title on the post is chosen at Publish."}>
      <button
        type="button"
        onClick={() => {
          setFailed(false)
          setEditing(title)
        }}
        className="no-drag h-7 max-w-[220px] min-w-0 shrink truncate rounded-ctl px-1.5 text-left text-base font-medium outline-none hover:bg-ctl focus-visible:shadow-[0_0_0_1px_var(--lemon)]"
      >
        {title}
      </button>
    </Tooltip>
  )
}

// The editor's top bar, which also drags the window: back to Home, the short's title, its videos, the slim step bar,
// the 9:16 chip, the ⋯ menu (brief, videos, Show in Finder, theme, Simple/Detailed) and the primary button: the waiting
// step's Approve while a step waits, else Publish (Publish again when the published files are out of date). Below
// about 1100px it also opens the chat column (`onSide`).
export function EditorTopBar({ e, onSide }: { readonly e: EditorState; readonly onSide: () => void }) {
  const navigate = useNavigate()
  const inset = useWindowControlsInset()
  const [theme, setTheme] = useAtom(themeAtom)
  const [mode, setMode] = useAtom(modeAtom)
  const [briefOpen, setBriefOpen] = useState(false)
  const [videosOpen, setVideosOpen] = useState(false)
  const { ws, publish } = e
  const status = publish.status
  const waitingName = e.waitingOn === null ? null : e.steps.find((s) => s.id === e.waitingOn)?.name ?? null
  const buttons = primaryButtons({ waiting: waitingName, rendered: ws.render !== null, outOfDate: ws.metadata !== null && (status?.changes.length ?? 0) > 0 })
  const shown = shownTheme(theme)
  const onPublish = () => {
    // publishing again replaces files right away unless their names change, which the Publish step asks about first
    if (buttons.publish.label === "Publish again" && status !== null && status.replaces.length === 0 && !status.busy) void publish.publishAgain()
    else e.onStep("publish")
  }
  const publishButton = (
    <Button size="md" variant={buttons.publish.primary ? "primary" : "default"} disabled={!buttons.publish.enabled || publish.busy} onClick={onPublish}>
      {buttons.publish.label === "Publish again" ? <RefreshCw /> : <Download />}{buttons.publish.label}
    </Button>
  )
  return (
    <header className="drag flex min-w-0 items-center gap-2.5 pr-3 shadow-[inset_0_-1px_0_var(--line)]" style={{ paddingLeft: inset + 12 }}>
      <IconButton className="no-drag" label="Back to Home" onClick={() => void navigate({ to: "/" })}><ArrowLeft /></IconButton>
      <Title e={e} />
      <VideosMenu project={ws.project} running={e.going} onChanged={e.refresh} open={videosOpen} onOpenChange={setVideosOpen} />
      <StepBar steps={e.steps} states={e.states} open={e.open} onOpen={e.onStep} />
      <Tooltip content="9:16 for Shorts, Reels and TikTok">
        <span className="inline-flex h-7 shrink-0 items-center gap-[5px] px-1.5 text-xs text-fg-1">
          <i aria-hidden className="inline-block h-3.5 w-[9px] rounded-[2px] border-[1.5px] border-current" />9:16
        </span>
      </Tooltip>
      <span className="no-drag flex shrink-0 items-center gap-1.5">
        <span className="hidden max-[1100px]:inline-flex">
          <IconButton label="The agent and its gate" onClick={onSide}><MessageSquare /></IconButton>
        </span>
        <Menu label="More for this short">
          <MenuItem onClick={() => setBriefOpen(true)}>
            <Target />Brief…{ws.project.brief === null ? null : <span aria-label="set" className="ml-auto size-1.5 rounded-full bg-lemon" />}
          </MenuItem>
          <MenuItem onClick={() => setVideosOpen(true)}><Video />Videos…</MenuItem>
          {desktop === undefined ? null : <MenuItem onClick={() => void desktop?.showInFinder(ws.folder)}><FolderOpen />Show in Finder</MenuItem>}
          <MenuSeparator />
          <MenuNote>View</MenuNote>
          <MenuItem onClick={() => setTheme(shown === "dark" ? "light" : "dark")}>{shown === "dark" ? <Sun /> : <Moon />}{shown === "dark" ? "Light" : "Dark"} theme</MenuItem>
          <MenuItem onClick={() => setMode(mode === "detailed" ? "simple" : "detailed")}><Eye />{mode === "detailed" ? "Simple" : "Detailed"} mode</MenuItem>
        </Menu>
        {buttons.approve === null ? null : buttons.publish.enabled ? publishButton : (
          <Tooltip content={buttons.publish.reason}><span>{publishButton}</span></Tooltip>
        )}
        {buttons.approve !== null ? (
          <Button size="md" variant="primary" disabled={e.busy} onClick={e.approvePending}><Check />{buttons.approve}</Button>
        ) : buttons.publish.enabled ? publishButton : (
          <Tooltip content={buttons.publish.reason}><span>{publishButton}</span></Tooltip>
        )}
      </span>
      <BriefDialog project={ws.project} running={e.going} onSaved={e.refresh} open={briefOpen} onOpenChange={setBriefOpen} />
    </header>
  )
}
