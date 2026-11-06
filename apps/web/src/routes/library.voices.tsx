import { createFileRoute } from "@tanstack/react-router"
import { VoicesPage } from "../modules/library/voices/voices-page.tsx"

export const Route = createFileRoute("/library/voices")({ component: VoicesPage })
