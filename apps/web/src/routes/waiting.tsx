import { createFileRoute } from "@tanstack/react-router"
import { WaitingPage } from "../modules/waiting/waiting-page.tsx"

export const Route = createFileRoute("/waiting")({ component: WaitingPage })
