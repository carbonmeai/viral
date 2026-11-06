import { useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import type { Usage } from "@viral/contracts"
import { Panel } from "@viral/ui/primitives/panel"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { Stat } from "@viral/ui/primitives/stat"
import { Status } from "@viral/ui/primitives/status"
import { AudioLines, Clapperboard, CreditCard, DollarSign, Gauge } from "lucide-react"
import { useState } from "react"
import { usageAtom } from "../settings-api.ts"
import { Loaded, SettingsPage } from "../settings-page.tsx"
import { barHeights, billingLabel, dayLabel, formatCount, formatUsd, providerLabel } from "./usage-values.ts"

type Period = "7" | "30" | "90"

// Settings › Usage: what the agents and voices cost: real money apart from what a CLI plan covers, by day, by
// provider and model, by short and by step, with model evals kept apart.
export function UsagePage() {
  const [period, setPeriod] = useState<Period>("30")
  const usage = useAtomValue(usageAtom(Number(period)))
  return (
    <SettingsPage
      section="usage"
      description="What every step cost: real money (API keys, the AI Gateway) apart from what your Claude plan covers."
      actions={
        <Segmented<Period>
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]}
        />
      }
    >
      <Loaded result={usage} what="your usage" skeleton={<UsageSkeleton />}>{(value) => <UsageContent usage={value} />}</Loaded>
    </SettingsPage>
  )
}

function UsageContent({ usage }: { readonly usage: Usage }) {
  const { totals, billing, evals } = usage
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-4 gap-2">
        <Stat
          icon={<CreditCard />}
          label="Billed"
          value={formatUsd(billing.billedUsd)}
          sub={billing.unknownUsd > 0 ? `+ ${formatUsd(billing.unknownUsd)} from before tracking` : "API keys and the AI Gateway"}
        />
        <Stat icon={<DollarSign />} label="Plan value" value={formatUsd(billing.subscriptionUsd)} sub="what your Claude plan covered" />
        <Stat icon={<AudioLines />} label="ElevenLabs" value={formatCount(totals.ttsCharacters)} sub="characters spoken" />
        <Stat icon={<Gauge />} label="Per short" value={totals.costPerShortUsd === null ? "–" : formatUsd(totals.costPerShortUsd)} sub={`${totals.shorts} made in ${usage.days} days`} />
      </div>
      <Panel title="Daily spend">
        <DailyChart days={usage.byDay} />
      </Panel>
      <div className="grid grid-cols-2 gap-2">
        <Panel title="By provider" count={usage.byProvider.length}>
          {usage.byProvider.length === 0 ? <Empty /> : usage.byProvider.map((p) => (
            <Row key={`${p.provider}-${p.billing}`} className="grid-cols-[minmax(0,1fr)_auto_auto]">
              <RowTitle title={providerLabel(p.provider)} sub={`${p.runs} ${p.runs === 1 ? "run" : "runs"}`} />
              <Status tone={p.billing === "billed" ? "wait" : "neutral"}>{billingLabel(p.billing)}</Status>
              <span className="tabular-nums">{p.ttsCharacters > 0 && p.costUsd === 0 ? `${formatCount(p.ttsCharacters)} chars` : formatUsd(p.costUsd)}</span>
            </Row>
          ))}
        </Panel>
        <Panel title="By model" count={usage.byModel.length}>
          {usage.byModel.length === 0 ? <Empty /> : usage.byModel.slice(0, 8).map((m) => (
            <Row key={m.model} className="grid-cols-[minmax(0,1fr)_auto]">
              <RowTitle
                title={m.model}
                sub={[providerLabel(m.provider), `${m.runs} ${m.runs === 1 ? "run" : "runs"}`, m.inputTokens > 0 ? `${formatCount(m.inputTokens)} in · ${formatCount(m.outputTokens)} out` : null]
                  .filter(Boolean).join(" · ")}
              />
              <span className="tabular-nums">{formatUsd(m.costUsd)}</span>
            </Row>
          ))}
        </Panel>
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
      <Panel
        title="Evals"
        count={evals.runs}
        actions={evals.runs === 0 ? undefined : <span>{formatUsd(evals.costUsd)} · {formatUsd(evals.billedUsd)} billed</span>}
      >
        {evals.byModel.length === 0
          ? <div className="px-1 py-3 text-fg-2">No model evals in this period. They’re kept apart from making shorts.</div>
          : evals.byModel.map((m) => (
            <Row key={m.model} className="grid-cols-[minmax(0,1fr)_auto]">
              <RowTitle title={m.model} sub={`${providerLabel(m.provider)} · ${m.runs} ${m.runs === 1 ? "run" : "runs"}`} />
              <span className="tabular-nums">{formatUsd(m.costUsd)}</span>
            </Row>
          ))}
      </Panel>
    </div>
  )
}

// The page's layout in grey while it loads: the stat cards, the chart's bars and the list panels.
function UsageSkeleton() {
  const bars = [0.3, 0.55, 0.2, 0.8, 0.45, 0.65, 0.35, 0.9, 0.5, 0.25, 0.7, 0.4]
  const panel = (rows: number, key: number) => (
    <section key={key} className="rounded-panel bg-panel px-4 pt-3.5 pb-4">
      <Skeleton className="mb-3.5 h-4 w-28" />
      <div className="flex flex-col gap-[3px]">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-12 items-center gap-3 rounded-ctl bg-item px-3">
            <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3 w-24" /></div>
            <Skeleton className="h-3.5 w-12" />
          </div>
        ))}
      </div>
    </section>
  )
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-panel bg-panel px-4 py-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <section className="rounded-panel bg-panel px-4 pt-3.5 pb-4">
        <Skeleton className="mb-3.5 h-4 w-28" />
        <div className="flex h-40 items-end gap-[2%]">
          {bars.map((h, i) => <Skeleton key={i} className="flex-1 rounded-[3px]" style={{ height: `${h * 100}%` }} />)}
        </div>
      </section>
      <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((k) => panel(4, k))}</div>
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
