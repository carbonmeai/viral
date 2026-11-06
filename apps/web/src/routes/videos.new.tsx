import { createFileRoute } from "@tanstack/react-router"
import { ComingSoon } from "../modules/system/coming-soon.tsx"

export const Route = createFileRoute("/videos/new")({
  component: () => <ComingSoon title="New source" description="Paste a link or drop a file, and say whether the footage is yours." milestone="M2" />
})
