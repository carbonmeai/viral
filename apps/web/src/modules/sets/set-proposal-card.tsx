import type { SetProposal, VideoSetShort } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Status } from "@viral/ui/primitives/status"
import { Sparkles } from "lucide-react"
import type { StatusView } from "../home/home-values.ts"
import { useDetailed } from "../system/detail.tsx"
import { SCORE_AXES } from "../videos/video-values.ts"
import { proposalVideos } from "./set-values.ts"
import { VideoBadge } from "./video-badge.tsx"

// One short across the set's videos: a still, which videos it uses (V badges in their colours, with titles), the
// approach, the hook, the title, the four scores and why it works, then make it (or open the one already made).
export function SetProposalCard({ proposal, index, titles, still, made, busy, onMake, onOpen }: {
  readonly proposal: SetProposal
  readonly index: number
  // each set video's title, by position
  readonly titles: ReadonlyArray<string>
  readonly still: string | null
  readonly made: { readonly short: VideoSetShort; readonly status: StatusView | null } | null
  readonly busy: boolean
  readonly onMake: () => void
  readonly onOpen: () => void
}) {
  const detailed = useDetailed()
  const videos = proposalVideos(proposal.sources)
  return (
    <article className="flex min-w-0 flex-col rounded-panel bg-panel p-1.5">
      <div className="flex flex-1 flex-col gap-2.5 rounded-[10px] bg-item p-3">
        {still === null
          ? <div className="aspect-video rounded-ctl bg-ctl-active" />
          : <img src={still} alt="" className="aspect-video w-full rounded-ctl bg-ctl-active object-cover" loading="lazy" />}
        <div className="grid gap-1">
          {videos.map((i) => (
            <div key={i} className="flex min-w-0 items-center gap-2 text-xs">
              <VideoBadge index={i} />
              <span className="truncate text-fg-1">{titles[i] ?? "Untitled video"}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-fg-2">#{index + 1} · {proposal.approach}</div>
        <div className="text-[17px] leading-snug font-semibold">“{proposal.hook}”</div>
        <div className="font-medium">{proposal.title}</div>
        <div className="grid gap-1.5">
          {SCORE_AXES.map(({ key, label }) => (
            <div key={key} className="grid grid-cols-[110px_minmax(0,1fr)_16px] items-center gap-2 text-xs text-fg-2">
              <span>{label}</span>
              <span className="h-1 overflow-hidden rounded-full bg-ctl">
                <span className="block h-full rounded-full bg-lemon" style={{ width: `${proposal.scores[key] * 10}%` }} />
              </span>
              <span className="text-right text-fg">{proposal.scores[key]}</span>
            </div>
          ))}
        </div>
        {detailed ? <p className="m-0 line-clamp-4 text-xs leading-relaxed text-fg-2">{proposal.why}</p> : null}
      </div>
      <div className="flex min-h-10 items-center gap-2 px-1.5 pt-1.5">
        {made === null ? (
          <Button variant={index === 0 ? "primary" : "default"} disabled={busy} onClick={onMake}><Sparkles />{busy ? "Making…" : "Make this short"}</Button>
        ) : (
          <>
            <Button onClick={onOpen}>Open short</Button>
            {made.status === null ? null : <Status tone={made.status.tone}>{made.status.label}</Status>}
          </>
        )}
      </div>
    </article>
  )
}
