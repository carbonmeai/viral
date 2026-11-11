import {
  type Artifact,
  type ArtifactKind,
  type Change,
  type ChatCheck,
  type ChatItem,
  CutPlan,
  MusicBed,
  type Project,
  RankingPlan,
  RenderedShort,
  Script,
  ShortMetadata,
  ShotPlan,
  type StageName,
  type StageRun,
  Thumbnail,
  videoLabel,
  videoNames,
  Voiceover
} from "@viral/contracts"
import { Effect, Option, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { describeMetadataChange, metadataChecks, metadataSummary } from "../metadata/metadata-changes.ts"
import { describeRankingChange, rankingChecks, rankingSummary } from "../moments/ranking-changes.ts"
import { describeMusicChange, musicChecks, musicSummary } from "../music-bed/music-changes.ts"
import { RunStore } from "../runs/run-store.ts"
import { describeScriptChange, scriptChecks, scriptSummary } from "../script/script-changes.ts"
import { describeSectionsChange, sectionsChecks, sectionsSummary } from "../sections/sections-changes.ts"
import { describeShotsChange, shotsChecks, shotsSummary } from "../shots/shots-changes.ts"
import { Sources } from "../sources/sources.ts"
import { aiThumbnailChecks, describeThumbnailChange, thumbnailChecks, thumbnailSummary } from "../thumbnail/thumbnail-changes.ts"
import { passed, plural, seconds } from "./change-lines.ts"

// One agent stage: the artifact it makes, how to read it, and what the chat says about a version of it.
interface AgentStageView<A> {
  readonly kind: ArtifactKind
  readonly schema: Schema.Codec<A, unknown>
  readonly summary: (a: A) => string
  readonly change: (before: A, after: A, name: (source: number) => string) => Change | null
  readonly checks: (a: A, project: Project) => ReadonlyArray<ChatCheck>
}

const view = <A>(v: AgentStageView<A>) => v as unknown as AgentStageView<unknown>

const AGENT_STAGES: Partial<Record<StageName, AgentStageView<unknown>>> = {
  script: view<Script>({
    kind: "script",
    schema: Script as never,
    summary: scriptSummary,
    change: describeScriptChange,
    checks: (s, p) => scriptChecks(s, p.approach, p.sourceIds.length)
  }),
  shots: view<ShotPlan>({ kind: "shot-plan", schema: ShotPlan as never, summary: shotsSummary, change: describeShotsChange, checks: shotsChecks }),
  sections: view<CutPlan>({ kind: "cut-plan", schema: CutPlan as never, summary: sectionsSummary, change: describeSectionsChange, checks: sectionsChecks }),
  moments: view<RankingPlan>({
    kind: "ranking-plan",
    schema: RankingPlan as never,
    summary: rankingSummary,
    change: (a, b) => describeRankingChange(a, b),
    checks: rankingChecks
  }),
  thumbnail: view<Thumbnail>({
    kind: "thumbnail",
    schema: Thumbnail as never,
    summary: thumbnailSummary,
    change: describeThumbnailChange,
    checks: (t) => t.generated === undefined ? thumbnailChecks : aiThumbnailChecks(t.generated)
  }),
  metadata: view<ShortMetadata>({
    kind: "metadata",
    schema: ShortMetadata as never,
    summary: metadataSummary,
    change: (a, b) => describeMetadataChange(a, b),
    checks: metadataChecks
  })
}

// The stages whose agent answers a note: a message to one of these goes to its agent.
export const AGENT_STAGE_NAMES: ReadonlyArray<StageName> = Object.keys(AGENT_STAGES) as ReadonlyArray<StageName>

const decode = <A>(schema: Schema.Codec<A, unknown>, artifact: Artifact | undefined) =>
  artifact === undefined ? Option.none<A>() : Schema.decodeUnknownOption(schema)(artifact.data)

// The chat item for a stage run that finished (or waits at its gate): an agent stage's version with its change card
// (against the version before) and checks, or a note for a step without an agent. `earlier`: rebuilt from an older
// short's runs, without a change card. Null when there's nothing to say (a stage that made nothing).
export const describeStep = Effect.fn("describeStep")(function*(project: Project, stageRun: StageRun, earlier: boolean) {
  const artifacts = yield* Artifacts
  const store = yield* RunStore
  const sources = yield* Sources
  const owner = { _tag: "Project", id: project.id } as const
  const all = yield* artifacts.list(owner)
  // each video as the editor names it: the short name you gave it, else one made from its title
  const videos = yield* Effect.forEach(project.sourceIds, (id) => Effect.map(Effect.option(sources.get(id)), Option.getOrNull))
  const names = videoNames(videos.map((v) => v?.title ?? null), videos.map((v) => v?.shortName ?? null))
  const name = (source: number) => names[source] ?? videoLabel(source)
  // the versions of a kind, oldest first; the one this run made is the newest made since it started
  const versionsOf = (kind: ArtifactKind) => all.filter((a) => a.kind === kind).sort((a, b) => a.version - b.version)
  const madeHere = (kind: ArtifactKind) => {
    const versions = versionsOf(kind)
    const latest = versions.at(-1)
    if (latest === undefined) return null
    const fresh = latest.createdAt.epochMilliseconds >= stageRun.startedAt.epochMilliseconds - 1000
    return { latest, before: versions.at(-2), fresh }
  }

  const agent = AGENT_STAGES[stageRun.stage]
  if (agent !== undefined) {
    const made = madeHere(agent.kind)
    // a gate asked again after a restart shows the version it made before, without a change card
    if (made === null) return null
    const after = decode(agent.schema, made.latest)
    if (Option.isNone(after)) return null
    const before = decode(agent.schema, made.before)
    const change = earlier || !made.fresh || Option.isNone(before) ? null : agent.change(before.value, after.value, name)
    const item: ChatItem = {
      _tag: "AgentMade",
      stage: stageRun.stage,
      version: made.latest.version,
      reply: yield* store.replyOf(stageRun.id),
      summary: agent.summary(after.value),
      change,
      checks: agent.checks(after.value, project),
      attempt: stageRun.attempt,
      model: stageRun.model,
      provider: stageRun.provider,
      billing: stageRun.billing,
      costUsd: stageRun.costUsd,
      earlier
    }
    return item
  }

  const note = (text: string, checks: ReadonlyArray<ChatCheck> = [], change: Change | null = null): ChatItem =>
    ({ _tag: "StepNote", stage: stageRun.stage, text, change, checks, earlier })

  switch (stageRun.stage) {
    case "voice": {
      const made = madeHere("voiceover")
      const take = made === null ? Option.none() : decode(Voiceover as never as Schema.Codec<Voiceover, unknown>, made.latest)
      if (Option.isNone(take)) return null
      return note(`The voice take is ready: ${seconds(take.value.durationS)} at ${take.value.pace.toFixed(1)} words a second.`)
    }
    case "assemble": {
      if (project.format !== "narrated") return earlier ? null : note("Laid out in the short's style.")
      const made = madeHere("music-bed")
      const bed = (a: Artifact | undefined) => decode(MusicBed as never as Schema.Codec<MusicBed, unknown>, a)
      if (project.musicTrackId === null) return note(`Laid out in the short's style. ${musicSummary(null)}`)
      if (made === null || !made.fresh) return note("Laid out in the short's style.")
      const latest = Option.getOrNull(bed(made.latest))
      const change = earlier ? null : describeMusicChange(Option.getOrNull(bed(made.before)), latest)
      return note(`Laid out in the short's style. ${musicSummary(latest)}`, latest === null ? [] : musicChecks(latest), change)
    }
    case "render": {
      const made = madeHere("render")
      const render = made === null ? Option.none() : decode(RenderedShort as never as Schema.Codec<RenderedShort, unknown>, made.latest)
      if (Option.isNone(render)) return null
      const r = render.value
      const checks: Array<ChatCheck> = []
      if (r.checks !== undefined) {
        checks.push({ text: r.checks.black.length === 0 ? "No black frames" : `${plural(r.checks.black.length, "black gap")}`, ok: r.checks.black.length === 0 })
        if (r.checks.lufs !== null) checks.push(passed(`Loudness ${r.checks.lufs.toFixed(0)} LUFS`))
        checks.push(passed("Every shot's first and last frame drawn for checking"))
      }
      return note(`The render is done: ${seconds(r.durationS)}, ${plural(r.shots, "shot")}.`, checks)
    }
    default:
      return null
  }
})
