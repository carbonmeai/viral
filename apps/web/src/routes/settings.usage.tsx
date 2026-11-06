import { createFileRoute } from "@tanstack/react-router"
import { UsagePage } from "../modules/settings/usage/usage-page.tsx"

export const Route = createFileRoute("/settings/usage")({ component: UsagePage })
