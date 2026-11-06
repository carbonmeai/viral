import { createFileRoute } from "@tanstack/react-router"
import { AgentsPage } from "../modules/settings/agents/agents-page.tsx"

export const Route = createFileRoute("/settings/agents")({ component: AgentsPage })
