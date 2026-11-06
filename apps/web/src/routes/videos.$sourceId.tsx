import { createFileRoute } from "@tanstack/react-router"
import { ComingSoon } from "../modules/system/coming-soon.tsx"

export const Route = createFileRoute("/videos/$sourceId")({
  component: () => <ComingSoon title="Video" description="The video’s progress, its story, and the three shorts it could make." milestone="M2" />
})
