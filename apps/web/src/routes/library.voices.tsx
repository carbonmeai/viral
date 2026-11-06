import { createFileRoute } from "@tanstack/react-router"
import { ComingSoon } from "../modules/system/coming-soon.tsx"

export const Route = createFileRoute("/library/voices")({
  component: () => <ComingSoon title="Voices" description="The ElevenLabs voices you narrate with." milestone="M6" />
})
