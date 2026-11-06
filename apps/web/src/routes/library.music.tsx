import { createFileRoute } from "@tanstack/react-router"
import { ComingSoon } from "../modules/system/coming-soon.tsx"

export const Route = createFileRoute("/library/music")({
  component: () => <ComingSoon title="Music" description="Tracks for your shorts, with their tempo and drop." milestone="M6" />
})
