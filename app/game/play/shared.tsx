"use client";

import { useState } from "react";
import type {
  Company,
  Investment,
  MatchingResult,
  Round,
  RoundResult,
  Team,
  Ticket,
} from "./types";
import { ROUND_LABELS, compareUsernames, latestSettledRound } from "./types";
import { formatManwon } from "./format";

export const TEAM_COLORS = [
  "#222222",
  "#F3C300",
  "#875692",
  "#F38400",
  "#A1CAF1",
  "#BE0032",
  "#848482",
  "#008856",
  "#E68FAC",
  "#0067A5",
  "#F99379",
  "#604E97",
  "#F6A600",
  "#B3446C",
  "#DCD300",
  "#882D17",
  "#8DB600",
  "#654522",
  "#E25822",
  "#2B3D26",
  "#4B5F81",
];

export type InvestmentSegment = {
  team: string;
  value: number;
  color: string;
};

export type InvestmentBar = {
  label: string;
  value: number;
  yieldPct: number;
  segments: InvestmentSegment[];
};

type HoverTarget = {
  key: string;
  company: string;
  team: string;
  pct: number;
  value: number;
};

function formatYieldPct(value: number): string {
  if (value > 0) return `+${value}%`;
  return `${value}%`;
}

function yieldBadgeClass(value: number): string {
  if (value > 0) {
    return "border-[#86efac] bg-[#dcfce7] text-[#166534]";
  }
  if (value < 0) {
    return "border-[#fca5a5] bg-[#fee2e2] text-[#991b1b]";
  }
  return "border-[#cfd7cc] bg-white text-[#4e584d]";
}

export function formatSignedManwon(value: number): string {
  if (value > 0) return `+${formatManwon(value)}`;
  if (value < 0) return `-${formatManwon(Math.abs(value))}`;
  return formatManwon(0);
}

export function moneyDeltaClass(value: number): string {
  if (value > 0) return "text-[#166534]";
  if (value < 0) return "text-[#991b1b]";
  return "text-[#4e584d]";
}

export function getRoundProfitByTeam(
  investments: Investment[],
  roundResults: RoundResult[],
  round: Round,
): Map<string, number> {
  const yieldByCompany = new Map<number, number>();
  for (const rr of roundResults) {
    if (rr.round === round) {
      yieldByCompany.set(rr.company_id, rr.yield_pct);
    }
  }

  const profitByTeam = new Map<string, number>();
  for (const investment of investments) {
    if (investment.round !== round) continue;
    const yieldPct = yieldByCompany.get(investment.company_id) ?? 0;
    const payout = Math.max(
      0,
      Math.floor((investment.amount * (1 + yieldPct / 100)) / 10000) * 10000,
    );
    profitByTeam.set(
      investment.team_username,
      (profitByTeam.get(investment.team_username) ?? 0) +
        (payout - investment.amount),
    );
  }
  return profitByTeam;
}

// ===== 회사별 투자 금액 막대 그래프 (팀별 고정 색상 누적 막대) =====

export function InvestmentBarChart({ bars }: { bars: InvestmentBar[] }) {
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const total = bars.reduce((s, x) => s + x.value, 0);
  const max = Math.max(...bars.map((b) => b.value), 0);
  const legendItems = Array.from(
    new Map(
      bars
        .flatMap((bar) => bar.segments)
        .filter((segment) => segment.value > 0)
        .map((segment) => [segment.team, segment]),
    ).values(),
  );

  if (bars.length === 0 || total <= 0 || max <= 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-[#cfd7cc] bg-[#fbfcfa] text-sm font-semibold text-[#8a9488]">
        투자 없음
      </div>
    );
  }

  return (
    <div
      className="relative rounded-lg border border-[#dfe4dc] bg-[#fbfcfa] p-4"
      onMouseLeave={() => setHover(null)}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black">총 투자 {formatManwon(total)}</div>
          <div className="muted-label">최대 투자액 기준 상대 길이</div>
        </div>
        <span className="phase-pill">{bars.length}개 회사</span>
      </div>
      <div className="space-y-3">
        {bars.map((bar) => {
          const share = (bar.value / total) * 100;
          const width = bar.value > 0 ? Math.max((bar.value / max) * 100, 2) : 0;
          return (
            <div
              key={bar.label}
              className="grid gap-2 sm:grid-cols-[minmax(6.5rem,0.65fr)_minmax(12rem,2fr)_6rem_7rem] sm:items-center"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-[#151713]">
                  {bar.label}
                </div>
                <div className="muted-label">전체 비중 {share.toFixed(1)}%</div>
              </div>
              <div className="h-9 rounded-md bg-white p-1 shadow-inner shadow-[#dfe4dc]/50">
                <div
                  className="flex h-full overflow-hidden rounded-[4px] transition-all"
                  style={{ width: `${width}%` }}
                >
                  {bar.segments
                    .filter((segment) => segment.value > 0)
                    .map((segment) => {
                      const segmentKey = `${bar.label}:${segment.team}`;
                      const segmentPct = (segment.value / bar.value) * 100;
                      return (
                        <div
                          key={segmentKey}
                          className="h-full min-w-[2px] transition-opacity"
                          style={{
                            width: `${segmentPct}%`,
                            background: segment.color,
                            opacity:
                              hover === null || hover.key === segmentKey
                                ? 1
                                : 0.36,
                          }}
                          onMouseEnter={() =>
                            setHover({
                              key: segmentKey,
                              company: bar.label,
                              team: segment.team,
                              pct: segmentPct,
                              value: segment.value,
                            })
                          }
                          onFocus={() =>
                            setHover({
                              key: segmentKey,
                              company: bar.label,
                              team: segment.team,
                              pct: segmentPct,
                              value: segment.value,
                            })
                          }
                        />
                      );
                  })}
                </div>
              </div>
              <div className="flex justify-start sm:justify-center">
                <span
                  className={
                    "inline-flex w-20 justify-center rounded-md border px-2 py-1 text-sm font-black tabular-nums " +
                    yieldBadgeClass(bar.yieldPct)
                  }
                >
                  {formatYieldPct(bar.yieldPct)}
                </span>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-sm font-black tabular-nums">
                    {formatManwon(bar.value)}
                </div>
                <div className="muted-label">총 투자</div>
              </div>
            </div>
          );
        })}
      </div>
      {legendItems.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-2 border-t border-[#dfe4dc] pt-3">
          {legendItems.map((segment) => (
            <div
              key={segment.team}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#4e584d]"
            >
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ background: segment.color }}
              />
              <span>{segment.team}</span>
            </div>
          ))}
        </div>
      )}
      {hover !== null && (
        <BarTooltip
          company={hover.company}
          team={hover.team}
          pct={hover.pct}
          value={hover.value}
        />
      )}
    </div>
  );
}

