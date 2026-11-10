import type { Change, ChangeLine, ChatCheck } from "@viral/contracts"

// Building blocks for the change cards each domain writes (script-changes.ts, shots-changes.ts…): a line changed,
// added or removed, a note, and a passed check.

export const changed = (label: string, old: string | null, next: string | null): ChangeLine => ({ label, old, new: next, note: null })
export const noted = (label: string, note: string): ChangeLine => ({ label, old: null, new: null, note })
export const passed = (text: string): ChatCheck => ({ text, ok: true })

// A card, or null when nothing changed.
export const changeOf = (headline: string, lines: ReadonlyArray<ChangeLine>): Change | null =>
  lines.length === 0 ? null : { headline, lines: [...lines] }

// At most `max` lines, then "and n more".
export const capped = (lines: ReadonlyArray<ChangeLine>, max = 6): ReadonlyArray<ChangeLine> =>
  lines.length <= max ? lines : [...lines.slice(0, max), noted("", `and ${lines.length - max} more`)]

// 41.0s
export const seconds = (s: number) => `${s.toFixed(1)}s`
// 12:03 (a time in a long video)
export const clock = (s: number) => {
  const whole = Math.max(0, Math.round(s))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// "Changed line 1", "Changed 2 lines, added 1"
export const countHeadline = (noun: string, counts: { readonly changed: number; readonly added: number; readonly removed: number }) => {
  const parts = [
    counts.changed > 0 ? `changed ${counts.changed === 1 ? noun : plural(counts.changed, noun)}` : null,
    counts.added > 0 ? `added ${counts.added}` : null,
    counts.removed > 0 ? `removed ${counts.removed}` : null
  ].filter((p) => p !== null)
  const text = parts.join(", ")
  return text === "" ? "No changes" : text[0]!.toUpperCase() + text.slice(1)
}

// Pairs two lists by their keys, the way a diff does: the longest run kept in order, and what's between as changed
// (a removed and an added item side by side), removed or added.
export type Aligned<A> =
  | { readonly _tag: "Same"; readonly before: A; readonly after: A; readonly at: number }
  | { readonly _tag: "Changed"; readonly before: A; readonly after: A; readonly at: number }
  | { readonly _tag: "Removed"; readonly before: A; readonly at: number }
  | { readonly _tag: "Added"; readonly after: A; readonly at: number }

export const align = <A>(before: ReadonlyArray<A>, after: ReadonlyArray<A>, key: (a: A) => string): ReadonlyArray<Aligned<A>> => {
  const n = before.length
  const m = after.length
  const lcs: Array<Array<number>> = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = key(before[i]!) === key(after[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: Array<Aligned<A>> = []
  let removed: Array<A> = []
  let added: Array<{ readonly item: A; readonly at: number }> = []
  const flush = () => {
    const pairs = Math.min(removed.length, added.length)
    for (let k = 0; k < pairs; k++) out.push({ _tag: "Changed", before: removed[k]!, after: added[k]!.item, at: added[k]!.at })
    for (const r of removed.slice(pairs)) out.push({ _tag: "Removed", before: r, at: added[0]?.at ?? -1 })
    for (const a of added.slice(pairs)) out.push({ _tag: "Added", after: a.item, at: a.at })
    removed = []
    added = []
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && key(before[i]!) === key(after[j]!)) {
      flush()
      out.push({ _tag: "Same", before: before[i]!, after: after[j]!, at: j })
      i++
      j++
    } else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      added.push({ item: after[j]!, at: j })
      j++
    } else {
      removed.push(before[i]!)
      i++
    }
  }
  flush()
  return out
}
