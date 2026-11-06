import { createFileRoute } from "@tanstack/react-router"
import { NewSourcePage } from "../modules/videos/new-source-page.tsx"

export const Route = createFileRoute("/videos/new")({ component: NewSourcePage })
