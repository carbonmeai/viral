import { closingLine, type GatePayload, type RunUpdate } from "@viral/contracts"
import { Console, Effect } from "effect"
import { describeShortlist } from "./shortlist-text.ts"

// "Video 2 · " before a clip's seconds when the short draws from several videos (absent = the first); nothing for
// one video.
const videoLabels = (items: ReadonlyArray<{ readonly source?: number }>) => {
  const several = items.some((item) => item.source !== undefined)
  return (source: number | undefined) => several ? `Video ${(source ?? 0) + 1} · ` : ""
}

// What a gate is asking you to approve, in readable form.
const describePayload = (payload: GatePayload | null): string => {
  if (payload === null) return ""
  switch (payload._tag) {
    case "ScriptGate": {
      const { script, narrationWords } = payload
      const headline = script.headline === null ? "" : `  HEADLINE  ${script.headline.join(" / ")}\n`
      const video = videoLabels(script.beats.flatMap((beat) => beat._tag === "Real" ? [beat] : []))
      const beats = script.beats.map((beat) =>
        beat._tag === "Narration"
          ? `  NARRATOR  ${beat.text}`
          : beat._tag === "Cta"
          ? `  CLOSING   ${closingLine(beat.question)}`
          : `    REAL    "${beat.quote}"  (${video(beat.source)}${beat.start.toFixed(1)}–${beat.end.toFixed(1)}s)`
      ).join("\n")
      return `${headline}${beats}\n  ${narrationWords} narrated words\n`
    }
    case "VoiceGate": {
      const { voiceover: v, file } = payload
      return `  ${file ?? "(no file)"}\n  ${v.durationS.toFixed(1)}s · ${v.pace.toFixed(2)} words/s (raw ${v.rawPace.toFixed(2)}, atempo ${v.atempo})` +
        ` · voice ${v.voiceId} · ${v.characters} characters\n`
    }
    case "ShotsGate": {
      const { plan, storyboard } = payload
      const video = videoLabels([...plan.shots, ...plan.inserts, ...plan.outro])
      const shots = plan.shots.map((shot, k) =>
        `  ${String(k + 1).padStart(2)}  w${String(shot.word).padEnd(3)} ${shot.wordText.padEnd(12)} ${video(shot.source)}${shot.src.toFixed(1).padStart(7)}s` +
        `${shot.fit === true ? " fit" : ""}${shot.speed === undefined ? "" : ` ×${shot.speed}`}  ${shot.note}`
      ).join("\n")
      const reals = [
        ...plan.inserts.map((i) => `  REAL after w${i.afterWord} "${i.afterWordText}": ${video(i.source)}"${i.quote}"`),
        ...plan.outro.map((o) => `  OUTRO ${video(o.source)}"${o.quote}"`)
      ].join("\n")
      return `${shots}\n${reals}\n  ${plan.shots.length} shots · ${plan.markers.length} markers · storyboard ${storyboard ?? "(none)"}\n`
    }
    case "SectionsGate": {
      const { plan, storyboard } = payload
      const seconds = plan.sections.reduce((n, s) => n + s.end - s.start, 0)
      const hook = plan.hookText === null ? "" : `  HOOK TEXT  ${plan.hookText}\n`
      const video = videoLabels(plan.sections)
      const sections = plan.sections.map((s, k) =>
        `  ${String(k + 1).padStart(2)}  ${s.beat.padEnd(13)} ${video(s.source)}${s.start.toFixed(1).padStart(7)}–${s.end.toFixed(1)}s  "${s.text}"`
      ).join("\n")
      return `${hook}${sections}\n  ${plan.sections.length} sections · ${seconds.toFixed(1)}s · storyboard ${storyboard ?? "(none)"}\n`
    }
    case "RankingGate": {
      const { plan, storyboard } = payload
      const several = plan.entries.some((e) => e.source !== undefined)
      const byRank = new Map(plan.entries.map((e) => [e.rank, e]))
      const entries = [...plan.entries].sort((a, b) => a.rank - b.rank).map((e) => {
        const seconds = e.shots.reduce((n, s) => n + s.end - s.start, 0)
        const shots = e.shots.map((s) =>
          `        ${s.role.padEnd(6)} ${several ? `Video ${(e.source ?? 0) + 1} · ` : ""}${s.start.toFixed(1).padStart(7)}–${s.end.toFixed(1)}s ${s.framing.padEnd(6)} ${s.note}${
            s.text === "" ? "" : `  "${s.text.length > 70 ? `${s.text.slice(0, 70)}…` : s.text}"`
          }`
        ).join("\n")
        return `  #${String(e.rank).padEnd(3)}${e.label} ${e.emoji}  (${seconds.toFixed(1)}s)\n${shots}`
      }).join("\n")
      const order = plan.order.map((r) => `#${r}`).join(", ")
      const warnings = plan.warnings.length === 0 ? "" : `  look at: ${plan.warnings.join("; ")}\n`
      return `  TITLE  ${plan.title.lead}[${plan.title.accent}]\n${entries}\n  plays ${order} · ${plan.durationS.toFixed(1)}s of ${plan.maxSeconds.toFixed(0)}s` +
        ` · ${byRank.size} entries · storyboard ${storyboard ?? "(none)"}\n${warnings}`
    }
    case "RenderGate": {
      const r = payload.render
      const checks = r.checks === undefined
        ? ""
        : `  checks: loudness ${r.checks.lufs === null ? "?" : `${r.checks.lufs.toFixed(1)} LUFS`} · ` +
          `${r.checks.black.length === 0 ? "no black frames" : `black at ${r.checks.black.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)}s`).join(", ")}`}` +
          ` · ${r.checks.frames.length} shots' first and last frames in ${r.checks.frames[0] === undefined ? "(none)" : r.checks.frames[0].first.replace(/\/[^/]*$/, "")}\n`
      // a video found by research: its clips from 1080p pieces, or (said plainly) from the 480p reading copy
      const footage = r.footage === undefined || r.footage.length === 0
        ? ""
        : `  footage: ${
          r.footage.map((f) =>
            `V${f.video + 1} ${
              f.scanClips === 0
                ? `${f.height ?? "full"}p pieces (${f.clips} clips from ${f.pieces} ${f.pieces === 1 ? "piece" : "pieces"})`
                : `WARNING ${f.scanClips} of ${f.clips + f.scanClips} clips from the ${f.scanHeight ?? 480}p reading copy: ${f.problem ?? "outside the pieces"}`
            }`
          ).join(" · ")
        }\n`
      return `  ${r.video}\n  ${r.durationS.toFixed(1)}s · ${r.shots} shots · captions ${r.captions}\n` +
        `  check sheet ${r.checkSheet ?? "(none)"}\n${checks}${footage}` +
        `  rejecting goes back to the shots (the sections for a cut-down short, the moments for a ranking) with your note\n`
    }
    case "ThumbnailGate": {
      const c = payload.config
      if (c === null) {
        const options = (payload.options ?? []).map((o, i) => `  option ${i + 1}${payload.recommended === i + 1 ? " (recommended)" : ""}: ${o ?? "(not made)"}\n`).join("")
        return `${options}  edit <id> <file.json> with {"choose": n} uses option n; rejecting asks for another round with your note\n`
      }
      const text = c.lines.map((l) => l.text).join(" / ")
      // a config from several videos lists the others in `sources`
      const video = (source: number | undefined) => c.sources === undefined ? "" : `Video ${(source ?? 0) + 1} · `
      return `  ${payload.image ?? "(no image)"}\n  "${text}" · hero at ${video(c.hero.source)}${c.hero.src.toFixed(1)}s` +
        `${c.inset === undefined ? "" : ` · face at ${video(c.inset.source)}${c.inset.src.toFixed(1)}s`}\n` +
        `  rejecting redraws it with your note; edit <id> <config.json> re-renders your changes\n`
    }
    case "ShortlistGate":
      return describeShortlist(payload.shortlist)
    case "ArtifactGate":
      return `  ${payload.artifact.kind} v${payload.artifact.version}${payload.artifact.path === null ? "" : `  ${payload.artifact.path}`}\n`
  }
}

