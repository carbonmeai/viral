import { Link } from "@tanstack/react-router"
import { Input } from "@viral/ui/primitives/input"
import { ArrowLeft, Box, Cpu, Gauge, HardDrive, KeyRound, Languages, Mic, Settings2 } from "lucide-react"
import { useState } from "react"
import { filterSections, type SettingsSectionId } from "./sections.ts"

const ICONS: Record<SettingsSectionId, typeof Settings2> = {
  general: Settings2,
  accounts: KeyRound,
  agents: Cpu,
  voice: Mic,
  transcription: Languages,
  tools: Box,
  storage: HardDrive,
  usage: Gauge
}

export interface SettingsNavProps {
  // the page to go back to: the last one you were on outside Settings
  readonly backTo: string
  readonly navClass: string
  readonly activeClass: string
}

// The sidebar while you're in Settings: back to the app, a search, and the sections in their groups.
export function SettingsNav({ backTo, navClass, activeClass }: SettingsNavProps) {
  const [query, setQuery] = useState("")
  const groups = filterSections(query)
  return (
    <>
      <div className="flex flex-col gap-1.5 px-2 pt-1 pb-1.5">
        <Link to={backTo} className={`${navClass} font-semibold text-fg`}>
          <ArrowLeft />
          Settings
        </Link>
        <Input aria-label="Search settings" placeholder="Search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      </div>
      {groups.length === 0 ? <div className="px-4 py-2 text-xs text-fg-2">No settings match.</div> : null}
      {groups.map(({ group, sections }) => (
        <div key={group} className="flex flex-col gap-px px-2 py-1 [&+&]:mt-2.5">
          <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-fg-2">{group}</div>
          {sections.map((section) => {
            const Icon = ICONS[section.id]
            return (
              <Link key={section.id} to={`/settings/${section.id}`} className={navClass} activeProps={{ className: activeClass }}>
                <Icon />
                {section.label}
              </Link>
            )
          })}
        </div>
      ))}
    </>
  )
}
