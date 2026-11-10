import { createFileRoute } from "@tanstack/react-router"
import { HomePage } from "../modules/home/home-page.tsx"
import { validateHomeSearch } from "../modules/home/home-search.ts"

// ?status=waiting is "Waiting for you" (the recents filtered); ?start=<card> opens the box on a format card.
export const Route = createFileRoute("/")({ validateSearch: validateHomeSearch, component: HomeRoute })

function HomeRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return <HomePage search={search} onSearch={(next) => navigate({ search: next, replace: true })} />
}
