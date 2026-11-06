import { createFileRoute } from "@tanstack/react-router"
import { ComingSoon } from "../modules/system/coming-soon.tsx"

export const Route = createFileRoute("/library/styles")({
  component: () => <ComingSoon title="Styles" description="How your shorts look: framing, headline, captions and music levels." milestone="M6" />
})
