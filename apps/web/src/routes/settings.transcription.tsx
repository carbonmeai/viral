import { createFileRoute } from "@tanstack/react-router"
import { TranscriptionPage } from "../modules/settings/transcription/transcription-page.tsx"

export const Route = createFileRoute("/settings/transcription")({ component: TranscriptionPage })
