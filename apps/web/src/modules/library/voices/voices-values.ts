import type { Voice, VoiceUseCase } from "@viral/contracts"

// The use-case chips, in ElevenLabs' order, with our names for them.
export const USE_CASES: ReadonlyArray<{ readonly value: VoiceUseCase; readonly label: string }> = [
  { value: "conversational", label: "Conversational" },
  { value: "narrative_story", label: "Narration" },
  { value: "characters_animation", label: "Characters" },
  { value: "social_media", label: "Social media" },
  { value: "informative_educational", label: "Educational" },
  { value: "advertisement", label: "Advertisement" },
  { value: "entertainment_tv", label: "Entertainment" }
]

export const useCaseLabel = (useCase: string | null) =>
  useCase === null ? null : USE_CASES.find((u) => u.value === useCase)?.label ?? sentence(useCase)

const sentence = (value: string) => {
  const text = value.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// 252800 → "252.8K", 559600 → "559.6K", 10000 → "10K", 1200000 → "1.2M", 87 → "87": one decimal, as ElevenLabs.
export const compactCount = (n: number) => {
  if (n < 1000) return String(n)
  const [value, unit] = n < 1_000_000 ? [n / 1000, "K"] : [n / 1_000_000, "M"]
  return `${Math.round(value * 10) / 10}${unit}`
}

// How long ago it was shared, the way ElevenLabs shows it: "2y", "5mo", "3w", "4d", "today".
export const ageLabel = (createdAtUnix: number | null, nowMs: number) => {
  if (createdAtUnix === null) return null
  const days = Math.floor((nowMs - createdAtUnix * 1000) / 86_400_000)
  if (days >= 365) return `${Math.floor(days / 365)}y`
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  if (days >= 7) return `${Math.floor(days / 7)}w`
  return days >= 1 ? `${days}d` : "today"
}

// "en" → "English"; unknown codes come back as they are.
export const languageName = (code: string | null) => {
  if (code === null) return null
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

// The flag for a locale's country ("en-US" → 🇺🇸); null when there's no country to show.
export const flagOf = (locale: string | null) => {
  const country = locale?.split("-")[1]?.toUpperCase()
  if (country === undefined || !/^[A-Z]{2}$/.test(country)) return null
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// "Marvin - Audiobooks" → { name: "Marvin", traits: "Audiobooks" }.
export const splitName = (full: string) => {
  const [name, ...rest] = full.split(" - ")
  return { name: name ?? full, traits: rest.length === 0 ? null : rest.join(" - ") }
}

export const initials = (full: string) =>
  splitName(full).name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")

// Languages the Language filter offers, most used first.
export const LANGUAGES: ReadonlyArray<string> = ["en", "es", "pt", "fr", "de", "it", "hi", "ar", "ja", "ko", "zh", "nl", "pl", "ru", "tr", "id"]

// ElevenLabs' voice labels, in the order a person reads them: who it sounds like, then what it's for.
const LABEL_ORDER: ReadonlyArray<string> = ["age", "accent", "language", "descriptive", "description", "use_case", "use case", "gender"]
const CATEGORIES: Readonly<Record<string, string>> = {
  premade: "ElevenLabs default",
  cloned: "Your clone",
  generated: "Designed",
  professional: "Professional clone",
  famous: "Famous"
}

// One label as a person would say it: "middle_aged" → "Middle-aged", "en" → "English", "social_media" → "Social media".
export const labelText = (key: string, value: string) => {
  if (key === "age") return value === "middle_aged" || value === "middle aged" ? "Middle-aged" : sentence(value)
  if (key === "language") return languageName(value) ?? value
  if (key === "use_case" || key === "use case") return useCaseLabel(value) ?? value
  return sentence(value).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
}

// "Middle-aged · American · English · Conversational · Male": a voice's labels in words, else its kind
// ("Professional clone"); "" when ElevenLabs says nothing about it.
export const voiceTraits = (voice: Pick<Voice, "labels" | "category">) => {
  const keys = Object.keys(voice.labels).sort((a, b) => rank(a) - rank(b))
  const words = keys.map((k) => labelText(k, voice.labels[k] ?? "")).filter((w) => w !== "")
  const unique = words.filter((w, i) => words.findIndex((o) => o.toLowerCase() === w.toLowerCase()) === i)
  if (unique.length > 0) return unique.join(" · ")
  return voice.category === null ? "" : CATEGORIES[voice.category] ?? sentence(voice.category)
}

const rank = (key: string) => {
  const i = LABEL_ORDER.indexOf(key)
  return i === -1 ? LABEL_ORDER.length : i
}

// The line under a voice's name: the traits its name carries ("Adam - Dominant, Firm"), then its labels in words.
// A name that describes the voice already says what ElevenLabs' one-word "descriptive" label would.
export const voiceLine = (voice: Pick<Voice, "name" | "labels" | "category">) => {
  const traits = splitName(voice.name).traits
  const labels = traits === null ? voice.labels : Object.fromEntries(Object.entries(voice.labels).filter(([k]) => k !== "descriptive" && k !== "description"))
  return [traits, voiceTraits({ ...voice, labels })].filter((part) => part !== null && part !== "").join(" · ")
}

// The voice picker's list: the current voice first, then the rest as they came, narrowed by a search that
// matches the name and the words in its description.
export const pickerVoices = <V extends Pick<Voice, "voiceId" | "name" | "labels" | "category">>(voices: ReadonlyArray<V>, currentId: string, query: string) => {
  const q = query.trim().toLowerCase()
  const hits = q === "" ? voices : voices.filter((v) => `${v.name} ${voiceTraits(v)}`.toLowerCase().includes(q))
  return [...hits.filter((v) => v.voiceId === currentId), ...hits.filter((v) => v.voiceId !== currentId)]
}
