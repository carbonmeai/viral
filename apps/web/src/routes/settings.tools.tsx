import { createFileRoute } from "@tanstack/react-router"
import { ToolsPage } from "../modules/settings/tools/tools-page.tsx"

export const Route = createFileRoute("/settings/tools")({ component: ToolsPage })
