import { createFileRoute } from "@tanstack/react-router"
import { type NewKind, NewSourcePage } from "../modules/videos/new-source-page.tsx"

// ?kind=several opens the "Several videos" tab, ?kind=idea "From an idea".
export const Route = createFileRoute("/videos/new")({
  validateSearch: (search: Record<string, unknown>): { readonly kind?: NewKind } =>
    search["kind"] === "several" || search["kind"] === "idea" ? { kind: search["kind"] } : {},
  component: NewRoute
})

function NewRoute() {
  const { kind } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <NewSourcePage kind={kind ?? "one"} onKind={(next) => navigate({ search: next === "one" ? {} : { kind: next }, replace: true })} />
}
