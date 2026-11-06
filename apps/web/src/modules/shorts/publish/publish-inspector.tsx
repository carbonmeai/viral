import type { PublishedShort, Source, StageRun } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { FileText, FolderOpen, Image, Type, Video } from "lucide-react"
import type { ReactNode } from "react"
import { desktop } from "../../../config/server-url.ts"
import { InspectorBlock } from "../editor-frame.tsx"
import { type InspectorTab, InspectorTabs } from "../inspector-tabs.tsx"
import { StepDetails } from "../step-details.tsx"
import { TITLE_CHARS, titleChoices } from "./publish-values.ts"

export type PublishTab = "post" | "files"
const TABS: ReadonlyArray<InspectorTab<PublishTab>> = [
  { id: "post", label: "Post text", icon: Type },
  { id: "files", label: "Files", icon: FolderOpen }
]

export interface PublishedFiles {
  readonly video: string | null
  readonly captions: string | null
  readonly notes: string | null
  readonly thumbnail: string | null
  // the renders folder on this Mac, for Show in Finder
  readonly folder: string
}

function FileRow({ icon: Icon, name, ext, url }: { readonly icon: typeof Video; readonly name: string; readonly ext: string; readonly url: string | null }) {
  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-ctl bg-item px-2.5 text-sm">
      <Icon className="size-4 shrink-0 text-fg-2" />
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 text-xs text-fg-3">{ext}</span>
      {url === null
        ? <span className="ml-auto text-xs text-fg-3">not yet</span>
        : <a className="ml-auto text-xs text-fg-2 hover:text-fg" href={url} target="_blank" rel="noreferrer">Open</a>}
    </div>
  )
}

// The publish step's inspector: the title to post with (the agent's pick or an alternate; the count shows when
// a phone would cut it off), the description, hashtags and credit, a reminder when the footage's rights aren't
// confirmed, and the files.
export function PublishInspector({ metadata, slug, source, files, chosen, onChoose, stages, tab, onTab }: {
  readonly metadata: PublishedShort
  readonly slug: string
  readonly source: Source
  readonly files: PublishedFiles
  readonly chosen: string
  readonly onChoose: (title: string) => void
  readonly stages: ReadonlyArray<StageRun>
  readonly tab: PublishTab
  readonly onTab: (tab: PublishTab) => void
}) {
  const choices = titleChoices(metadata)
  const unconfirmed = source.rights === "unconfirmed"
  let body: ReactNode
  if (tab === "post") {
    body = (
      <>
        <InspectorBlock title="Title">
          <div role="radiogroup" aria-label="Title" className="grid gap-1 rounded-ctl bg-ctl p-1">
            {choices.map((c) => (
              <button
                key={c.text}
                type="button"
                role="radio"
                aria-checked={c.text === chosen}
                onClick={() => onChoose(c.text)}
                className={cn(
                  "flex min-h-8 items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-sm outline-none hover:bg-item-hover",
                  c.text === chosen && "bg-item shadow-[inset_0_0_0_1px_var(--lemon)]"
                )}
              >
                <span className="min-w-0 flex-1">{c.text}</span>
                <span className={cn("shrink-0 text-xs tabular-nums", c.tooLong ? "text-danger" : "text-fg-3")}>{c.chars}/{TITLE_CHARS}</span>
              </button>
            ))}
          </div>
        </InspectorBlock>
        <InspectorBlock title="Description">
          <p className="m-0 rounded-ctl bg-ctl px-2.5 py-2 text-sm whitespace-pre-wrap">{metadata.description}</p>
        </InspectorBlock>
        <InspectorBlock title="Hashtags">
          <div className="flex flex-wrap gap-1.5">
            {metadata.hashtags.map((h) => <span key={h} className="inline-flex h-6 items-center rounded-chip bg-ctl px-2 text-xs">{h}</span>)}
          </div>
        </InspectorBlock>
        <InspectorBlock title="Credit">
          <span className="text-sm">
            {metadata.credit !== null
              ? `Credit: ${metadata.credit}`
              : source.rights === "owned"
              ? <span className="text-fg-2">None: the footage is yours.</span>
              : <span className="text-fg-2">None: the video had no channel to credit. Add it on the video's page, then publish again.</span>}
          </span>
        </InspectorBlock>
        {unconfirmed ? (
          <span className="text-xs text-wait">
            You haven't confirmed you own or have permission to use this footage. Set it on the video's page before you post.
          </span>
        ) : null}
        <StepDetails stages={stages} names={["metadata"]} />
      </>
    )
  } else {
    body = (
      <InspectorBlock
        title="Files"
        action={desktop === undefined ? undefined : (
          <Button variant="ghost" onClick={() => void desktop?.showInFinder(files.folder)}><FolderOpen />Show in Finder</Button>
        )}
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
          <FileRow icon={Video} name="Video" ext=".mp4" url={files.video} />
          <FileRow icon={FileText} name="Captions" ext=".srt" url={files.captions} />
          <FileRow icon={FileText} name="Post text" ext=".md" url={files.notes} />
          <FileRow icon={Image} name="Thumbnail" ext=".jpg" url={files.thumbnail} />
        </div>
        <span className="text-xs break-words text-fg-2">
          {files.thumbnail === null ? "The thumbnail joins them once you approve it." : "Everything you need to post, side by side"}, named {slug}, in {files.folder}.
        </span>
      </InspectorBlock>
    )
  }
  return (
    <>
      <InspectorTabs tabs={TABS} open={tab} onOpen={onTab} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-auto p-4">{body}</div>
    </>
  )
}
