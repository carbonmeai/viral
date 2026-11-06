import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ExploreVoicesQuery, LibraryVoice, Preset, VoiceSort, VoiceUseCase } from "@viral/contracts"
import { Button, IconButton } from "@viral/ui/primitives/button"
import { cn } from "@viral/ui/cn"
import { Input } from "@viral/ui/primitives/input"
import { Select } from "@viral/ui/primitives/select"
import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  BadgeCheck,
  BookOpen,
  Check,
  Clock3,
  GraduationCap,
  Languages,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Smartphone,
  Smile,
  Tv,
  Users
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Detail } from "../../system/detail.tsx"
import { addLibraryVoice, exploreVoicesAtom, updatePreset } from "../library-api.ts"
import { refusal } from "../library-values.ts"
import { SampleButton } from "./sample-button.tsx"
import { ageLabel, compactCount, flagOf, initials, LANGUAGES, languageName, splitName, USE_CASES, useCaseLabel } from "./voices-values.ts"

const USE_CASE_ICONS: Record<VoiceUseCase, ReactNode> = {
  conversational: <MessageSquare />,
  narrative_story: <BookOpen />,
  characters_animation: <Smile />,
  social_media: <Smartphone />,
  informative_educational: <GraduationCap />,
  advertisement: <Megaphone />,
  entertainment_tv: <Tv />
}

const SORTS: ReadonlyArray<{ readonly value: VoiceSort; readonly label: string }> = [
  { value: "trending", label: "Trending" },
  { value: "cloned_by_count", label: "Most used" },
  { value: "usage_character_count_1y", label: "Most spoken" },
  { value: "created_date", label: "Newest" }
]

type Filters = Omit<ExploreVoicesQuery, "page">

