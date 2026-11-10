import {
  DESIGN_TEXT_MAX,
  DESIGN_TEXT_MIN,
  SOUND_MAX_S,
  SOUND_MIN_S,
  type SoundCategory,
  soundEffectCredits,
  type ThumbConfig
} from "@viral/contracts"

// The generator panels (Library › Create): one shape for each, Model → Prompt → Inputs → Properties → Generate.
export type GeneratorKind = "voice" | "sound" | "thumbnail"

export const GENERATOR_NAMES: Record<GeneratorKind, string> = { voice: "Voice", sound: "Sound effect", thumbnail: "Thumbnail" }

// The models behind them, as labels: voices and sounds aren't agents, so there's no picker for them.
export const VOICE_MODEL_LABEL = "Eleven v3 voice design"
export const SOUND_MODEL_LABEL = "Eleven SFX v3"

const count = (n: number) => n.toLocaleString("en-US")

// ── Voice ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// The line each designed voice speaks: the script's narration from the start, enough for ElevenLabs' 100 characters
// (whole lines, at most 1000), else the sample line.
export const SAMPLE_LINE = "This guy made a candy that hits every single taste at the exact same time, and it took him three years to get it right."
export const defaultVoiceLine = (narration: ReadonlyArray<string>) => {
  let line = ""
  for (const text of narration) {
    const next = line === "" ? text.trim() : `${line} ${text.trim()}`
    if (next.length > DESIGN_TEXT_MAX) break
    line = next
    if (line.length >= DESIGN_TEXT_MIN) break
  }
  return line.length >= DESIGN_TEXT_MIN ? line : SAMPLE_LINE
}

// Whether the voice generator can go, why not, and what it's expected to cost (ElevenLabs bills the line's
// characters; what it reports is what's recorded).
export const voiceCheck = (description: string, line: string) => {
  const words = description.trim()
  const text = line.trim()
  const problem = words.length < 20
    ? "Describe the voice in a sentence or two."
    : text.length < DESIGN_TEXT_MIN
    ? `The line to speak needs at least ${DESIGN_TEXT_MIN} characters (it has ${text.length}).`
    : text.length > DESIGN_TEXT_MAX
    ? `The line to speak can have at most ${DESIGN_TEXT_MAX} characters (it has ${text.length}).`
    : null
  return { problem, characters: text.length, cost: `about ${count(text.length)} characters` }
}

// ── Sound effect ───────────────────────────────────────────────────────────────────────────────────────────────────

const CATEGORY_WORDS: ReadonlyArray<readonly [SoundCategory, RegExp]> = [
  ["swoosh-reverse", /\b(reverse|rewind|flashback)\b/],
  ["scratch", /\bscratch/],
  ["riser", /\b(riser|rise|rising|build|swell)/],
  ["boom", /\b(boom|sub|bass drop)\b/],
  ["impact", /\b(impact|hit|slam|punch|thud)\b/],
  ["whoosh", /\b(whoosh|swoosh|swish|woosh)/],
  ["pop", /\b(pop|bubble|blip)/],
  ["click", /\b(click|button|ui)\b/],
  ["tick", /\b(tick|clock|count)/],
  ["typing", /\b(typ(e|ing)|keyboard)/],
  ["error", /\b(error|wrong|fail|buzzer)/],
  ["ding", /\b(ding|chime|bell|success)/],
  ["glitch", /\b(glitch|static|distort)/],
  ["camera", /\b(camera|shutter|snap)/]
]

// What kind of sound a prompt asks for, so it's filed where the sound stage will look: the first kind its words name
// (a swell into a hit is a riser), else a whoosh.
export const guessCategory = (prompt: string): SoundCategory => {
  const text = prompt.toLowerCase()
  return CATEGORY_WORDS.find(([, words]) => words.test(text))?.[0] ?? "whoosh"
}

