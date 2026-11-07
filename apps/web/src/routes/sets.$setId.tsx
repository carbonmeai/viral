import { createFileRoute } from "@tanstack/react-router"
import { SourceSetId } from "@viral/contracts"
import { SetPage, type SetTab } from "../modules/sets/set-page.tsx"

const TABS: ReadonlyArray<SetTab> = ["videos", "proposals"]

// ?tab=videos|proposals opens that tab; without it, the page picks (the videos while they're read, then the
// proposals).
export const Route = createFileRoute("/sets/$setId")({
  validateSearch: (search: Record<string, unknown>): { readonly tab?: SetTab } => {
    const tab = TABS.find((t) => t === search["tab"])
    return tab === undefined ? {} : { tab }
  },
  component: SetRoute
})

function SetRoute() {
  const { setId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <SetPage setId={SourceSetId.make(setId)} tab={tab} onTab={(next) => navigate({ search: { tab: next }, replace: true })} />
}