// Library › Voices › Explore: ElevenLabs' shared library (search, language, what the voice is for), with a free
// sample on every voice and "+" to add it to yours. Narration is picked first: it's what a short's narrator needs.
export function ExploreTab({ styles }: { readonly styles: ReadonlyArray<Preset> }) {
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<Filters>({ search: null, language: "en", useCase: "narrative_story", gender: null, age: null, sort: "trending" })
  const [showFilters, setShowFilters] = useState(false)
  const [pages, setPages] = useState(1)
  // a quiet pause before searching, so each keystroke isn't a request
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.search ?? "") === search.trim() ? f : { ...f, search: search.trim() === "" ? null : search.trim() }), 350)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => setPages(1), [filters])
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-2" />
          <Input
            aria-label="Search library voices"
            placeholder="Search library voices…"
            className="h-8 w-full rounded-[10px] pl-9 text-[13px]"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </label>
        <Button size="md" variant={showFilters ? "default" : "ghost"} className={showFilters ? "" : "bg-panel"} onClick={() => setShowFilters(!showFilters)}>
          <SlidersHorizontal />Filters{filters.gender !== null || filters.age !== null ? " · on" : ""}
        </Button>
        <Select<VoiceSort>
          label="Sort"
          className="h-8 min-w-[132px] bg-panel"
          value={filters.sort}
          options={SORTS}
          onChange={(sort) => set({ sort })}
        />
      </div>

      {showFilters ? (
        <div className="flex flex-wrap items-center gap-2 rounded-panel bg-panel px-3 py-2.5">
          <span className="text-xs text-fg-2">Gender</span>
          <Select<string>
            label="Gender"
            value={filters.gender ?? "any"}
            options={[{ value: "any", label: "Any" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "neutral", label: "Neutral" }]}
            onChange={(g) => set({ gender: g === "any" ? null : (g as "female" | "male" | "neutral") })}
          />
          <span className="ml-2 text-xs text-fg-2">Age</span>
          <Select<string>
            label="Age"
            value={filters.age ?? "any"}
            options={[{ value: "any", label: "Any" }, { value: "young", label: "Young" }, { value: "middle_aged", label: "Middle aged" }, { value: "old", label: "Old" }]}
            onChange={(a) => set({ age: a === "any" ? null : (a as "young" | "middle_aged" | "old") })}
          />
          {filters.gender !== null || filters.age !== null
            ? <Button variant="ghost" className="ml-auto" onClick={() => set({ gender: null, age: null })}>Clear</Button>
            : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select<string>
          label="Language"
          className="h-8 min-w-0 gap-1.5 rounded-full bg-panel px-3"
          value={filters.language ?? "any"}
          options={[{ value: "any", label: <span className="inline-flex items-center gap-1.5"><Languages className="size-3.5" />Any language</span> }, ...LANGUAGES.map((code) => ({
            value: code,
            label: <span className="inline-flex items-center gap-1.5"><Languages className="size-3.5" />{languageName(code)}</span>
          }))]}
          onChange={(language) => set({ language: language === "any" ? null : language })}
        />
        <span aria-hidden className="mx-1 h-5 w-px bg-line-2" />
        {USE_CASES.map((u) => {
          const on = filters.useCase === u.value
          return (
            <button
              key={u.value}
              type="button"
              aria-pressed={on}
              onClick={() => set({ useCase: on ? null : u.value })}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] outline-none [&_svg]:size-3.5",
                on ? "bg-sel text-fg ring-1 ring-lemon" : "bg-panel text-fg-1 hover:bg-ctl hover:text-fg"
              )}
            >
              {USE_CASE_ICONS[u.value]}{u.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col">
        {Array.from({ length: pages }, (_, page) => (
          <ExplorePage
            key={page}
            query={{ ...filters, page }}
            styles={styles}
            first={page === 0}
            last={page === pages - 1}
            onMore={() => setPages(page + 2)}
          />
        ))}
      </div>
    </div>
  )
}

function ExplorePage({ query, styles, first, last, onMore }: {
  readonly query: ExploreVoicesQuery
  readonly styles: ReadonlyArray<Preset>
  readonly first: boolean
  readonly last: boolean
  readonly onMore: () => void
}) {
  const result = useAtomValue(exploreVoicesAtom(JSON.stringify(query)))
  const data = AsyncResult.value(result)
  if (Option.isNone(data)) {
    return AsyncResult.isFailure(result)
      ? <div className="rounded-panel bg-panel px-4 py-3 text-fg-2">Couldn’t reach ElevenLabs’ voice library. Check your key in Settings › Accounts.</div>
      : <ExploreSkeleton count={first} />
  }
  const { voices, total, hasMore } = data.value
  return (
    <>
      {first ? (
        <div className="flex items-center justify-between pb-1 text-[13px] text-fg-2">
          <span>{total.toLocaleString("en-US")} voices</span>
        </div>
      ) : null}
      {first && voices.length === 0 ? <div className="py-8 text-center text-fg-2">No voices match. Try another language or fewer filters.</div> : null}
      {voices.map((voice) => <LibraryVoiceRow key={voice.voiceId} voice={voice} styles={styles} />)}
      {last && hasMore ? <MoreSentinel onMore={onMore} /> : null}
    </>
  )
}

// Loads the next page when it scrolls into view; a button too, for keyboards.
function MoreSentinel({ onMore }: { readonly onMore: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = ref.current
    if (node === null) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMore()
    }, { rootMargin: "400px" })
    observer.observe(node)
    return () => observer.disconnect()
  }, [onMore])
  return <div ref={ref} className="flex justify-center py-4"><Button variant="ghost" onClick={onMore}>Show more voices</Button></div>
}

const ROW = "grid grid-cols-[minmax(0,3fr)_minmax(0,1.5fr)_60px_80px_minmax(0,1fr)_auto] items-center gap-4"

