"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  playerSetInvestment,
  playerClearInvestment,
  playerSetBid,
  playerClearBid,
  playerSellTickets,
  type ActionResult,
} from "@/app/actions/player";
import type { Bid, Company, GameData, Investment, Ticket } from "./types";
import { ROUND_LABELS, PHASE_LABELS, previousPlayableRound } from "./types";
import {
  SettledResultsPanel,
  TicketHoldingsTable,
  formatSignedManwon,
  moneyDeltaClass,
} from "./shared";
import { formatManwon, manwonToWon, wonToManwon, MANWON } from "./format";

type RunFn = (
  fn: () => Promise<ActionResult | unknown>,
) => Promise<void>;

function isError(result: unknown): string | null {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    typeof (result as { error?: unknown }).error === "string" &&
    (result as { error: string }).error
  ) {
    return (result as { error: string }).error;
  }
  return null;
}

export function PlayerView({
  data,
  username,
}: {
  data: GameData;
  username: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router]);

  const run: RunFn = async (fn) => {
    setError(null);
    try {
      const result = await fn();
      const err = isError(result);
      if (err) {
        setError(err);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const state = data.state;
  const myTeam = data.teams.find((t) => t.username === username) ?? null;
  const myTickets = data.tickets.filter((t) => t.team_username === username);
  // 내 시드 순위 계산 (seed 내림차순, 동률이면 같은 등수)
  const sortedSeeds = [...data.teams]
    .map((t) => t.seed)
    .sort((a, b) => b - a);
  const myRank =
    myTeam !== null
      ? sortedSeeds.findIndex((s) => s <= myTeam.seed) + 1
      : null;
  const myCurrentInvestments = state
    ? data.investments.filter(
        (i) =>
          i.round === state.current_round && i.team_username === username,
      )
    : [];
  const matchingResultRound =
    state?.current_phase === "idle"
      ? previousPlayableRound(state.current_round)
      : null;

  return (
    <main className="page-shell max-w-5xl space-y-6">
      <PlayerStatusHeader
        username={username}
        seed={myTeam?.seed}
        rank={myRank}
        totalTeams={data.teams.length}
        round={state ? ROUND_LABELS[state.current_round] : "-"}
        phase={state ? PHASE_LABELS[state.current_phase] : "-"}
        activePhase={state?.current_phase}
        ticketCount={myTickets.reduce((sum, t) => sum + t.count, 0)}
      />

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-[#fca5a5] bg-[#fee4e2] px-4 py-3 text-sm font-semibold text-[#b42318]">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="rounded-md px-2 py-1 hover:bg-white/50"
          >
            x
          </button>
        </div>
      )}

      {!myTeam && (
        <section className="surface-panel panel-pad border-[#f59e0b]/40 bg-[#fffbeb]">
          <p className="text-sm font-semibold text-[#92400e]">
            아직 admin 이 이 팀의 초기 seed 를 설정하지 않았습니다.
          </p>
        </section>
      )}

      {state?.current_phase === "stock" && myTeam && (
        <InvestSection
          companies={data.companies}
          investments={myCurrentInvestments}
          seed={myTeam.seed}
          run={run}
        />
      )}

      {state?.current_phase === "matching" && myTeam && (
        <BidSection
          companies={data.companies}
          bids={data.bids}
          seed={myTeam.seed}
          run={run}
        />
      )}

      {state?.current_phase === "matching" && myTeam && (
        <SellSection
          companies={data.companies}
          tickets={myTickets}
          run={run}
        />
      )}

      {state &&
        state.current_phase !== "stock" &&
        state.current_phase !== "matching" && (
          <PassivePhasePanel phase={PHASE_LABELS[state.current_phase]} />
        )}

      <MyResultsPanel data={data} username={username} />

      <SettledResultsPanel
        companies={data.companies}
        teams={data.teams}
        investments={data.investments}
        roundResults={data.roundResults}
      />

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

function PlayerStatusHeader({
  username,
  seed,
  rank,
  totalTeams,
  round,
  phase,
  activePhase,
  ticketCount,
}: {
  username: string;
  seed: number | undefined;
  rank: number | null;
  totalTeams: number;
  round: string;
  phase: string;
  activePhase: string | undefined;
  ticketCount: number;
}) {
  return (
    <section className="surface-panel overflow-hidden">
      <div className="border-b border-[#dfe4dc] bg-[#fbfcfa] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Player Console</p>
            <h1 className="text-2xl font-semibold sm:text-3xl">
              {username}
            </h1>
          </div>
          <div className="phase-pill phase-pill-active">
            {round} / {phase}
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="metric-card">
          <div className="muted-label">보유 seed</div>
          <div className="mt-1 text-3xl font-black">
            {seed !== undefined ? formatManwon(seed) : "-"}
          </div>
        </div>
        <div className="metric-card">
          <div className="muted-label">시드 순위</div>
          <div className="mt-1 text-3xl font-black tabular-nums">
            {rank !== null ? `${rank}위` : "-"}
            <span className="ml-1 text-base font-semibold text-[#667065]">
              / {totalTeams}팀
            </span>
          </div>
        </div>
        <div className="metric-card">
          <div className="muted-label">현재 라운드</div>
          <div className="mt-1 text-2xl font-black">{round}</div>
        </div>
        <div className="metric-card">
          <div className="muted-label">보유 매칭권</div>
          <div className="mt-1 text-2xl font-black tabular-nums">
            {ticketCount}개
          </div>
        </div>
      </div>
      <PhaseTimeline activePhase={activePhase} />
    </section>
  );
}

function PhaseTimeline({ activePhase }: { activePhase: string | undefined }) {
  const phases = [
    { id: "idle", label: "대기" },
    { id: "stock", label: "투자" },
    { id: "results", label: "결과" },
    { id: "matching", label: "매칭권" },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto border-t border-[#dfe4dc] px-5 py-4">
      {phases.map((p) => (
        <span
          key={p.id}
          className={
            "phase-pill shrink-0 " +
            (activePhase === p.id ? "phase-pill-active" : "")
          }
        >
          {p.label}
        </span>
      ))}
    </div>
  );
}

function PassivePhasePanel({ phase }: { phase: string }) {
  return (
    <section className="surface-panel panel-pad">
      <p className="eyebrow">Current Phase</p>
      <h2 className="mt-1 text-xl font-black">{phase}</h2>
      <p className="mt-2 text-sm text-[#667065]">
        지금은 입력 가능한 액션이 없습니다.
      </p>
    </section>
  );
}

// ===== 주식 단계: 투자하기 =====

function InvestSection({
  companies,
  investments,
  seed,
  run,
}: {
  companies: Company[];
  investments: Investment[];
  seed: number;
  run: RunFn;
}) {
  const investedTotal = investments.reduce((s, i) => s + i.amount, 0);

  return (
    <section className="surface-panel panel-pad">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Stock Phase</p>
          <h2 className="text-2xl font-black">투자하기</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="phase-pill">남은 seed {formatManwon(seed)}</span>
          <span className="phase-pill">
            투자 합계 {formatManwon(investedTotal)}
          </span>
        </div>
      </div>

      {companies.length === 0 ? (
        <p className="text-sm text-[#667065]">아직 등록된 회사가 없습니다.</p>
      ) : (
        <div className="grid gap-3">
          {companies.map((c) => {
            const inv = investments.find((i) => i.company_id === c.id);
            return (
              <InvestRow
                key={`${c.id}-${inv?.amount ?? 0}`}
                company={c}
                currentAmount={inv?.amount ?? 0}
                run={run}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function InvestRow({
  company,
  currentAmount,
  run,
}: {
  company: Company;
  currentAmount: number;
  run: RunFn;
}) {
  const [v, setV] = useState(String(wonToManwon(currentAmount)));

  return (
    <div className="market-row">
      <div className="grid gap-3 lg:grid-cols-[1fr_160px_260px] lg:items-center">
        <div>
          <div className="text-lg font-black">{company.name}</div>
          <div className="muted-label">
            현재 투자 {formatManwon(currentAmount)}
          </div>
        </div>
        <label className="block">
          <span className="muted-label">투자 금액</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              value={v}
              onChange={(e) => setV(e.target.value)}
              className="field-input w-full"
              min={0}
            />
            <span className="text-sm font-semibold text-[#667065]">만원</span>
          </div>
        </label>
        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
          <button
            type="button"
            onClick={() =>
              run(() =>
                playerSetInvestment(company.id, manwonToWon(Number(v))),
              )
            }
            className="btn-primary"
          >
            저장
          </button>
          {currentAmount > 0 && (
            <button
              type="button"
              onClick={() => run(() => playerClearInvestment(company.id))}
              className="btn-danger"
            >
              취소
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== 매칭권 단계: 입찰하기 =====

function BidSection({
  companies,
  bids,
  seed,
  run,
}: {
  companies: Company[];
  bids: Bid[];
  seed: number;
  run: RunFn;
}) {
  const bidTotal = bids.reduce((s, b) => s + b.price * b.count, 0);

  return (
    <section className="surface-panel panel-pad">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Matching Phase</p>
          <h2 className="text-2xl font-black">매칭권 구매</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="phase-pill">남은 seed {formatManwon(seed)}</span>
          <span className="phase-pill">입찰 금액 {formatManwon(bidTotal)}</span>
        </div>
      </div>

      {companies.length === 0 ? (
        <p className="text-sm text-[#667065]">아직 등록된 회사가 없습니다.</p>
      ) : (
        <div className="grid gap-3">
          {companies.map((c) => {
            const bid = bids.find((b) => b.company_id === c.id);
            return (
              <BidRow
                key={`${c.id}-${bid?.price ?? 0}-${bid?.count ?? 0}`}
                company={c}
                currentBid={bid ?? null}
                run={run}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function BidRow({
  company,
  currentBid,
  run,
}: {
  company: Company;
  currentBid: Bid | null;
  run: RunFn;
}) {
  const [priceManwon, setPriceManwon] = useState(
    currentBid ? String(wonToManwon(currentBid.price)) : "",
  );
  const [count, setCount] = useState(
    currentBid ? String(currentBid.count) : "",
  );

  const priceManwonNum = Number(priceManwon);
  const countNum = Number(count);
  const priceValid =
    priceManwon.trim() !== "" && Number.isFinite(priceManwonNum);
  const countValid =
    count.trim() !== "" && Number.isInteger(countNum) && countNum >= 1;
  const priceWon = manwonToWon(priceManwonNum);
  const tooLow = priceValid && priceWon < company.min_order_price;
  const costWon = (priceValid ? priceWon : 0) * (countValid ? countNum : 0);
  const canBid = priceValid && countValid && !tooLow;

  return (
    <div className="market-row">
      <div className="grid gap-3 xl:grid-cols-[1fr_190px_120px_260px] xl:items-center">
        <div>
          <div className="text-lg font-black">{company.name}</div>
          <div className="muted-label">
            최소 {formatManwon(company.min_order_price)}
          </div>
          <div className="mt-1 text-sm text-[#667065]">
            {currentBid
              ? `현재 ${formatManwon(currentBid.price)} x ${currentBid.count}개`
              : "현재 입찰 없음"}
          </div>
        </div>
        <label className="block">
          <span className="muted-label">가격</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              placeholder="가격"
              value={priceManwon}
              onChange={(e) => setPriceManwon(e.target.value)}
              className="field-input w-full"
              min={0}
            />
            <span className="text-sm font-semibold text-[#667065]">만원</span>
          </div>
        </label>
        <label className="block">
          <span className="muted-label">개수</span>
          <input
            type="number"
            placeholder="개수"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="field-input mt-1 w-full"
            min={1}
          />
        </label>
        <div className="flex flex-wrap items-end justify-between gap-2 xl:justify-end">
          <div className="mr-auto xl:mr-0 xl:text-right">
            <div className="muted-label">총액</div>
            <div className="text-lg font-black">{formatManwon(costWon)}</div>
            {tooLow && (
              <div className="text-sm font-semibold text-[#b42318]">
                금액이 낮습니다
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={!canBid}
            onClick={() =>
              run(() => playerSetBid(company.id, priceWon, countNum))
            }
            className="btn-primary"
          >
            입찰
          </button>
          {currentBid && (
            <button
              type="button"
              onClick={() => run(() => playerClearBid(company.id))}
              className="btn-danger"
            >
              취소
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== 매칭권 단계: 판매하기 (80% 환불) =====

function SellSection({
  companies,
  tickets,
  run,
}: {
  companies: Company[];
  tickets: Ticket[];
  run: RunFn;
}) {
  const owned = companies
    .map((c) => ({
      company: c,
      count: tickets.find((t) => t.company_id === c.id)?.count ?? 0,
    }))
    .filter((o) => o.count > 0);

  return (
    <section className="surface-panel panel-pad">
      <div className="mb-5">
        <p className="eyebrow">Ticket Market</p>
        <h2 className="text-2xl font-black">매칭권 판매</h2>
      </div>
      {owned.length === 0 ? (
        <p className="text-sm text-[#667065]">보유한 매칭권이 없습니다.</p>
      ) : (
        <div className="grid gap-3">
          {owned.map((o) => (
            <SellRow
              key={`${o.company.id}-${o.count}`}
              company={o.company}
              owned={o.count}
              run={run}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SellRow({
  company,
  owned,
  run,
}: {
  company: Company;
  owned: number;
  run: RunFn;
}) {
  const [count, setCount] = useState("");

  const countNum = Number(count);
  const countEntered = count.trim() !== "" && Number.isInteger(countNum);
  const tooMany = countEntered && countNum > owned;
  const valid = countEntered && countNum >= 1 && countNum <= owned;
  const refund = valid
    ? Math.floor((company.min_order_price * countNum * 0.8) / MANWON) * MANWON
    : 0;

  return (
    <div className="market-row">
      <div className="grid gap-3 lg:grid-cols-[1fr_140px_170px_220px] lg:items-center">
        <div>
          <div className="text-lg font-black">{company.name}</div>
          <div className="muted-label">
            보유 {owned}개 / 최소가 {formatManwon(company.min_order_price)}
          </div>
        </div>
        <label className="block">
          <span className="muted-label">판매 개수</span>
          <input
            type="number"
            placeholder="개수"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="field-input mt-1 w-full"
            min={1}
          />
        </label>
        <div>
          <div className="muted-label">예상 환불</div>
          <div className="text-lg font-black">{formatManwon(refund)}</div>
          {tooMany && (
            <div className="text-sm font-semibold text-[#b42318]">
              보유 개수보다 많습니다
            </div>
          )}
        </div>
        <div className="flex justify-start lg:justify-end">
          <button
            type="button"
            disabled={!valid}
            onClick={() => run(() => playerSellTickets(company.id, countNum))}
            className="btn-primary"
          >
            판매
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== 결과 발표: 내 팀 투자 결과 =====

function MyResultsPanel({
  data,
  username,
}: {
  data: GameData;
  username: string;
}) {
  const state = data.state;
  if (!state) return null;

  if (state.current_phase === "idle") {
    return <MyMatchingResultsPanel data={data} username={username} />;
  }

  if (state.current_phase !== "results") return null;

  const resultRound = state.current_round;

  const myInvestments = data.investments.filter(
    (i) => i.round === resultRound && i.team_username === username,
  );
  const yieldByCompany = new Map<number, number>();
  for (const rr of data.roundResults) {
    if (rr.round === resultRound) {
      yieldByCompany.set(rr.company_id, rr.yield_pct);
    }
  }
  const myTeam = data.teams.find((t) => t.username === username);
  const rows = myInvestments.map((investment) => {
    const company = data.companies.find((c) => c.id === investment.company_id);
    const yieldPct = yieldByCompany.get(investment.company_id) ?? 0;
    const payout = Math.max(
      0,
      Math.floor((investment.amount * (1 + yieldPct / 100)) / MANWON) * MANWON,
    );
    return {
      investment,
      company,
      yieldPct,
      payout,
      profit: payout - investment.amount,
    };
  });
  const totalInvested = rows.reduce((sum, row) => sum + row.investment.amount, 0);
  const totalPayout = rows.reduce((sum, row) => sum + row.payout, 0);
  const totalProfit = rows.reduce((sum, row) => sum + row.profit, 0);

  return (
    <section className="surface-panel panel-pad">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">My Results</p>
          <h2 className="text-2xl font-black">
            {ROUND_LABELS[resultRound]} 투자 정산
          </h2>
        </div>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ResultMetric
          label="총 수익"
          value={formatSignedManwon(totalProfit)}
          tone={moneyDeltaClass(totalProfit)}
        />
        <ResultMetric label="정산 후 회수" value={formatManwon(totalPayout)} />
        <ResultMetric label="투자 원금" value={formatManwon(totalInvested)} />
        <ResultMetric
          label="현재 seed"
          value={myTeam ? formatManwon(myTeam.seed) : "-"}
        />
      </div>
      {myInvestments.length === 0 ? (
        <p className="text-sm text-[#667065]">
          이 라운드에 투자한 내역이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-modern">
            <thead>
              <tr>
                <th>회사</th>
                <th className="text-right">내 투자액</th>
                <th className="text-right">수익률</th>
                <th className="text-right">정산 후 회수액</th>
                <th className="text-right">수익</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.investment.company_id}>
                  <td className="font-semibold">
                    {row.company?.name ?? row.investment.company_id}
                  </td>
                  <td className="text-right font-semibold">
                    {formatManwon(row.investment.amount)}
                  </td>
                  <td
                    className={
                      "text-right font-black tabular-nums " +
                      (row.yieldPct > 0
                        ? "text-[#166534]"
                        : row.yieldPct < 0
                          ? "text-[#991b1b]"
                          : "text-[#4e584d]")
                    }
                  >
                    {row.yieldPct > 0 ? "+" : ""}
                    {row.yieldPct}%
                  </td>
                  <td className="text-right font-black">
                    {formatManwon(row.payout)}
                  </td>
                  <td
                    className={
                      "text-right font-black tabular-nums " +
                      moneyDeltaClass(row.profit)
                    }
                  >
                    {formatSignedManwon(row.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResultMetric({
  label,
  value,
  tone = "text-[#151713]",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-[#dfe4dc] bg-[#fbfcfa] p-3">
      <div className="muted-label">{label}</div>
      <div className={"mt-1 text-xl font-black tabular-nums " + tone}>
        {value}
      </div>
    </div>
  );
}

function MyMatchingResultsPanel({
  data,
  username,
}: {
  data: GameData;
  username: string;
}) {
  const state = data.state;
  if (!state) return null;

  const resultRound = previousPlayableRound(state.current_round);
  if (!resultRound) return null;

  const myResults = data.matchingResults.filter(
    (result) =>
      result.round === resultRound && result.team_username === username,
  );
  const mySales = data.ticketSales.filter(
    (sale) => sale.round === resultRound && sale.team_username === username,
  );
  const companyIds = Array.from(
    new Set([
      ...myResults.map((result) => result.company_id),
      ...mySales.map((sale) => sale.company_id),
    ]),
  );

  return (
    <section className="surface-panel panel-pad">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">My Results</p>
          <h2 className="text-2xl font-black">
            {ROUND_LABELS[resultRound]} 매칭권 입찰 결과
          </h2>
        </div>
        <span className="phase-pill">직전 라운드</span>
      </div>
      {companyIds.length === 0 ? (
        <p className="text-sm text-[#667065]">
          직전 라운드의 매칭권 입찰 또는 판매 내역이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-modern">
            <thead>
              <tr>
                <th>회사</th>
                <th className="text-right">최소 주문 금액</th>
                <th className="text-right">성공 / 입찰</th>
                <th className="text-right">판매 환급</th>
              </tr>
            </thead>
            <tbody>
              {companyIds.map((companyId) => {
                const company = data.companies.find((c) => c.id === companyId);
                const result = myResults.find(
                  (item) => item.company_id === companyId,
                );
                const sale = mySales.find(
                  (item) => item.company_id === companyId,
                );
                const beforeMinOrder =
                  result?.min_order_price ??
                  sale?.min_order_price ??
                  company?.min_order_price ??
                  0;
                const afterMinOrder = company?.min_order_price ?? beforeMinOrder;

                return (
                  <tr key={companyId}>
                    <td className="font-semibold">
                      {company?.name ?? companyId}
                    </td>
                    <td className="text-right font-semibold tabular-nums">
                      {beforeMinOrder !== afterMinOrder ? (
                        <>
                          {formatManwon(beforeMinOrder)} -&gt;{" "}
                          {formatManwon(afterMinOrder)}
                        </>
                      ) : (
                        formatManwon(afterMinOrder)
                      )}
                    </td>
                    <td className="text-right font-black tabular-nums">
                      {result
                        ? `${result.awarded_count} / ${result.bid_count}`
                        : "-"}
                    </td>
                    <td className="text-right font-black tabular-nums">
                      {sale
                        ? `${formatManwon(sale.refund_amount)} (${sale.count}개)`
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
