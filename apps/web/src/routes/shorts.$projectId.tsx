import { createFileRoute } from "@tanstack/react-router"
import { ComingSoon } from "../modules/system/coming-soon.tsx"

// ?step=script|voice|shots|render|publish opens the editor at that step.
export const Route = createFileRoute("/shorts/$projectId")({
  validateSearch: (search: Record<string, unknown>): { readonly step?: string } =>
    typeof search["step"] === "string" ? { step: search["step"] } : {},
  component: () => <ComingSoon title="Short" description="The editor: script, voice, shots, render and publish in one frame." milestone="M3" />
})
