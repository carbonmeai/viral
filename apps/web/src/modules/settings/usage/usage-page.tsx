import { useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import type { Usage } from "@viral/contracts"
import { Panel } from "@viral/ui/primitives/panel"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Stat } from "@viral/ui/primitives/stat"
import { AudioLines, Clapperboard, DollarSign, Gauge } from "lucide-react"
import { useState } from "react"
import { usageAtom } from "../settings-api.ts"
import { Loaded, SettingsPage } from "../settings-page.tsx"
import { barHeights, dayLabel, formatCount, formatUsd } from "./usage-values.ts"

type Period = "7" | "30" | "90"

// Settings › Usage: what the agents and voices cost, by day, by short and by step.
export function UsagePage() {
  const [period, setPeriod] = useState<Period>("30")
  const usage = useAtomValue(usageAtom(Number(period)))
  return (
    <SettingsPage
      section="usage"
      description="What Claude and ElevenLabs cost, from every step Viral ran."
      actions={
        <Segmented<Period>
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]}
        />
      }
    >
      <Loaded result={usage} what="your usage">{(value) => <UsageContent usage={value} />}</Loaded>
    </SettingsPage>
  )
}

function UsageContent({ usage }: { readonly usage: Usage }) {
  const { totals } = usage
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-4 gap-2">
        <Stat icon={<DollarSign />} label="Claude" value={formatUsd(totals.costUsd)} sub={`${formatCount(totals.inputTokens)} in · ${formatCount(totals.outputTokens)} out tokens`} />
        <Stat icon={<AudioLines />} label="ElevenLabs" value={formatCount(totals.ttsCharacters)} sub="characters spoken" />
        <Stat icon={<Clapperboard />} label="Shorts made" value={totals.shorts} sub={`in the last ${usage.days} days`} />
        <Stat icon={<Gauge />} label="Per short" value={totals.costPerShortUsd === null ? "–" : formatUsd(totals.costPerShortUsd)} sub="Claude, on average" />
      </div>
      <Panel title="Daily spend">
        <DailyChart days={usage.byDay} />
      </Panel>
      <div className="grid grid-cols-2 gap-2">
        <Panel title="Top shorts" count={usage.byShort.length}>
          {usage.byShort.length === 0 ? <Empty /> : usage.byShort.slice(0, 8).map((s) => (
            <Link key={s.projectId} to="/shorts/$projectId" params={{ projectId: s.projectId }} className="block">
              <Row className="grid-cols-[minmax(0,1fr)_auto]">
                <RowTitle title={s.title} sub={s.ttsCharacters > 0 ? `${formatCount(s.ttsCharacters)} characters spoken` : undefined} />
                <span className="tabular-nums">{formatUsd(s.costUsd)}</span>
              </Row>
            </Link>
          ))}
        </Panel>
        <Panel title="By step" count={usage.byStage.length}>
          {usage.byStage.length === 0 ? <Empty /> : usage.byStage.map((s) => (
            <Row key={s.stage} className="grid-cols-[minmax(0,1fr)_auto]">
              <RowTitle title={s.stage} sub={[s.model, `${s.runs} ${s.runs === 1 ? "run" : "runs"}`].filter(Boolean).join(" · ")} />
              <span className="tabular-nums">{s.ttsCharacters > 0 ? `${formatCount(s.ttsCharacters)} chars` : formatUsd(s.costUsd)}</span>
            </Row>
          ))}
        </Panel>
      </div>
    </div>
  )
}

const Empty = () => <div className="px-1 py-3 text-fg-2">Nothing ran in this period.</div>

// One bar per day, scaled to the busiest; hovering a bar names its day and cost.
function DailyChart({ days }: { readonly days: Usage["byDay"] }) {
  const heights = barHeights(days.map((d) => d.costUsd))
  const width = 100 / days.length
  return (
    <div className="grid gap-1.5">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Spend per day">
        {days.map((d, i) => (
          <rect
            key={d.day}
            x={i * width + width * 0.15}
            width={width * 0.7}
            y={40 - Math.max(heights[i]! * 40, d.costUsd > 0 ? 0.6 : 0)}
            height={Math.max(heights[i]! * 40, d.costUsd > 0 ? 0.6 : 0)}
            rx={0.4}
            className="fill-lemon"
          >
            <title>{`${dayLabel(d.day)} · ${formatUsd(d.costUsd)}`}</title>
          </rect>
        ))}
      </svg>
      <div className="flex justify-between text-2xs text-fg-2">
        <span>{dayLabel(days[0]?.day ?? "")}</span>
        <span>{dayLabel(days[Math.floor(days.length / 2)]?.day ?? "")}</span>
        <span>{dayLabel(days.at(-1)?.day ?? "")}</span>
      </div>
    </div>
  )
}
