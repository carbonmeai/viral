import { useAtomSet } from "@effect/atom-react"
import {
  DEFAULT_RESEARCH_VIDEOS,
  looksLikeRanking,
  RESEARCH_VIDEO_COUNTS,
  type ResearchLength,
  type ResearchVideoCount,
  type SourceId,
  type SourceRights
} from "@viral/contracts"
import { useNavigate } from "@tanstack/react-router"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Tooltip } from "@viral/ui/primitives/tooltip"
import { ArrowUp, FileVideo, Link2, Plus, Sparkles, Upload, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { desktop } from "../../config/server-url.ts"
import { startResearch } from "../research/research-api.ts"
import { defaultLength, estimateLine, IDEA_EXAMPLES, LENGTH_CHOICES } from "../research/research-values.ts"
import { createVideoSet, startSetRun } from "../sets/sets-api.ts"
import { useDetailed } from "../system/detail.tsx"
import { createSource, startSourceRun } from "../videos/videos-api.ts"
import { RIGHTS_CHOICES } from "../videos/video-values.ts"
import { FormatCards } from "./format-cards.tsx"
import { LinkCards, useLinkLookups } from "./link-cards.tsx"
import { rememberMadeAs } from "./made-as.ts"
import {
  briefOf,
  DEFAULT_PLACEHOLDER,
  FORMAT_CARDS,
  type FormatHint,
  formatOfHint,
  madeAs,
  promptChip,
  promptProblem,
  readPrompt,
  RIGHTS_SHORT,
  startOf,
  type VideoInput,
  videosOf
} from "./prompt-values.ts"

const VIDEO_FILE = /\.(mp4|mov|m4v|webm|mkv|avi)$/i
const BRIEF_PLACEHOLDER = "What should these shorts achieve? e.g. Compare who actually got the candy right"

// One line of what the box understood: a muted label on the left, the rest beside it.
function Line({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-sm text-fg-1">
      <span className="w-[92px] shrink-0 text-fg-2">{label}</span>
      {children}
    </div>
  )
}

const CHIP_ICONS = { idea: Sparkles, link: Link2, file: FileVideo } as const

// "What would you like to create?": one box that takes an idea, one or several links, or a dropped file and says
// which it understood (the chip in its footer). Send finds videos for an idea (StartResearch), reads one video
// (CreateSource + StartSourceRun) or makes a set from several (CreateSource × n + CreateVideoSet + StartSetRun),
// then opens what it started. The try-chips and the format cards sit under it.
export function PromptBox({ start, art }: {
  // a format card to open on (from ?start=)
  readonly start: FormatHint | undefined
  // a picture for each format card, from your own shorts
  readonly art: Partial<Record<FormatHint, ReadonlyArray<string>>>
}) {
  const navigate = useNavigate()
  const detailed = useDetailed()
  const research = useAtomSet(startResearch, { mode: "promise" })
  const create = useAtomSet(createSource, { mode: "promise" })
  const startRun = useAtomSet(startSourceRun, { mode: "promise" })
  const createSet = useAtomSet(createVideoSet, { mode: "promise" })
  const startSet = useAtomSet(startSetRun, { mode: "promise" })
  const box = useRef<HTMLTextAreaElement>(null)

  const [text, setText] = useState("")
  const [files, setFiles] = useState<ReadonlyArray<string>>([])
  const [hint, setHint] = useState<FormatHint | null>(start ?? null)
  const [videos, setVideos] = useState<ResearchVideoCount>(DEFAULT_RESEARCH_VIDEOS)
  // null until you choose: follows the idea (and a ranking card) like the old form
  const [chosenLength, setLength] = useState<ResearchLength | null>(null)
  const [rights, setRights] = useState<SourceRights>("unconfirmed")
  const [brief, setBrief] = useState("")
  const [drag, setDrag] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (start === undefined) return
    setHint(start)
    box.current?.focus()
  }, [start])

  const prompt = readPrompt(text, files)
  const inputs = videosOf(prompt)
  const lookups = useLinkLookups(inputs.flatMap((v) => v._tag === "Url" ? [v.url] : []))
  const kind = startOf(prompt)
  const fullBrief = (briefOf(prompt) || brief).trim()
  const problem = kind === "set" || inputs.length > 1 ? promptProblem(prompt, fullBrief) : null
  const ranking = hint === "ranking" || (prompt._tag === "Idea" && looksLikeRanking(prompt.text))
  const length = chosenLength ?? (hint === "ranking" ? "180" : defaultLength(prompt._tag === "Idea" ? prompt.text : ""))
  const ready = kind !== "none" && problem === null && !starting
  const chip = promptChip(prompt)
  const ChipIcon = chip.icon === null ? null : CHIP_ICONS[chip.icon]
  const placeholder = FORMAT_CARDS.find((c) => c.id === hint)?.placeholder ?? DEFAULT_PLACEHOLDER

  const clear = () => {
    setText("")
    setFiles([])
    setBrief("")
    setNote(null)
    setError(null)
    box.current?.focus()
  }
  const addFiles = (paths: ReadonlyArray<string>) => {
    if (paths.length === 0) return
    setFiles((all) => [...new Set([...all, ...paths])])
    setNote(null)
  }
  const remove = (video: VideoInput) => {
    if (video._tag === "File") setFiles((all) => all.filter((p) => p !== video.path))
    else setText((t) => t.split(video.url).join("").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim())
  }
  const choose = () => {
    if (desktop === undefined) {
      setNote("In a browser, type the full path of a video file on this computer.")
      box.current?.focus()
      return
    }
    void desktop.openFiles("video").then(addFiles)
  }
  const pasteLink = () => {
    void navigator.clipboard?.readText().then(
      (copied) => {
        if (/https?:\/\//.test(copied)) setText((t) => (t.trim() === "" ? copied.trim() : `${t.trim()}\n${copied.trim()}`))
        else setNote("Copy a video's link first, then paste it here.")
        box.current?.focus()
      },
      () => {
        setNote("Paste a video's link into the box.")
        box.current?.focus()
      }
    )
  }
  const pickCard = (id: FormatHint) => {
    setHint((h) => h === id ? null : id)
    setLength(null)
    box.current?.focus()
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const dropped = [...e.dataTransfer.files]
    if (dropped.length === 0) {
      const link = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")
      if (link.trim() !== "") setText((t) => (t.trim() === "" ? link.trim() : `${t.trim()}\n${link.trim()}`))
      return
    }
    const videosDropped = dropped.filter((f) => f.type.startsWith("video/") || VIDEO_FILE.test(f.name))
    if (videosDropped.length === 0) return setNote("That isn't a video file.")
    const paths = desktop === undefined ? [] : videosDropped.map((f) => desktop!.pathForFile(f)).filter((p) => p !== "")
    if (paths.length === 0) return setNote("Dropping a file works in the Viral app. In a browser, type its full path.")
    addFiles(paths)
  }

  const send = async () => {
    if (!ready) return
    setStarting(true)
    setError(null)
    try {
      if (prompt._tag === "Idea") {
        const set = await research({ payload: { idea: prompt.text, videos, length } })
        rememberMadeAs(set.id, formatOfHint(hint) ?? (ranking ? "ranking" : null))
        await navigate({ to: "/sets/$setId", params: { setId: set.id } })
        return
      }
      const origins = inputs.map((v) => v._tag === "Url" ? { _tag: "Url" as const, url: v.url } : { _tag: "File" as const, path: v.path })
      if (origins.length === 1) {
        const source = await create({ payload: { origin: origins[0]!, rights, rightsNote: null } })
        await startRun({ payload: { sourceId: source.id } })
        await navigate({ to: "/videos/$sourceId", params: { sourceId: source.id } })
        return
      }
      const ids: Array<SourceId> = []
      for (const origin of origins) ids.push((await create({ payload: { origin, rights, rightsNote: null } })).id)
      const set = await createSet({ payload: { sourceIds: ids, brief: fullBrief } })
      await startSet({ payload: { setId: set.id } })
      rememberMadeAs(set.id, formatOfHint(hint))
      await navigate({ to: "/sets/$setId", params: { setId: set.id } })
    } catch {
      setError(kind === "find" ? "Couldn't start the search. Is the server running?" : "Couldn't add that. Is the server running?")
    } finally {
      setStarting(false)
    }
  }

  const rightsLine = (
    <Line label="The footage">
      <Segmented
        label="Who owns the footage"
        value={rights}
        onChange={setRights}
        options={RIGHTS_CHOICES.map((c) => ({ value: c.value, label: <Tooltip content={`${c.title}. ${c.sub}`}><span>{RIGHTS_SHORT[c.value]}</span></Tooltip> }))}
      />
      <span className="truncate text-fg-2">who owns it; it goes in the credits</span>
    </Line>
  )

  return (
    <>
      <div
        className={cn(
          "relative rounded-[18px] bg-item px-3.5 pt-3.5 pb-2.5 shadow-[0_0_0_1px_var(--line),0_10px_30px_rgba(0,0,0,.14)]",
          drag && "shadow-[0_0_0_1px_var(--lemon),0_0_0_4px_var(--lemon-soft)]"
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false)
        }}
        onDrop={onDrop}
      >
        <textarea
          ref={box}
          aria-label="What would you like to create?"
          rows={2}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.currentTarget.value)
            setNote(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          className="block max-h-[40vh] min-h-[52px] w-full resize-none border-0 bg-transparent px-1 py-0.5 text-[15px] leading-normal text-fg outline-none [field-sizing:content] placeholder:text-fg-3 focus-visible:shadow-none"
        />

        {prompt._tag === "Empty" && note === null ? null : (
          <div className="mt-2.5 grid gap-2 px-1 pt-2.5 pb-0.5 shadow-[inset_0_1px_0_var(--line)]">
            {prompt._tag === "Idea" ? (
              <>
                <Line label="An idea"><span>Viral searches YouTube and shows you a shortlist. Nothing downloads until you approve it.</span></Line>
                <Line label="How many">
                  <Segmented
                    label="How many videos"
                    value={String(videos)}
                    onChange={(v) => setVideos(Number(v) as ResearchVideoCount)}
                    options={RESEARCH_VIDEO_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
                  />
                  <span className="ml-2.5 shrink-0 text-fg-2">How long</span>
                  <Segmented label="How long a short" value={length} onChange={setLength} options={LENGTH_CHOICES} />
                </Line>
                <Line label="Made as">
                  <span className="shrink-0">{madeAs(hint, ranking, videos)}</span>
                  {detailed ? <span className="truncate text-fg-2">· {ranking ? `${estimateLine(videos, length)} · ` : ""}a minute or two of searching</span> : null}
                </Line>
              </>
            ) : null}

            {inputs.length > 0 ? (
              <>
                <Line label={inputs.length > 1 ? `${inputs.length} ${prompt._tag === "Files" ? "files" : "links"}` : prompt._tag === "File" ? "A file" : "A link"}>
                  <span className="truncate">
                    {inputs.length > 1
                      ? "One set across these videos. Each is read, then Viral suggests shorts that use them together."
                      : prompt._tag === "File"
                      ? "Read from this Mac; it stays where it is."
                      : "Downloads at up to 1080p, then Viral reads it and suggests three shorts."}
                  </span>
                </Line>
                <LinkCards videos={inputs} lookups={lookups} onRemove={remove} />
                {rightsLine}
                {inputs.length > 1 && briefOf(prompt) === "" ? (
                  <Line label="The brief">
                    <Input
                      value={brief}
                      onChange={(e) => setBrief(e.currentTarget.value)}
                      placeholder={BRIEF_PLACEHOLDER}
                      aria-label="What should these shorts achieve?"
                      maxLength={600}
                      className="flex-1"
                    />
                  </Line>
                ) : inputs.length > 1 ? <Line label="The brief"><span className="truncate">{briefOf(prompt)}</span></Line> : null}
              </>
            ) : null}

            {note === null ? null : <Line label=""><span className="text-fg-2">{note}</span></Line>}
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-2">
          <IconButton label="Add a video from this Mac" onClick={choose}><Plus className="!size-4" /></IconButton>
          <span
            className={cn(
              "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-ctl px-2.5 text-xs",
              chip.icon === null ? "bg-ctl text-fg-2" : "bg-lemon-soft font-medium text-lemon-fg"
            )}
          >
            {ChipIcon === null ? null : <ChipIcon className="size-3.5" />}
            {chip.label}
          </span>
          {hint === null ? null : (
            <span className="inline-flex h-[22px] items-center gap-1 rounded-chip bg-ctl pr-1 pl-2 text-xs text-fg-1">
              {FORMAT_CARDS.find((c) => c.id === hint)?.title}
              <button type="button" aria-label="Clear the format" className="grid size-4 cursor-pointer place-items-center rounded-[4px] text-fg-2 hover:text-fg" onClick={() => setHint(null)}>
                <X className="size-3" />
              </button>
            </span>
          )}
          <span className={cn("ml-auto min-w-0 truncate text-xs", error !== null ? "text-danger" : "text-fg-2")}>{error ?? problem ?? ""}</span>
          {prompt._tag === "Empty" && files.length === 0 ? null : <Button variant="ghost" onClick={clear}>Clear</Button>}
          <button
            type="button"
            aria-label={kind === "find" ? "Find videos" : "Start"}
            title={kind === "find" ? "Find videos" : "Start"}
            aria-busy={starting}
            disabled={!ready}
            onClick={() => void send()}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-lemon text-lemon-ink disabled:cursor-default disabled:bg-ctl-active disabled:text-fg-3"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
        <TryChip icon={<Sparkles />} onClick={() => {
          setText(IDEA_EXAMPLES[0]!)
          setFiles([])
          box.current?.focus()
        }}>{IDEA_EXAMPLES[0]}</TryChip>
        <TryChip icon={<Link2 />} onClick={pasteLink}>Paste a link</TryChip>
        <TryChip icon={<Upload />} onClick={choose}>{desktop === undefined ? "Type a file's path" : "Choose a video file"}</TryChip>
      </div>

      <FormatCards picked={hint} art={art} onPick={pickCard} />
    </>
  )
}

function TryChip({ icon, onClick, children }: { readonly icon: ReactNode; readonly onClick: () => void; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-ctl bg-ctl px-2.5 text-xs text-fg-1 hover:bg-ctl-hover hover:text-fg [&_svg]:size-3.5"
    >
      {icon}
      {children}
    </button>
  )
}
