"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { Company, FinalMatch, GameData, Team } from "../types";
import { ROUND_LABELS, PHASE_LABELS, previousPlayableRound } from "../types";
import { formatManwon } from "../format";
import {
  SettledResultsPanel,
  TicketHoldingsTable,
  AllTeamsSeedTable,
  getRoundProfitByTeam,
} from "../shared";

// 큰 화면용 읽기 전용 디스플레이. 게임 진행 중에 별도 화면에 띄워서 보여줌.
// admin 컨트롤 UI 는 없음. 폴링으로 자동 갱신.
export function DisplayView({ data }: { data: GameData }) {
  const router = useRouter();
  const resultsPanelRef = useRef<HTMLDivElement | null>(null);
  const [resultsPanelHeight, setResultsPanelHeight] = useState<number | null>(
    null,
  );

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    const element = resultsPanelRef.current;
    if (!element) return;

    const updateHeight = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      if (nextHeight <= 0) {
        setResultsPanelHeight(null);
        return;
      }
      setResultsPanelHeight((previousHeight) =>
        previousHeight !== null && Math.abs(previousHeight - nextHeight) < 1
          ? previousHeight
          : nextHeight,
      );
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  const state = data.state;
  const displayTeams = getDisplaySeedTeams(data);
  const totalSeed = displayTeams.reduce((sum, team) => sum + team.seed, 0);
  const ticketTotal = data.tickets.reduce((sum, ticket) => sum + ticket.count, 0);
  const seedProfitByTeam =
    state?.current_phase === "results"
      ? getRoundProfitByTeam(
          data.investments,
          data.roundResults,
          state.current_round,
        )
      : undefined;
  const matchingResultRound =
    state?.current_phase === "idle"
      ? previousPlayableRound(state.current_round)
      : null;

  return (
    <main className="page-shell max-w-7xl">
      <header className="surface-panel mb-4 overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_1.4fr]">
          <div className="bg-[#151713] p-5 text-white sm:p-6">
            <p className="text-xs font-semibold uppercase text-[#b7c4b2]">
              GRAFFITI2026 Investment Game
            </p>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
              {state ? ROUND_LABELS[state.current_round] : "-"}
            </h1>
            <div className="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1.5 text-lg font-black">
              {state ? PHASE_LABELS[state.current_phase] : "-"}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 bg-[#fbfcfa] p-3 sm:grid-cols-4 sm:p-4">
            <DisplayMetric label="총 seed" value={formatManwon(totalSeed)} />
            <DisplayMetric label="참가 팀" value={`${data.teams.length}팀`} />
            <DisplayMetric label="회사" value={`${data.companies.length}개`} />
            <DisplayMetric label="매칭권" value={`${ticketTotal}개`} />
          </div>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:items-start">
        <div
          className="min-h-0 xl:h-[var(--results-panel-height)]"
          style={
            resultsPanelHeight
              ? ({
                  "--results-panel-height": `${resultsPanelHeight}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <AllTeamsSeedTable
            teams={displayTeams}
            profitByTeam={seedProfitByTeam}
            scroll
          />
        </div>
        <div ref={resultsPanelRef}>
          <SettledResultsPanel
            companies={data.companies}
            teams={data.teams}
            investments={data.investments}
            roundResults={data.roundResults}
            flush
          />
        </div>
      </div>

      {/* 최종 팀 매칭 결과 (final-result / ended) */}
      {(state?.current_round === "final" &&
        state?.current_phase === "final-result") ||
      state?.current_round === "ended" ? (
        <FinalMatchDisplayPanel
          companies={data.companies}
          teams={data.teams}
          finalMatches={data.finalMatches}
        />
      ) : null}

      {/* 매칭권 보유 현황은 평소엔 자주 안 보지만, 필요할 때 큰 화면에서 한눈에 보려고 맨 아래 가로 풀폭으로 둠. */}
      <TicketHoldingsTable
        companies={data.companies}
        teams={data.teams}
        tickets={data.tickets}
        matchingResults={data.matchingResults}
        deltaRound={matchingResultRound}
      />
    </main>
  );
}

// 최종 팀 매칭 결과 — 큰 화면용 가로 그리드
function FinalMatchDisplayPanel({
  companies,
  teams,
  finalMatches,
}: {
  companies: Company[];
  teams: Team[];
  finalMatches: FinalMatch[];
}) {
  const byCompany = new Map<number, FinalMatch[]>();
  for (const m of finalMatches) {
    const list = byCompany.get(m.company_id) ?? [];
    list.push(m);
    byCompany.set(m.company_id, list);
  }
  const matched = new Set(finalMatches.map((m) => m.team_username));
  const unmatched = teams.map((t) => t.username).filter((u) => !matched.has(u));

  return (
    <section className="surface-panel panel-pad mb-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="eyebrow">Final Result</p>
          <h2 className="text-2xl font-black">🎨 최종 팀 매칭 결과</h2>
        </div>
        <div className="muted-label">
          매칭 완료 {finalMatches.length}팀 · 미배정 {unmatched.length}팀
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {companies.map((c) => {
          const list = (byCompany.get(c.id) ?? []).sort(
            (a, b) => a.matched_rank - b.matched_rank,
          );
          return (
            <div
              key={c.id}
              className="rounded-lg border-2 border-[#dfe4dc] bg-white p-4"
            >
              <div className="mb-2 flex items-baseline justify-between border-b border-[#dfe4dc] pb-2">
                <div className="text-xl font-black">{c.name}</div>
                <div className="muted-label">
                  {list.length}/{c.max_slots}팀
                </div>
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-[#8a9488]">배정 없음</p>
              ) : (
                <ul className="space-y-1">
                  {list.map((m) => (
                    <li key={m.team_username} className="text-base font-mono">
                      <span className="font-semibold">{m.team_username}</span>{" "}
                      <span className="text-xs text-[#667065]">
                        · {m.matched_rank}지망
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {unmatched.length > 0 && (
        <div className="mt-4 rounded border border-dashed border-[#cfd7cc] bg-[#fbfcfa] p-3">
          <div className="muted-label mb-1">미배정 팀</div>
          <div className="text-sm font-mono">{unmatched.join(", ")}</div>
        </div>
      )}
    </section>
  );
}

function DisplayMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#dfe4dc] bg-white px-3 py-2">
      <div className="muted-label">{label}</div>
      <div className="mt-1 text-lg font-black tabular-nums sm:text-xl">
        {value}
      </div>
    </div>
  );
}

// stock / matching 단계 진입 시 서버에서 teams.display_seed 로 박제된 값을 사용.
// 다른 단계(idle / results) 는 실시간 seed 그대로.
// 스냅샷이 아직 없는 회사(예: 마이그레이션 직후) 는 실시간 seed 로 자연스럽게 fallback.
function getDisplaySeedTeams(data: GameData): Team[] {
  const state = data.state;
  if (!state) return data.teams;

  const useSnapshot =
    state.current_phase === "stock" || state.current_phase === "matching";
  if (!useSnapshot) return data.teams;

  return data.teams.map((team) => ({
    ...team,
    seed:
      team.display_seed !== null && team.display_seed !== undefined
        ? team.display_seed
        : team.seed,
  }));
}
