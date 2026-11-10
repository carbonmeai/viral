import { Effect } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { ApproachName } from "@viral/contracts"
import { approachSkill, SkillName, SkillPack } from "./skill-pack.ts"

const load = Effect.runPromise(SkillPack.useSync((pack) => pack).pipe(Effect.provide(SkillPack.layer)))

test("loads every skill in the pack with its frontmatter", async () => {
  const pack = await load
  assert.deepEqual([...pack.skills.keys()], [...SkillName.literals])
  for (const skill of pack.skills.values()) {
    assert.ok(skill.description.length > 20, `${skill.name} has a description`)
    assert.ok(!skill.body.startsWith("---"), `${skill.name} body excludes the frontmatter`)
  }
})

test("a stage prompt carries its instructions followed by its skills", async () => {
  const pack = await load
  const prompt = pack.systemPrompt({ prompt: "Write the script.", skills: [approachSkill("claim-interleaved")] })
  assert.ok(prompt.startsWith("Write the script.\n\n<skill name=\"approach-claim-interleaved\">"))
  assert.match(prompt, /Hook: a claim, not a question/)
  assert.doesNotMatch(prompt, /intensity curve/i, "only the stage's own skills are included")
})

test("every approach has a skill in the pack", async () => {
  const pack = await load
  for (const approach of ApproachName.literals) {
    assert.ok(pack.skills.has(approachSkill(approach)), `skill for ${approach}`)
  }
})

test("story-arc carries the format table, whole sentences and the closing question; no skill forbids the subscribe ask", async () => {
  const pack = await load
  const arc = pack.skills.get("story-arc")!.body
  assert.match(arc, /## Choosing the format from the kind of video/)
  assert.match(arc, /\*\*`cut-down`\*\*/)
  assert.match(arc, /Never cut anyone mid-sentence/)
  assert.match(arc, /## The closing question/)
  assert.match(arc, /Tell us in the comments, and subscribe for more\./)
  assert.match(arc, /## Topic mode/)
  for (const skill of pack.skills.values()) {
    assert.doesNotMatch(skill.body, /no subscribe ask/i, `${skill.name} still forbids the subscribe ask`)
  }
})

test("the cut-down, ranking, metadata and research skills carry the new rules", async () => {
  const pack = await load
  const body = (name: SkillName) => pack.skills.get(name)!.body
  assert.match(body("approach-cut-down"), /\*\*30–120 seconds\*\*/)
  assert.match(body("approach-cut-down"), /keep it whole and cut\s+somewhere else/)
  assert.match(body("approach-ranking"), /only when|explains itself visually/)
  assert.match(body("short-metadata"), /ranking's title may end with\s+one emoji/)
  assert.match(body("short-metadata"), /Number one will get you\./)
  assert.match(body("finding-source-videos"), /## Videos for a ranking \(required\)/)
  assert.match(body("finding-source-videos"), /news clips \(ET, E! News, AP,\s+broadcasters\) draw copyright claims/)
  // written ahead of their approaches: loaded, but in no stage yet
  assert.match(body("approach-story-recap"), /150–220 narrated words/)
  assert.match(body("approach-narrated-ranking"), /Five entries by default/)
})
