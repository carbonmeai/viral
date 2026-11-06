import { createFileRoute } from "@tanstack/react-router"
import { VoicePage } from "../modules/settings/voice/voice-page.tsx"

export const Route = createFileRoute("/settings/voice")({ component: VoicePage })
