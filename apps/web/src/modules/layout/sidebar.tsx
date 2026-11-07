import { useAtom, useAtomValue } from "@effect/atom-react"
import { Link, useLocation } from "@tanstack/react-router"
import { Count, Dot } from "@viral/ui/primitives/status"
import { Segmented } from "@viral/ui/primitives/segmented"
import { cn } from "@viral/ui/cn"
import { Tooltip } from "@viral/ui/primitives/tooltip"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ChevronRight, Film, Home, Inbox, Layers, Mic, Music, Palette, Plus, Settings } from "lucide-react"
import { type ReactNode, useEffect, useRef } from "react"
import { desktop } from "../../config/server-url.ts"
import { useWindowControlsInset } from "./window-controls.ts"
import { overviewAtom } from "../home/overview.ts"
import { SettingsNav } from "../settings/settings-nav.tsx"
import { modeAtom, nameAtom } from "../system/preferences.ts"

const navClass =
  "flex h-[30px] w-full items-center gap-2 whitespace-nowrap rounded-ctl px-2 text-left text-fg-1 hover:bg-ctl hover:text-fg [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-2"
const navActive = "bg-sel font-medium text-fg [&>svg]:text-fg"

// Shared by every sidebar link: the row's look, and the lit state when its page is open.
const nav = { className: navClass, activeProps: { className: navActive } } as const

function Group({ label, children }: { readonly label?: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-px px-2 py-1 [&+&]:mt-2.5">
      {label === undefined ? null : <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-fg-2">{label}</div>}
      {children}
    </div>
  )
}

const RECENT_SHORTS = 5

// The app's left column: the window buttons' row, the workspace, the main places, your videos and recent
// shorts, the library, then the Simple/Detailed switch and you, pinned to the bottom.
export function Sidebar() {
  const overview = useAtomValue(overviewAtom)
  const [mode, setMode] = useAtom(modeAtom)
  const data = Option.getOrNull(AsyncResult.value(overview))
  const connected = AsyncResult.isSuccess(overview)
  const waiting = data?.waiting ?? []
  const inset = useWindowControlsInset()
  const [name] = useAtom(nameAtom)
  const displayName = name.trim() || desktop?.userName || "You"
  // while you're in Settings the sidebar lists its sections; its back arrow returns to where you were
  const pathname = useLocation({ select: (location) => location.pathname })
  const inSettings = pathname.startsWith("/settings")
  const lastAppPath = useRef("/")
  useEffect(() => {
    if (!inSettings) lastAppPath.current = pathname
  }, [inSettings, pathname])

  return (
    <nav aria-label="Main" className="flex min-w-0 flex-col overflow-y-auto bg-win">
      {/* one top row that drags the window: the macOS window buttons alone in a normal window; the workspace
          name only where they're hidden (full screen) or absent (a browser) */}
      <div className="drag flex h-11 shrink-0 items-center gap-1.5 pr-2.5" style={{ paddingLeft: inset + 8 }}>
        {inset > 0 ? null : <Tooltip content="One workspace for now">
          <span className="no-drag flex items-center gap-[7px] rounded-ctl p-1 text-[14px] font-semibold">
            <span className="grid size-5 place-items-center rounded-[6px] bg-lemon">
              <svg viewBox="0 0 24 24" className="size-[9px] fill-lemon-ink"><path d="M7 4.5v15l12-7.5z" /></svg>
            </span>
            Viral
            <ChevronRight className="size-3.5 text-fg-2" />
          </span>
        </Tooltip>}
      </div>

      {inSettings
        ? <SettingsNav backTo={lastAppPath.current} navClass={navClass} activeClass={navActive} />
        : (
          <>
          <Group>
            <Link to="/" {...nav} activeOptions={{ exact: true }}><Home />Home</Link>
            <Link to="/waiting" {...nav}>
              <Inbox />
              Waiting for you
              {waiting.length > 0 ? <Count className="ml-auto">{waiting.length}</Count> : null}
            </Link>
            <Link to="/videos/new" {...nav}><Plus />New</Link>
          </Group>

          {data !== null && data.videos.length > 0 ? (
            <Group label="Videos">
              {data.videos.map((video) => {
                const count = waiting.filter((w) => w.sourceId === video.source.id).length
                return (
                  <Link key={video.source.id} to="/videos/$sourceId" params={{ sourceId: video.source.id }} {...nav}>
                    <Film />
                    <span className="truncate">{video.source.title ?? "Untitled video"}</span>
                    {count > 0 ? <Count className="ml-auto">{count}</Count> : null}
                  </Link>
                )
              })}
            </Group>
          ) : null}

          {data !== null && data.sets.length > 0 ? (
            <Group label="Video sets">
              {data.sets.map((set) => (
                <Link key={set.id} to="/sets/$setId" params={{ setId: set.id }} {...nav}>
                  <Layers />
                  <span className="truncate">{set.title}</span>
                  <span className="ml-auto text-xs text-fg-3">{set.sourceIds.length}</span>
                </Link>
              ))}
            </Group>
          ) : null}

          {data !== null && data.shorts.length > 0 ? (
            <Group label="Shorts">
              {data.shorts.slice(0, RECENT_SHORTS).map((short) => (
                <Link key={short.project.id} to="/shorts/$projectId" params={{ projectId: short.project.id }} {...nav}>
                  {short.thumb === null
                    ? <span className="h-5 w-3.5 shrink-0 rounded-[3px] bg-ctl-active" />
                    : <img src={short.thumb} alt="" className="h-5 w-3.5 shrink-0 rounded-[3px] object-cover" />}
                  <span className="truncate">{short.project.title}</span>
                  <Dot tone={short.status.tone} className="ml-auto" />
                </Link>
              ))}
            </Group>
          ) : null}

          <Group label="Library">
            <Link to="/library/styles" {...nav}><Palette />Styles</Link>
            <Link to="/library/music" {...nav}><Music />Music</Link>
            <Link to="/library/voices" {...nav}><Mic />Voices</Link>
            <Link to="/settings" {...nav}><Settings />Settings</Link>
          </Group>
          </>
        )}

      <div className="mt-auto grid gap-1.5 p-2">
        <Segmented
          label="How much detail to show"
          full
          value={mode}
          onChange={setMode}
          options={[{ value: "simple", label: "Simple" }, { value: "detailed", label: "Detailed" }]}
        />
        <div className="flex h-10 items-center gap-2 px-2 text-fg-1">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-chip text-[10px] font-semibold text-fg shadow-chip">
            {initials(displayName)}
          </span>
          <span className="truncate">{displayName}</span>
          <Tooltip content={connected ? "Connected to the Viral server" : "Can't reach the Viral server"}>
            <span className={cn("ml-auto size-[7px] rounded-full", connected ? "bg-ok-dot" : "bg-wait-dot")} />
          </Tooltip>
        </div>
      </div>
    </nav>
  )
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