function LibraryVoiceRow({ voice, styles }: { readonly voice: LibraryVoice; readonly styles: ReadonlyArray<Preset> }) {
  const add = useAtomSet(addLibraryVoice, { mode: "promise" })
  const save = useAtomSet(updatePreset, { mode: "promise" })
  const [state, setState] = useState<"idle" | "adding" | "added">(voice.inMyVoices ? "added" : "idle")
  const [problem, setProblem] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const { name, traits } = splitName(voice.name)
  const flag = flagOf(voice.locale)
  const age = ageLabel(voice.createdAt, Date.now())
  const added = state === "added"

  return (
    <div className="border-b border-line last:border-b-0">
      <div className={cn(ROW, "min-h-[60px] rounded-[10px] px-2 py-2.5 hover:bg-panel")}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative shrink-0">
            <span className="grid size-9 place-items-center rounded-full bg-ctl-active text-[12px] font-semibold text-fg-1">{initials(voice.name)}</span>
            {voice.category === "professional" ? (
              <BadgeCheck className="absolute -top-1 -right-1 size-4 rounded-full bg-bg fill-fg text-bg" aria-label="Verified voice" />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] font-medium">{name}{traits === null ? "" : ` - ${traits}`}</span>
            <span className="truncate text-[13px] text-fg-2">{voice.description ?? " "}</span>
          </span>
        </div>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {flag === null ? null : <span aria-hidden>{flag}</span>}
          <span className="truncate">{languageName(voice.language) ?? "—"}</span>
          {voice.accent === null ? null : <span className="truncate text-fg-2 capitalize">{voice.accent}</span>}
          {voice.extraLanguages > 0 ? <span className="shrink-0 rounded-full bg-ctl px-1.5 text-[11px] text-fg-2">+{voice.extraLanguages}</span> : null}
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-fg-1 [&_svg]:size-3.5 [&_svg]:text-fg-2" title="Shared">{age === null ? null : <><Clock3 />{age}</>}</span>
        <span className="flex items-center gap-1.5 text-[13px] text-fg-1 [&_svg]:size-3.5 [&_svg]:text-fg-2" title="People using it"><Users />{compactCount(voice.users)}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg-1 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-2">
          {voice.useCase !== null && voice.useCase in USE_CASE_ICONS ? USE_CASE_ICONS[voice.useCase as VoiceUseCase] : <BookOpen />}
          <span className="truncate">{useCaseLabel(voice.useCase) ?? "—"}</span>
        </span>
        <span className="flex items-center gap-0.5">
          <IconButton
            label={added ? `${name} is in your voices` : `Add ${name} to your voices`}
            disabled={state !== "idle"}
            className={added ? "text-lemon-fg disabled:opacity-100" : ""}
            onClick={() => {
              setState("adding")
              setProblem(null)
              void add({ payload: { publicOwnerId: voice.publicOwnerId, voiceId: voice.voiceId, name: null }, reactivityKeys: ["voices"] })
                .then(() => setState("added"))
                .catch((e: unknown) => {
                  setState("idle")
                  setProblem(refusal(e)[0] ?? "ElevenLabs didn’t add it.")
                })
            }}
          >
            {added ? <Check /> : <Plus />}
          </IconButton>
          <SampleButton url={voice.previewUrl} name={name} />
          <IconButton label="More" onClick={() => setMore(!more)}><MoreHorizontal /></IconButton>
        </span>
      </div>
      {problem === null ? null : <div className="px-2 pb-2 text-xs text-danger">{problem}</div>}
      {added && state === "added" && !voice.inMyVoices ? (
        <div className="flex items-center gap-2 px-2 pb-2.5 text-xs text-fg-2">
          Added to your voices.
          {styles.length === 0 ? null : (
            <Select<string>
              label={`Use ${name} for a style`}
              value=""
              options={[{ value: "", label: "Use for style…" }, ...styles.map((s) => ({ value: s.id, label: s.name }))]}
              onChange={(id) => {
                const style = styles.find((s) => s.id === id)
                if (style === undefined) return
                void save({ payload: { id: style.id, config: { ...style.config, voice: { ...style.config.voice, voiceId: voice.voiceId } } }, reactivityKeys: ["presets"] })
                  .catch((e: unknown) => setProblem(refusal(e)[0] ?? null))
              }}
            />
          )}
        </div>
      ) : null}
      {more ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pb-2.5 text-xs text-fg-2">
          {[voice.gender, voice.age?.replace("_", " "), voice.accent, voice.category].filter((v) => v !== null && v !== undefined).join(" · ")}
          <Detail>{`voice ${voice.voiceId}`}</Detail>
          <a className="underline" href={`https://elevenlabs.io/app/voice-library?voiceId=${voice.voiceId}`} target="_blank" rel="noreferrer">Open on ElevenLabs</a>
        </div>
      ) : null}
    </div>
  )
}

function ExploreSkeleton({ count }: { readonly count: boolean }) {
  return (
    <SkeletonRegion label="Loading the voice library" className="flex flex-col">
      {count ? <Skeleton className="mb-2 h-3.5 w-24" /> : null}
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={cn(ROW, "min-h-[60px] border-b border-line px-2 py-2.5")}>
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-[60%]" /><Skeleton className="h-3 w-[80%]" /></div>
          </div>
          <Skeleton className="h-3.5 w-[70%]" />
          <Skeleton className="h-3.5 w-8" />
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3.5 w-[60%]" />
          <div className="flex gap-1"><Skeleton className="size-7" /><Skeleton className="size-7" /><Skeleton className="size-7" /></div>
        </div>
      ))}
    </SkeletonRegion>
  )
}
