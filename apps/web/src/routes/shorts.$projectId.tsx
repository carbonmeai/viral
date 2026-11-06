import { createFileRoute } from "@tanstack/react-router"
import { ProjectId } from "@viral/contracts"
import type { EditorStepId } from "../modules/shorts/editor-values.ts"
import { ShortPage } from "../modules/shorts/short-page.tsx"

const STEPS: ReadonlyArray<EditorStepId> = ["script", "sections", "voice", "shots", "render", "publish"]

// ?step=script|voice|shots|render|publish opens the editor at that step; without it, where you're needed.
export const Route = createFileRoute("/shorts/$projectId")({
  validateSearch: (search: Record<string, unknown>): { readonly step?: EditorStepId } => {
    const step = search["step"]
    return typeof step === "string" && (STEPS as ReadonlyArray<string>).includes(step) ? { step: step as EditorStepId } : {}
  },
  component: ShortRoute
})

function ShortRoute() {
  const { projectId } = Route.useParams()
  const { step } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <ShortPage projectId={ProjectId.make(projectId)} step={step} onStep={(next) => void navigate({ search: { step: next } })} />
}
