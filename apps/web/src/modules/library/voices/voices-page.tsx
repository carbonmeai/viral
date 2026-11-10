import { useAtomValue } from "@effect/atom-react"
import type { Preset } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { Sheet } from "@viral/ui/primitives/sheet"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ChevronRight, Plus, X } from "lucide-react"
import { useState } from "react"
import { Page } from "../../layout/page.tsx"
import { presetsAtom } from "../library-api.ts"
import { ExploreTab } from "./explore-tab.tsx"
import { MyVoicesTab } from "./my-voices-tab.tsx"
import { VoiceGenerator } from "../../shorts/generator/voice-generator.tsx"

type Tab = "explore" | "mine"
const TABS: ReadonlyArray<{ readonly value: Tab; readonly label: string }> = [
  { value: "explore", label: "Explore" },
  { value: "mine", label: "My voices" }
]

// Library › Voices, laid out like ElevenLabs' Voices page: Explore their shared library (sample free, + to add),
// or My voices, the ones on your account and the styles narrating with each.
export function VoicesPage() {
  const presets = useAtomValue(presetsAtom)
  const styles = Option.getOrElse(AsyncResult.value(presets), (): ReadonlyArray<Preset> => [])
  const [tab, setTab] = useState<Tab>("explore")
  // the voice generator, in a sheet over the page (the page itself is unchanged)
  const [creating, setCreating] = useState(false)
  return (
    <Page
      title="Voices"
      actions={<Button variant="primary" size="md" onClick={() => setCreating(true)}><Plus />Create Voice</Button>}
    >
      <div role="tablist" aria-label="Voices" className="-mt-2 mb-5 flex gap-5 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "-mb-px cursor-pointer border-b-2 pb-2.5 text-[14px] font-medium outline-none",
              tab === t.value ? "border-fg text-fg" : "border-transparent text-fg-2 hover:text-fg"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "explore" ? <ExploreTab styles={styles} /> : <MyVoicesTab styles={styles} onCreate={() => setCreating(true)} onExplore={() => setTab("explore")} />}
      </div>
      <Sheet open={creating} onOpenChange={setCreating} title="Create a voice">
        <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-3.5">
          <span className="text-fg-2">Voices</span><ChevronRight className="size-3 text-fg-3" />
          <b className="font-semibold">Create a voice</b>
          <IconButton className="ml-auto" label="Close" onClick={() => setCreating(false)}><X /></IconButton>
        </div>
        <VoiceGenerator projectId={null} narration={[]} onSaved={{ label: "See My voices", onClick: () => (setCreating(false), setTab("mine")) }} />
      </Sheet>
    </Page>
  )
}
