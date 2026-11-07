// The sections of Settings, in the order the sidebar lists them. `keywords` widen what the search box finds.
export const SETTINGS_SECTIONS = [
  { id: "general", label: "General", group: "Personal", keywords: "appearance theme dark light simple detailed name" },
  { id: "accounts", label: "Accounts", group: "Personal", keywords: "claude elevenlabs xai grok api key keychain" },
  { id: "agents", label: "Agents", group: "Personal", keywords: "model opus sonnet haiku story script shots ads metadata" },
  { id: "transcription", label: "Transcription", group: "Personal", keywords: "grok whisper transcript provider" },
  { id: "tools", label: "Tools", group: "App", keywords: "ffmpeg ffprobe uv yt-dlp version" },
  { id: "storage", label: "Storage", group: "App", keywords: "library folder finder disk space" },
  { id: "usage", label: "Usage", group: "App", keywords: "cost spend money characters tokens" }
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]

export const sectionLabel = (id: SettingsSectionId) => SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? id

// The sections a search matches, by label or keyword, grouped as the sidebar shows them.
export const filterSections = (query: string) => {
  const q = query.trim().toLowerCase()
  const hits = q === "" ? SETTINGS_SECTIONS : SETTINGS_SECTIONS.filter((s) => `${s.label} ${s.keywords}`.toLowerCase().includes(q))
  const groups: Array<{ readonly group: string; readonly sections: Array<(typeof SETTINGS_SECTIONS)[number]> }> = []
  for (const section of hits) {
    const group = groups.find((g) => g.group === section.group)
    if (group) group.sections.push(section)
    else groups.push({ group: section.group, sections: [section] })
  }
  return groups
}