// One readable line per run update. Progress prints in 10% steps; agent messages print as they come.
export const printUpdate = (): ((update: RunUpdate) => Effect.Effect<void>) => {
  let lastPct = -1
  return (update) => {
    switch (update._tag) {
      case "Snapshot":
        return Console.log(`run ${update.run.id}  ${update.run.status}`)
      case "Progress": {
        if (update.pct === null) return update.message === null ? Effect.void : Console.log(`    ${update.message}`)
        const step = Math.floor(update.pct / 10) * 10
        if (step === lastPct) return Effect.void
        lastPct = step
        return Console.log(`    ${update.stage} ${update.pct.toFixed(0)}%${update.message === null ? "" : `  ${update.message}`}`)
      }
      case "Event": {
        const event = update.event
        switch (event._tag) {
          case "RunStarted":
            return Effect.void
          case "StageStarted":
            lastPct = -1
            return Console.log(`▶ ${event.stageRun.stage}${event.stageRun.attempt > 1 ? ` (attempt ${event.stageRun.attempt})` : ""}`)
          case "StageFinished": {
            const s = event.stageRun
            const mark = s.status === "succeeded" ? "✔" : s.status === "reused" ? "↺" : s.status === "failed" ? "✖" : "■"
            return Console.log(`${mark} ${s.stage} ${s.status}${s.error === null ? "" : `: ${s.error}`}`)
          }
          case "RequestRaised":
            return Console.log(
              `${describePayload(event.request.payload)}? ${event.request.title}  →  approve ${event.request.id}  |  reject ${event.request.id} "note"`
            )
          case "RequestAnswered":
            return Console.log(`  answered: ${event.request.response?._tag ?? ""}`)
          case "RunFinished":
            return Console.log(`run ${event.run.status}${event.run.error === null ? "" : `: ${event.run.error}`}`)
        }
      }
    }
  }
}
