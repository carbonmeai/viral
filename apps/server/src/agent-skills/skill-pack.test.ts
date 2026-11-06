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
