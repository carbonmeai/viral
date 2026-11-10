import { Segmented } from "@viral/ui/primitives/segmented"
import { Panel } from "../panel.tsx"
import { NothingToInspect, NotYet } from "../step-parts.tsx"
import type { EditorState } from "../use-editor-state.ts"
import { RANKING_VIEWS, RankingInspector, type RankingTab } from "./ranking-inspector.tsx"
import { RankingStage } from "./ranking-stage.tsx"
import { changeCount, type RankingDraft, totalSeconds } from "./ranking-values.ts"

// The selected entry's rank: the one you picked when it's still in the ranking, else the entry that plays last.
const selectedRank = (e: EditorState, ranking: RankingDraft) =>
  ranking.entries.some((x) => x.rank === e.rankingRank) ? e.rankingRank : ranking.order.at(-1) ?? 1

// The Ranking step's player (rankings): the selected entry.
export function RankingStepStage({ e }: { readonly e: EditorState }) {
  const ranking = e.ranking
  if (ranking === null || (e.ws.rankingSource ?? null) === null || e.rankingPlan === null) return <NotYet e={e} what="ranking" />
  return (
    <>
      <RankingStage
        draft={ranking}
        selected={selectedRank(e, ranking)}
        onSelect={e.setRankingRank}
        stillOf={e.rankingStillOf}
        videoUrlOf={e.videoUrlOf}
        videos={e.ws.videos.length}
      />
    </>
  )
}

export const rankingNote = (e: EditorState) =>
  e.ranking === null ? null : `${e.ranking.entries.length} entries · ${(e.rankingLength ?? totalSeconds(e.ranking)).toFixed(1)}s`

// The Ranks panel: the ranks (#1 first) with each entry's moments, or the title and play order, with your changes
// snapped by the server and collected as one edit.
export function RankingStepPanel({ e }: { readonly e: EditorState }) {
  const ranking = e.ranking
  const source = e.ws.rankingSource ?? null
  const plan = e.rankingPlan
  if (ranking === null || source === null || plan === null) return <Panel title="Ranks"><NothingToInspect /></Panel>
  return (
    <Panel title="Ranks" under={<Segmented<RankingTab> label="Ranks view" full value={e.rankingTab} onChange={e.setRankingTab} options={RANKING_VIEWS} />}>
    <RankingInspector
      draft={ranking}
      onDraft={e.editRanking}
      changes={e.rankingPlanDraft === null ? 0 : changeCount(e.rankingPlanDraft, ranking)}
      source={source}
      warnings={e.rankingDraft === null ? plan.plan.warnings : []}
      selected={selectedRank(e, ranking)}
      onSelect={e.setRankingRank}
      stillOf={e.rankingStillOf}
      videos={e.pickerVideos}
      stillUrl={e.videoStillUrl}
      durationS={e.rankingDraft === null ? plan.plan.durationS : e.rankingLength ?? totalSeconds(ranking)}
      problems={e.rankingProblems}
      checking={e.rankingChecking}
      onRevert={() => {
        e.setRankingDraft(null)
        e.setRankingProblems([])
        e.setRankingLength(null)
      }}
      onSend={() => {
        void e.gateFor("moments").edit(ranking).then((refused) => {
          e.setRankingProblems(refused)
          if (refused.length === 0) {
            e.setRankingDraft(null)
            e.setRankingLength(null)
          }
        })
      }}
      stages={e.stages}
      gate={e.gateFor("moments")}
      tab={e.rankingTab}
      onTab={e.setRankingTab}
    />
    </Panel>
  )
}
