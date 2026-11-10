import { NodeServices } from "@effect/platform-node"
import type { ApproachName } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"

// The skills in the app's skill pack (skills/<name>/SKILL.md, laid out as a Claude Code plugin).
export const SkillName = Schema.Literals([
  "story-arc",
  "cross-video-story",
  "narrated-shots",
  "approach-question-recap",
  "approach-claim-interleaved",
  "approach-cut-down",
  "approach-ranking",
  // written ahead of their approaches, which aren't in the catalog yet: no stage loads them
  "approach-story-recap",
  "approach-narrated-ranking",
  "short-metadata",
  "thumbnails",
  "finding-source-videos"
])
export type SkillName = typeof SkillName.Type

// Each approach's writing rules live in its own skill.
export const approachSkill = (approach: ApproachName): SkillName => `approach-${approach}`

export interface Skill {
  readonly name: SkillName
  readonly description: string
  // the markdown after the frontmatter
  readonly body: string
}

export interface StageAgent {
  // the stage's job and tool contract; the domain knowledge comes from `skills`
  readonly prompt: string
  readonly skills: ReadonlyArray<SkillName>
}

export class SkillPackError extends Schema.TaggedError<SkillPackError>()("SkillPackError", {
  skill: Schema.String,
  message: Schema.String
}) {}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/

const parseSkill = Effect.fn("parseSkill")(function*(name: SkillName, file: string) {
  const match = FRONTMATTER.exec(file)
  if (match === null) return yield* new SkillPackError({ skill: name, message: "missing frontmatter" })
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1]!)?.[1]?.trim()
  if (field("name") !== name) {
    return yield* new SkillPackError({ skill: name, message: `frontmatter name is ${field("name")}` })
  }
  const description = field("description")
  if (description === undefined) return yield* new SkillPackError({ skill: name, message: "missing description" })
  return { name, description, body: file.slice(match[0].length).trim() } satisfies Skill
})

// Loads the skill pack when the server starts and builds each agent stage's system prompt: the stage's
// own instructions followed by the full text of its skills. Skills are injected rather than left for the
// model to fetch with the Skill tool, because a stage's skills hold rules every output must follow, and a
// model that skips the lookup silently ignores them.
export class SkillPack extends Context.Service<SkillPack, {
  readonly skills: ReadonlyMap<SkillName, Skill>
  systemPrompt(agent: StageAgent): string
}>()("@viral/server/agent-skills/skill-pack/SkillPack") {
  static readonly layer = Layer.effect(
    SkillPack,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const skills = new Map<SkillName, Skill>()
      for (const name of SkillName.literals) {
        const file = yield* fs.readFileString(path.join(import.meta.dirname, "skills", name, "SKILL.md")).pipe(
          Effect.mapError((error) => new SkillPackError({ skill: name, message: error.message }))
        )
        skills.set(name, yield* parseSkill(name, file))
      }

      const systemPrompt = (agent: StageAgent) =>
        [
          agent.prompt,
          ...agent.skills.map((name) => `<skill name="${name}">\n${skills.get(name)!.body}\n</skill>`)
        ].join("\n\n")

      return SkillPack.of({ skills, systemPrompt })
    }).pipe(Effect.orDie)
  ).pipe(Layer.provide(NodeServices.layer))
}
