import { createFileRoute } from "@tanstack/react-router"
import { type NewKind, NewSourcePage } from "../modules/videos/new-source-page.tsx"

// ?kind=several opens the "Several videos" tab.
export const Route = createFileRoute("/videos/new")({
  validateSearch: (search: Record<string, unknown>): { readonly kind?: NewKind } => search["kind"] === "several" ? { kind: "several" } : {},
  component: NewRoute
})

function NewRoute() {
  const { kind } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <NewSourcePage kind={kind ?? "one"} onKind={(next) => navigate({ search: next === "several" ? { kind: next } : {}, replace: true })} />
}
