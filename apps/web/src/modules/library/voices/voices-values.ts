import type { VoiceUseCase } from "@viral/contracts"

// The use-case chips, in ElevenLabs' order, with our names for them.
export const USE_CASES: ReadonlyArray<{ readonly value: VoiceUseCase; readonly label: string }> = [
  { value: "conversational", label: "Conversational" },
  { value: "narrative_story", label: "Narration" },
  { value: "characters_animation", label: "Characters" },
  { value: "social_media", label: "Social Media" },
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
