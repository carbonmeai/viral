import { createFileRoute } from "@tanstack/react-router"
import { MusicPage } from "../modules/library/music/music-page.tsx"

export const Route = createFileRoute("/library/music")({ component: MusicPage })
