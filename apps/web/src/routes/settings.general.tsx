import { createFileRoute } from "@tanstack/react-router"
import { GeneralPage } from "../modules/settings/general/general-page.tsx"

export const Route = createFileRoute("/settings/general")({ component: GeneralPage })
