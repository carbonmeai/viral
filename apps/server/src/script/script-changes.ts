import { type ApproachName, type Change, type ChatCheck, closingOf, type Script, type ScriptBeat } from "@viral/contracts"
import { align, capped, changed, changeOf, countHeadline, noted, passed, plural } from "../chat/change-lines.ts"
import { narrationWords, SCRIPT_LIMITS } from "./script-rules.ts"

const textOf = (beat: ScriptBeat) =>
  beat._tag === "Real" ? `“${beat.quote}”`
  : beat._tag === "Cta" ? `${beat.question} (the closing question)`
  : beat.skipped === true ? `${beat.text} (skipped: the real line says it)` : beat.text
const reals = (script: Script) => script.beats.filter((b) => b._tag === "Real").length

// What changed between two versions of a script, beat by beat: the old line struck through and the new one
// highlighted, plus the word and real-line counts when they moved. `videoName` names a real line's video.
export const describeScriptChange = (before: Script, after: Script, videoName: (source: number) => string): Change | null => {
  const label = (beat: ScriptBeat, at: number) =>
    beat._tag === "Narration" ? `Line ${at + 1}` : beat._tag === "Cta" ? "Closing question" : `Line ${at + 1} · real, ${videoName(beat.source ?? 0)}`
  const pairs = align(before.beats, after.beats, textOf)
  const lines = pairs.flatMap((p) =>
    p._tag === "Same" ? [] : p._tag === "Changed"
      ? [changed(label(p.after, p.at), textOf(p.before), textOf(p.after))]
      : p._tag === "Added"
      ? [changed(label(p.after, p.at), null, textOf(p.after))]
      : [changed("Removed", textOf(p.before), null)]
  )
  const headline = (before.headline ?? []).join(" ") === (after.headline ?? []).join(" ")
    ? []
    : [changed("Headline", before.headline?.join(" ") ?? null, after.headline?.join(" ") ?? null)]
  const counts = {
    changed: pairs.filter((p) => p._tag === "Changed").length,
    added: pairs.filter((p) => p._tag === "Added").length,
    removed: pairs.filter((p) => p._tag === "Removed").length
  }
  const all = [...headline, ...capped(lines)]
  const words = [narrationWords(before), narrationWords(after)] as const
  const stats = words[0] === words[1] && reals(before) === reals(after)
    ? []
    : [noted("", `${words[0]} → ${words[1]} words · ${plural(reals(after), "real line")}`)]
  const title = lines.length === 0 && headline.length > 0
    ? "Changed the headline"
    : counts.changed === 1 && counts.added === 0 && counts.removed === 0
    ? `Changed line ${pairs.find((p) => p._tag === "Changed")!.at + 1}`
    : countHeadline("line", counts)
  return changeOf(title, all.length === 0 ? [] : [...all, ...stats])
}

// The rules checkScript holds a passing script to, in plain words, with this script's numbers.
export const scriptChecks = (script: Script, approach: ApproachName): ReadonlyArray<ChatCheck> => {
  const limits = SCRIPT_LIMITS[approach]
  const words = narrationWords(script)
  return [
    ...(limits === undefined ? [] : [
      passed(`${words} words, inside ${limits.narrationWords[0]}–${limits.narrationWords[1]}`),
      passed(`${plural(reals(script), "real line")}, inside ${limits.reals[0]}–${limits.reals[1]}`)
    ]),
    passed("Every real line is in its own video's transcript, at its times"),
    ...(limits?.wholeSentences === true ? [passed("Every real line is whole sentences")] : []),
    ...(limits?.ending == null ? [] : [passed(`Ends on one real take of ${limits.ending.seconds[0]}–${limits.ending.seconds[1]}s`)]),
    passed("None inside an ad, a sponsor read or an end screen"),
    ...(limits?.realsOnlyAtEnd === true ? [passed("Real lines only after the narration")] : []),
    passed("Headline under 8 words"),
    ...(closingOf(script) === null ? [] : [passed("Ends with the closing question, outside the word and real-line counts")])
  ]
}

// The server's own line about a script, when the agent says nothing.
export const scriptSummary = (script: Script) =>
  `The script: ${narrationWords(script)} narrated words and ${plural(reals(script), "real line")}.`
