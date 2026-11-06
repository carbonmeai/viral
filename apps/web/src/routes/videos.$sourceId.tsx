import { createFileRoute } from "@tanstack/react-router"
import { SourceId } from "@viral/contracts"
import { type VideoTab, VideoPage } from "../modules/videos/video-page.tsx"

const TABS: ReadonlyArray<VideoTab> = ["progress", "proposals", "story", "transcript", "frames"]

// ?tab=progress|proposals|story|transcript|frames opens that tab; without it, the page picks (the run's progress
// while it reads the video, then the proposals).
export const Route = createFileRoute("/videos/$sourceId")({
  validateSearch: (search: Record<string, unknown>): { readonly tab?: VideoTab } => {
    const tab = TABS.find((t) => t === search["tab"])
    return tab === undefined ? {} : { tab }
  },
  component: VideoRoute
})

function VideoRoute() {
  const { sourceId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <VideoPage sourceId={SourceId.make(sourceId)} tab={tab} onTab={(next) => navigate({ search: { tab: next }, replace: true })} />
}
