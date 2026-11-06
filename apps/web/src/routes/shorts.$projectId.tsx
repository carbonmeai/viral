import { createFileRoute } from "@tanstack/react-router"
import { ProjectId } from "@viral/contracts"
import { ShortPage } from "../modules/shorts/short-page.tsx"

// ?step=script|voice|shots|render|publish opens the editor at that step (milestone 3).
export const Route = createFileRoute("/shorts/$projectId")({
  validateSearch: (search: Record<string, unknown>): { readonly step?: string } =>
    typeof search["step"] === "string" ? { step: search["step"] } : {},
  component: ShortRoute
})

function ShortRoute() {
  const { projectId } = Route.useParams()
  return <ShortPage projectId={ProjectId.make(projectId)} />
}