function BarTooltip({
  company,
  team,
  pct,
  value,
}: {
  company: string;
  team: string;
  pct: number;
  value: number;
}) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 whitespace-nowrap rounded-md bg-[#151713] px-2 py-1 text-xs font-semibold text-white shadow-lg">
      {company} · {team} · {pct.toFixed(1)}% · {formatManwon(value)}
    </div>
  );
}

// ===== 직전 정산 결과 패널 (회사별 수익률 + 투자 금액 막대 그래프) =====

export function SettledResultsPanel({
  companies,
  teams,
  investments,
  roundResults,
  flush = false,
}: {
  companies: Company[];
  teams: Team[];
  investments: Investment[];
  roundResults: RoundResult[];
  flush?: boolean;
}) {
  const settledRound = latestSettledRound(roundResults);
  if (!settledRound) return null;

  const roundInvestments = investments.filter((i) => i.round === settledRound);
  const yieldByCompany = new Map<number, number>();
  for (const rr of roundResults) {
    if (rr.round === settledRound) {
      yieldByCompany.set(rr.company_id, rr.yield_pct);
    }
  }
  const teamColorByUsername = new Map(
    teams.map((team, i) => [
      team.username,
      TEAM_COLORS[i % TEAM_COLORS.length],
    ]),
  );

  return (
    <section
      className={
        "surface-panel panel-pad " +
        (flush ? "" : "mb-6")
      }
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Results</p>
          <h2 className="text-xl font-black">
            {ROUND_LABELS[settledRound]} 라운드 정산
          </h2>
        </div>
        <span className="phase-pill">회사별 투자 금액</span>
      </div>
      <p className="sr-only">
        막대 그래프에 마우스를 올리면 회사, 팀, 비율, 금액을 확인할 수 있습니다.
      </p>
      {companies.length === 0 ? (
        <p className="text-sm text-[#667065]">회사가 없습니다.</p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-[#667065]">팀이 없습니다.</p>
      ) : (
        <InvestmentBarChart
          bars={companies.map((c) => {
            const companyInvestments = roundInvestments.filter(
              (i) => i.company_id === c.id,
            );
            return {
              label: c.name,
              value: companyInvestments.reduce((s, i) => s + i.amount, 0),
              yieldPct: yieldByCompany.get(c.id) ?? 0,
              segments: teams.map((team) => ({
                team: team.username,
                value:
                  companyInvestments.find(
                    (i) => i.team_username === team.username,
                  )?.amount ?? 0,
                color: teamColorByUsername.get(team.username) ?? TEAM_COLORS[0],
              })),
            };
          })}
        />
      )}
    </section>
  );
}

// ===== 매칭권 보유 현황 (팀 × 회사 매트릭스, 읽기 전용) =====

export function TicketHoldingsTable({
  companies,
  teams,
  tickets,
  matchingResults = [],
  deltaRound = null,
}: {
  companies: Company[];
  teams: Team[];
  tickets: Ticket[];
  matchingResults?: MatchingResult[];
  deltaRound?: Round | null;
}) {
  if (teams.length === 0 || companies.length === 0) return null;

  const get = (u: string, cid: number) =>
    tickets.find((t) => t.team_username === u && t.company_id === cid)?.count ??
    0;
  const deltaResults = deltaRound
    ? matchingResults.filter((result) => result.round === deltaRound)
    : [];
  const getDelta = (u: string, cid: number) =>
    deltaResults.find(
      (result) => result.team_username === u && result.company_id === cid,
    )?.awarded_count ?? 0;
  const getMinOrderSnapshot = (cid: number) =>
    deltaResults.find((result) => result.company_id === cid)?.min_order_price;

  return (
    <section className="surface-panel panel-pad mb-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Tickets</p>
          <h2 className="text-xl font-black">매칭권 보유 현황</h2>
          <p className="muted-label mt-1">
            각 회사 매칭권의 가격은 <strong>이번 라운드 매칭권 최소 주문 금액</strong>
            (직전 매칭권 단계 승자 중 최저가).
          </p>
        </div>
        <span className="phase-pill">개수</span>
      </div>
      <div className="overflow-x-auto">
        <table className="table-modern">
          <thead>
            <tr>
              <th>팀</th>
              {companies.map((c) => {
                const minOrderSnapshot = getMinOrderSnapshot(c.id);
                return (
                  <th key={c.id} className="min-w-32 text-right">
                    <div>{c.name}</div>
                    {minOrderSnapshot !== undefined ? (
                      <div className="mt-0.5 text-[11px] font-medium normal-case text-[#667065]">
                        최소 {formatManwon(minOrderSnapshot)} →{" "}
                        {formatManwon(c.min_order_price)}
                      </div>
                    ) : (
                      <div className="muted-label mt-0.5 font-normal">
                        {formatManwon(c.min_order_price)}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.username}>
                <td className="font-mono font-semibold">{t.username}</td>
                {companies.map((c) => {
                  const count = get(t.username, c.id);
                  const delta = getDelta(t.username, c.id);
                  return (
                    <td
                      key={c.id}
                      className="text-right font-semibold tabular-nums"
                    >
                      <span>{count}</span>
                      {delta > 0 && (
                        <span className="ml-1 font-black text-[#166534]">
                          (+{delta})
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ===== 전체 팀 시드 요약 (display 페이지용) =====

export function AllTeamsSeedTable({
  teams,
  topN,
  profitByTeam,
  scroll = false,
}: {
  teams: Team[];
  /** 상위 N팀만 표시. 생략하면 전체. */
  topN?: number;
  profitByTeam?: Map<string, number>;
  scroll?: boolean;
}) {
  const sectionClassName =
    "surface-panel panel-pad " +
    (scroll ? "flex h-full min-h-0 flex-col overflow-hidden" : "mb-6");

  if (teams.length === 0) {
    return (
      <section className={sectionClassName}>
        <h2 className="text-xl font-black">전체 팀 시드</h2>
        <p className="text-sm text-[#667065]">등록된 팀이 없습니다.</p>
      </section>
    );
  }
  const total = teams.reduce((s, t) => s + t.seed, 0);
  const sorted = [...teams].sort(
    (a, b) => b.seed - a.seed || compareUsernames(a.username, b.username),
  );
  const displayed = topN !== undefined ? sorted.slice(0, topN) : sorted;
  const showProfit = Boolean(profitByTeam);
  const totalProfit = profitByTeam
    ? teams.reduce((sum, team) => sum + (profitByTeam.get(team.username) ?? 0), 0)
    : 0;

  return (
    <section className={sectionClassName}>
      <div className="mb-4 flex shrink-0 items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Leaderboard</p>
          <h2 className="text-xl font-black">
            {topN !== undefined ? `상위 ${displayed.length}팀 시드` : "전체 팀 시드"}
          </h2>
        </div>
        <div className="text-right">
          <div className="muted-label">
            {showProfit ? "합계 / 총 수익" : `합계 (전체 ${sorted.length}팀)`}
          </div>
          <div className="text-lg font-black">{formatManwon(total)}</div>
          {showProfit && (
            <div
              className={
                "text-sm font-black tabular-nums " +
                moneyDeltaClass(totalProfit)
              }
            >
              {formatSignedManwon(totalProfit)}
            </div>
          )}
        </div>
      </div>
      <div className={scroll ? "min-h-0 flex-1 overflow-y-auto pr-1" : ""}>
        <table className="table-modern">
          <thead>
            <tr>
              <th className={scroll ? "sticky top-0 z-10 bg-white" : ""}>
                순위
              </th>
              <th className={scroll ? "sticky top-0 z-10 bg-white" : ""}>
                팀
              </th>
              {showProfit && (
                <th
                  className={
                    "text-right " +
                    (scroll ? "sticky top-0 z-10 bg-white" : "")
                  }
                >
                  수익
                </th>
              )}
              <th
                className={
                  "text-right " +
                  (scroll ? "sticky top-0 z-10 bg-white" : "")
                }
              >
                seed
              </th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((t, idx) => (
              <tr key={t.username}>
                <td className="font-black tabular-nums">{idx + 1}</td>
                <td className="font-mono font-semibold">{t.username}</td>
                {showProfit && (
                  <td
                    className={
                      "text-right font-black tabular-nums " +
                      moneyDeltaClass(profitByTeam?.get(t.username) ?? 0)
                    }
                  >
                    {formatSignedManwon(profitByTeam?.get(t.username) ?? 0)}
                  </td>
                )}
                <td className="text-right font-black">{formatManwon(t.seed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
