import { useAtomValue } from "@effect/atom-react"
import type { Preset } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Button } from "@viral/ui/primitives/button"
import { Tooltip } from "@viral/ui/primitives/tooltip"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Plus } from "lucide-react"
import { useState } from "react"
import { Page } from "../../layout/page.tsx"
import { presetsAtom } from "../library-api.ts"
import { ExploreTab } from "./explore-tab.tsx"
import { MyVoicesTab } from "./my-voices-tab.tsx"

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
  return (
    <Page
      title="Voices"
      actions={
        <Tooltip content="Design a voice (soon)">
          <span tabIndex={0}><Button variant="primary" size="md" disabled><Plus />Create Voice</Button></span>
        </Tooltip>
      }
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
        {tab === "explore" ? <ExploreTab styles={styles} /> : <MyVoicesTab styles={styles} />}
      </div>
    </Page>
  )
}