// The two hints a sound can take from the short: the word it lands on, and the song's tempo.
export interface SoundHints {
  readonly atWord: { readonly word: string; readonly t: number } | null
  readonly song: { readonly title: string; readonly bpm: number } | null
}

// The prompt as sent: yours, with the hints in words ElevenLabs follows. A hit on a word lands at its end.
export const soundPrompt = (prompt: string, hints: SoundHints) => {
  const parts = [prompt.trim().replace(/[.\s]+$/, "")]
  if (hints.atWord !== null) parts.push(`It lands on the spoken word “${hints.atWord.word}”, with the hit at the very end`)
  if (hints.song !== null) parts.push(`In time with music at ${hints.song.bpm.toFixed(1)} BPM`)
  return `${parts.join(". ")}.`
}

// The length to ask for: yours, or with "Match the song" one bar of the song (four beats) when you left it to
// ElevenLabs; kept inside what it accepts.
export const soundLength = (lengthS: number | null, hints: SoundHints) => {
  const wanted = lengthS ?? (hints.song === null ? null : (60 / hints.song.bpm) * 4)
  return wanted === null ? null : Math.round(Math.min(SOUND_MAX_S, Math.max(SOUND_MIN_S, wanted)) * 10) / 10
}

// What the takes are expected to cost in ElevenLabs credits.
export const soundCost = (durationS: number | null, takes: number) => `about ${count(soundEffectCredits(durationS) * takes)} credits`

// ── Thumbnail ──────────────────────────────────────────────────────────────────────────────────────────────────────

// The thumbnail's properties the generator offers: its layout and the arrow.
export interface ThumbProps {
  readonly layout: "bold" | "classic"
  readonly arrow: boolean
}
export const propsOf = (config: ThumbConfig): ThumbProps => ({ layout: config.layout ?? "classic", arrow: config.arrow === true })

// A moment you picked as the hero instead ("Another frame"): which video, when, and how it's named.
export interface PickedHero {
  readonly source: number
  readonly t: number
  readonly name: string
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

// What Generate does on the thumbnail (no new API):
// - only the properties changed while it waits for you: redraw it at no agent cost (CheckThumbnailEdit, then Edit);
// - a prompt, a new hero, or properties after it's approved: a note to the thumbnail agent ("Use Candy 25:42 as the
//   hero"), sent through the chat, which asks for changes at the gate or redoes the approved step with it;
// - nothing changed: nothing to do.
export type ThumbnailPlan =
  | { readonly _tag: "Redraw"; readonly config: ThumbConfig }
  | { readonly _tag: "Note"; readonly note: string }
  | { readonly _tag: "Nothing"; readonly why: string }

export const thumbnailPlan = (input: {
  readonly config: ThumbConfig
  readonly prompt: string
  readonly props: ThumbProps
  readonly hero: PickedHero | null
  // the thumbnail waits for you at its gate
  readonly atGate: boolean
}): ThumbnailPlan => {
  const before = propsOf(input.config)
  const layoutChanged = input.props.layout !== before.layout
  const arrowChanged = input.props.arrow !== before.arrow
  const prompt = input.prompt.trim()
  if (prompt === "" && input.hero === null) {
    if (!layoutChanged && !arrowChanged) return { _tag: "Nothing", why: "Say what to change, pick another frame or change a property." }
    if (input.atGate) return { _tag: "Redraw", config: { ...input.config, layout: input.props.layout, arrow: input.props.arrow } }
  }
  const sentences = [
    prompt === "" ? null : /[.!?]$/.test(prompt) ? prompt : `${prompt}.`,
    input.hero === null ? null : `Use ${input.hero.name} ${clock(input.hero.t)} as the hero.`,
    layoutChanged ? `Use the ${input.props.layout} layout.` : null,
    arrowChanged ? (input.props.arrow ? "Add an arrow." : "No arrow.") : null
  ].filter((x): x is string => x !== null)
  return { _tag: "Note", note: sentences.join(" ") }
}
