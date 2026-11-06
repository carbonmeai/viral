import type { GatePayload, RunUpdate } from "@viral/contracts"
import { Console, Effect } from "effect"

// What a gate is asking you to approve, in readable form.
const describePayload = (payload: GatePayload | null): string => {
  if (payload === null) return ""
  switch (payload._tag) {
    case "ScriptGate": {
      const { script, narrationWords } = payload
      const headline = script.headline === null ? "" : `  HEADLINE  ${script.headline.join(" / ")}\n`
      const beats = script.beats.map((beat) =>
        beat._tag === "Narration"
          ? `  NARRATOR  ${beat.text}`
          : `    REAL    "${beat.quote}"  (${beat.start.toFixed(1)}–${beat.end.toFixed(1)}s)`
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
      const shots = plan.shots.map((shot, k) =>
        `  ${String(k + 1).padStart(2)}  w${String(shot.word).padEnd(3)} ${shot.wordText.padEnd(12)} ${shot.src.toFixed(1).padStart(7)}s` +
        `${shot.fit === true ? " fit" : ""}${shot.speed === undefined ? "" : ` ×${shot.speed}`}  ${shot.note}`
      ).join("\n")
      const reals = [
        ...plan.inserts.map((i) => `  REAL after w${i.afterWord} "${i.afterWordText}": "${i.quote}"`),
        ...plan.outro.map((o) => `  OUTRO "${o.quote}"`)
      ].join("\n")
      return `${shots}\n${reals}\n  ${plan.shots.length} shots · ${plan.markers.length} markers · storyboard ${storyboard ?? "(none)"}\n`
    }
    case "SectionsGate": {
      const { plan, storyboard } = payload
      const seconds = plan.sections.reduce((n, s) => n + s.end - s.start, 0)
      const hook = plan.hookText === null ? "" : `  HOOK TEXT  ${plan.hookText}\n`
      const sections = plan.sections.map((s, k) =>
        `  ${String(k + 1).padStart(2)}  ${s.beat.padEnd(13)} ${s.start.toFixed(1).padStart(7)}–${s.end.toFixed(1)}s  "${s.text}"`
      ).join("\n")
      return `${hook}${sections}\n  ${plan.sections.length} sections · ${seconds.toFixed(1)}s · storyboard ${storyboard ?? "(none)"}\n`
    }
    case "RenderGate": {
      const r = payload.render
      return `  ${r.video}\n  ${r.durationS.toFixed(1)}s · ${r.shots} shots · captions ${r.captions}\n` +
        `  check sheet ${r.checkSheet ?? "(none)"}\n  rejecting goes back to the shots with your note\n`
    }
    case "ThumbnailGate": {
      const c = payload.config
      const text = c.lines.map((l) => l.text).join(" / ")
      return `  ${payload.image ?? "(no image)"}\n  "${text}" · hero at ${c.hero.src.toFixed(1)}s` +
        `${c.inset === undefined ? "" : ` · face at ${c.inset.src.toFixed(1)}s`}\n` +
        `  rejecting redraws it with your note; edit <id> <config.json> re-renders your changes\n`
    }
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
