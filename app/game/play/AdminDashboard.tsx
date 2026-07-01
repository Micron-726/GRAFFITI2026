"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setGameState,
  setGameConfig,
  advanceToNextPhase,
  resetGame,
  addCompany,
  updateCompany,
  deleteCompany,
  reorderCompanies,
  setTeamSeed,
  deleteTeam,
  setTeamTickets,
  setInvestment,
  clearInvestment,
  setBid,
  clearBid,
  awardBid,
  refundFailedBid,
  sellTickets,
  type ActionResult,
} from "@/app/actions/admin";
import type {
  Bid,
  Company,
  GameData,
  GameState,
  Investment,
  Phase,
  Round,
  Team,
  Ticket,
} from "./types";
import {
  ROUND_LABELS,
  PHASE_LABELS,
  compareUsernames,
  describeNext,
} from "./types";
import { SettledResultsPanel, TicketHoldingsTable } from "./shared";
import { formatManwon, manwonToWon, wonToManwon, MANWON } from "./format";

type RunFn = (
  action: () => Promise<ActionResult | unknown>,
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

export function AdminDashboard({ data }: { data: GameData }) {
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

  if (!data.state) {
    return (
      <main className="max-w-2xl mx-auto px-5 py-10">
        <h1 className="text-2xl font-bold mb-4">게임 상태가 없습니다</h1>
        <p className="text-sm">
          <code>npm run db:init</code> 을 다시 실행해 주세요.
        </p>
      </main>
    );
  }

  const state = data.state;
  const phase = state.current_phase;

  return (
    <main className="max-w-6xl mx-auto px-5 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Admin 대시보드</h1>
        <Link
          href="/game/play/display"
          target="_blank"
          rel="noopener"
          className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded text-sm hover:bg-indigo-200"
        >
          큰 화면용 디스플레이 열기 ↗
        </Link>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-100 border border-red-300 rounded flex justify-between items-center">
          <span className="text-red-800 text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-800 font-bold px-2"
            type="button"
          >
            ×
          </button>
        </div>
      )}

      <GameStateSection
        key={`gs-${state.current_round}-${state.current_phase}`}
        state={state}
        run={run}
      />
      <GameConfigSection
        key={`gc-${state.team_count}-${state.avg_initial_seed}-${state.matching_top_n}`}
        state={state}
        run={run}
      />
      <CompaniesSection companies={data.companies} run={run} />
      <TeamsSection
        teams={data.teams}
        companies={data.companies}
        tickets={data.tickets}
        configuredUsernames={data.configuredUsernames}
        run={run}
      />

      {phase === "stock" && (
        <StockPhaseSection
          round={state.current_round}
          teams={data.teams}
          companies={data.companies}
          investments={data.investments}
          run={run}
        />
      )}

      {phase === "matching" && (
        <MatchingPhaseSection
          teams={data.teams}
          companies={data.companies}
          bids={data.bids}
          tickets={data.tickets}
          topN={state.matching_top_n}
          run={run}
        />
      )}

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
      />

      <AdvanceButton state={state} run={run} />
    </main>
  );
}

// ============================================================
// 다음 단계로 넘어가기 버튼 (맨 아래 오른쪽)
// ============================================================

function AdvanceButton({ state, run }: { state: GameState; run: RunFn }) {
  const ended = state.current_round === "ended";
  const matchingNote =
    state.current_phase === "matching"
      ? `\n(매칭권 자동 정산: 회사별 가격→개수→낮은 seed 순 상위 ${state.matching_top_n}팀 확정, 나머지 50% 환불)`
      : "";
  return (
    <div className="mt-8 flex justify-end items-center gap-3">
      {!ended && (
        <span className="text-sm text-gray-600">
          다음: {describeNext(state.current_round, state.current_phase)}
          {state.current_phase === "matching" && (
            <span className="ml-2 text-amber-700">
              + 상위 {state.matching_top_n}팀 자동 확정
            </span>
          )}
        </span>
      )}
      <button
        type="button"
        disabled={ended}
        onClick={() => {
          if (
            confirm(
              `다음 단계로 넘어갈까요?\n→ ${describeNext(
                state.current_round,
                state.current_phase,
              )}${matchingNote}`,
            )
          ) {
            run(() => advanceToNextPhase());
          }
        }}
        className="px-5 py-2 bg-gray-900 text-white rounded disabled:opacity-40"
      >
        다음 단계로 넘어가기 ▶
      </button>
    </div>
  );
}

// ============================================================
// 게임 상태 (라운드/페이즈 직접 변경 - escape hatch)
// ============================================================

function GameStateSection({ state, run }: { state: GameState; run: RunFn }) {
  const [round, setRound] = useState<Round>(state.current_round);
  const [phase, setPhase] = useState<Phase>(state.current_phase);

  return (
    <section className="mb-6 p-4 border border-gray-300 rounded">
      <h2 className="text-lg font-bold mb-3">게임 상태</h2>
      <p className="mb-3 text-sm">
        현재:{" "}
        <strong>
          {ROUND_LABELS[state.current_round]} /{" "}
          {PHASE_LABELS[state.current_phase]}
        </strong>
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={round}
          onChange={(e) => setRound(e.target.value as Round)}
          className="border border-gray-300 px-2 py-1 rounded"
        >
          {(Object.keys(ROUND_LABELS) as Round[]).map((k) => (
            <option key={k} value={k}>
              {ROUND_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          value={phase}
          onChange={(e) => setPhase(e.target.value as Phase)}
          className="border border-gray-300 px-2 py-1 rounded"
        >
          {(Object.keys(PHASE_LABELS) as Phase[]).map((k) => (
            <option key={k} value={k}>
              {PHASE_LABELS[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => run(() => setGameState(round, phase))}
          className="px-3 py-1 bg-gray-800 text-white rounded text-sm"
        >
          상태 직접 변경
        </button>
        <span className="text-xs text-gray-500">
          (정상 진행은 맨 아래 "다음 단계로" 버튼 사용 — 이건 수동 보정용)
        </span>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => {
            if (
              !confirm(
                "정말 초기화하시겠습니까?\n\n모든 투자/입찰/매칭권/정산 결과가 삭제되고, 팀 seed 가 평균 시드머니로 재설정됩니다.\n회사·팀·게임 설정은 유지됩니다.",
              )
            )
              return;
            run(() => resetGame());
          }}
          className="px-3 py-1 bg-red-600 text-white rounded text-sm font-semibold hover:bg-red-700"
        >
          게임 초기화
        </button>
        <span className="text-xs text-gray-500">
          bids / investments / tickets / round_results 삭제 + 팀 seed →
          avg_initial_seed + 라운드/페이즈 → (seed, idle).
        </span>
      </div>
    </section>
  );
}

// ============================================================
// 게임 설정 (팀 수 + 평균 시드) — 수익률 공식에 영향
// ============================================================

function GameConfigSection({ state, run }: { state: GameState; run: RunFn }) {
  const [teamCount, setTeamCount] = useState(String(state.team_count));
  const [avgSeedManwon, setAvgSeedManwon] = useState(
    String(wonToManwon(state.avg_initial_seed)),
  );
  const [topN, setTopN] = useState(String(state.matching_top_n));

  return (
    <section className="mb-6 p-4 border border-gray-300 rounded">
      <h2 className="text-lg font-bold mb-1">게임 설정</h2>
      <p className="text-xs text-gray-600 mb-3">
        팀 수·평균 시드는 수익률 공식의 k 산정에 사용 (k = k_scale / (팀 수 ×
        평균 시드)). 매칭권 상위 N 은 매칭권 단계 종료 시 자동 정산에서 회사별
        가격→개수→낮은 seed 순 상위 N 팀만 확정하고 나머지는 50% 환불.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1 text-sm">
          팀 수:
          <input
            type="number"
            value={teamCount}
            onChange={(e) => setTeamCount(e.target.value)}
            className="border border-gray-300 px-2 py-1 rounded w-20"
            min={1}
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          평균 시드:
          <input
            type="number"
            value={avgSeedManwon}
            onChange={(e) => setAvgSeedManwon(e.target.value)}
            className="border border-gray-300 px-2 py-1 rounded w-28"
            min={1}
          />
          <span className="text-xs text-gray-500">만원</span>
        </label>
        <label className="flex items-center gap-1 text-sm">
          매칭권 상위:
          <input
            type="number"
            value={topN}
            onChange={(e) => setTopN(e.target.value)}
            className="border border-gray-300 px-2 py-1 rounded w-20"
            min={0}
          />
          <span className="text-xs text-gray-500">팀</span>
        </label>
        <button
          type="button"
          onClick={() =>
            run(() =>
              setGameConfig(
                Number(teamCount),
                manwonToWon(Number(avgSeedManwon)),
                Number(topN),
              ),
            )
          }
          className="px-3 py-1 bg-gray-800 text-white rounded text-sm"
        >
          설정 저장
        </button>
        <span className="text-xs text-gray-500">
          현재: {state.team_count}팀 · {formatManwon(state.avg_initial_seed)} ·
          상위 {state.matching_top_n}팀 자동 확정
        </span>
      </div>
    </section>
  );
}

// ============================================================
// 회사 (드래그로 순서 변경 가능, 만원 단위 입력)
// ============================================================

function CompaniesSection({
  companies,
  run,
}: {
  companies: Company[];
  run: RunFn;
}) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  function onDrop(targetId: number) {
    if (draggingId === null || draggingId === targetId) {
      setDraggingId(null);
      setDropTargetId(null);
      return;
    }
    const ids = companies.map((c) => c.id);
    const srcIdx = ids.indexOf(draggingId);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    const [src] = ids.splice(srcIdx, 1);
    ids.splice(tgtIdx, 0, src);
    run(() => reorderCompanies(ids));
    setDraggingId(null);
    setDropTargetId(null);
  }

  return (
    <section className="mb-6 p-4 border border-gray-300 rounded">
      <h2 className="text-lg font-bold mb-3">회사</h2>
      <AddCompanyForm run={run} />
      <div className="mt-4">
        {companies.length === 0 ? (
          <p className="text-sm text-gray-500">등록된 회사가 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="py-1 w-12"></th>
                <th className="py-1 w-16">순번</th>
                <th className="py-1">이름</th>
                <th className="py-1 w-44">최소 주문 금액 (만원)</th>
                <th className="py-1 w-40">작업</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c, idx) => (
                <CompanyRow
                  key={c.id}
                  company={c}
                  positionLabel={idx + 1}
                  run={run}
                  isDragging={draggingId === c.id}
                  isDropTarget={dropTargetId === c.id && draggingId !== c.id}
                  onDragStart={() => setDraggingId(c.id)}
                  onDragEnter={() => setDropTargetId(c.id)}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropTargetId(null);
                  }}
                  onDrop={() => onDrop(c.id)}
                />
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-gray-500 mt-2">
          ⋮⋮ 핸들을 잡고 행을 위/아래로 드래그하면 순서가 바뀝니다.
        </p>
      </div>
    </section>
  );
}

function AddCompanyForm({ run }: { run: RunFn }) {
  const [name, setName] = useState("");
  const [priceManwon, setPriceManwon] = useState("");

  return (
    <div className="flex gap-2 flex-wrap">
      <input
        type="text"
        placeholder="회사 이름"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border border-gray-300 px-2 py-1 rounded flex-1 min-w-40"
      />
      <div className="flex items-center gap-1">
        <input
          type="number"
          placeholder="최소 주문 금액"
          value={priceManwon}
          onChange={(e) => setPriceManwon(e.target.value)}
          className="border border-gray-300 px-2 py-1 rounded w-40"
        />
        <span className="text-xs text-gray-500">만원</span>
      </div>
      <button
        type="button"
        onClick={async () => {
          await run(() => addCompany(name, manwonToWon(Number(priceManwon))));
          setName("");
          setPriceManwon("");
        }}
        className="px-3 py-1 bg-gray-800 text-white rounded text-sm"
      >
        추가
      </button>
    </div>
  );
}

function CompanyRow({
  company,
  positionLabel,
  run,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: {
  company: Company;
  positionLabel: number;
  run: RunFn;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [name, setName] = useState(company.name);
  const [priceManwon, setPriceManwon] = useState(
    String(wonToManwon(company.min_order_price)),
  );

  return (
    <tr
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={onDragEnter}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={
        "border-b border-gray-100 " +
        (isDragging ? "opacity-40 " : "") +
        (isDropTarget ? "bg-blue-50 " : "")
      }
    >
      <td
        className="py-1 cursor-move select-none text-gray-400 text-center"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", String(company.id));
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        title="드래그로 순서 변경"
      >
        ⋮⋮
      </td>
      <td className="py-1">{positionLabel}</td>
      <td className="py-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-gray-300 px-2 py-1 rounded w-full"
        />
      </td>
      <td className="py-1">
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={priceManwon}
            onChange={(e) => setPriceManwon(e.target.value)}
            className="border border-gray-300 px-2 py-1 rounded w-32"
          />
          <span className="text-xs text-gray-500">만원</span>
        </div>
      </td>
      <td className="py-1">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() =>
              run(() =>
                updateCompany(
                  company.id,
                  name,
                  manwonToWon(Number(priceManwon)),
                ),
              )
            }
            className="px-2 py-1 bg-gray-200 rounded text-xs"
          >
            저장
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`회사 "${company.name}" 을 삭제할까요?`)) {
                run(() => deleteCompany(company.id));
              }
            }}
            className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs"
          >
            삭제
          </button>
        </div>
      </td>
    </tr>
  );
}

// ============================================================
// 팀
// ============================================================

function TeamsSection({
  teams,
  companies,
  tickets,
  configuredUsernames,
  run,
}: {
  teams: Team[];
  companies: Company[];
  tickets: Ticket[];
  configuredUsernames: string[];
  run: RunFn;
}) {
  const existing = new Set(teams.map((t) => t.username));
  const unregistered = configuredUsernames.filter((u) => !existing.has(u));

  return (
    <section className="mb-6 p-4 border border-gray-300 rounded">
      <h2 className="text-lg font-bold mb-3">팀</h2>
      <AddTeamForm unregisteredUsernames={unregistered} run={run} />

      <div className="mt-4 overflow-x-auto">
        {teams.length === 0 ? (
          <p className="text-sm text-gray-500">아직 등록된 팀이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="py-1">팀</th>
                <th className="py-1 w-52">seed (만원)</th>
                {companies.map((c) => (
                  <th key={c.id} className="py-1 w-36">
                    {c.name} 매칭권 (개)
                  </th>
                ))}
                <th className="py-1 w-20">작업</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <TeamRow
                  key={t.username}
                  team={t}
                  companies={companies}
                  tickets={tickets}
                  run={run}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function AddTeamForm({
  unregisteredUsernames,
  run,
}: {
  unregisteredUsernames: string[];
  run: RunFn;
}) {
  const [username, setUsername] = useState("");
  const [seedManwon, setSeedManwon] = useState("");

  return (
    <div className="flex gap-2 flex-wrap items-center">
      <input
        type="text"
        placeholder="팀 username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        list="unregistered-usernames"
        className="border border-gray-300 px-2 py-1 rounded min-w-40"
      />
      <datalist id="unregistered-usernames">
        {unregisteredUsernames.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="flex items-center gap-1">
        <input
          type="number"
          placeholder="초기 seed"
          value={seedManwon}
          onChange={(e) => setSeedManwon(e.target.value)}
          className="border border-gray-300 px-2 py-1 rounded w-32"
        />
        <span className="text-xs text-gray-500">만원</span>
      </div>
      <button
        type="button"
        onClick={async () => {
          await run(() =>
            setTeamSeed(username, manwonToWon(Number(seedManwon))),
          );
          setUsername("");
          setSeedManwon("");
        }}
        className="px-3 py-1 bg-gray-800 text-white rounded text-sm"
      >
        팀 추가/수정
      </button>
      {unregisteredUsernames.length > 0 && (
        <span className="text-xs text-gray-500">
          미등록 계정: {unregisteredUsernames.join(", ")}
        </span>
      )}
    </div>
  );
}

function TeamRow({
  team,
  companies,
  tickets,
  run,
}: {
  team: Team;
  companies: Company[];
  tickets: Ticket[];
  run: RunFn;
}) {
  return (
    <tr className="border-b border-gray-100">
      <td className="py-1 font-mono">{team.username}</td>
      <td className="py-1">
        <ManwonEditor
          key={`seed-${team.seed}`}
          initialWon={team.seed}
          onSaveWon={(w) => run(() => setTeamSeed(team.username, w))}
        />
      </td>
      {companies.map((c) => {
        const ticket = tickets.find(
          (t) => t.team_username === team.username && t.company_id === c.id,
        );
        return (
          <td key={c.id} className="py-1">
            <IntEditor
              key={`tk-${team.username}-${c.id}-${ticket?.count ?? 0}`}
              initial={ticket?.count ?? 0}
              onSave={(v) => run(() => setTeamTickets(team.username, c.id, v))}
            />
          </td>
        );
      })}
      <td className="py-1">
        <button
          type="button"
          onClick={() => {
            if (confirm(`${team.username} 팀을 삭제할까요?`)) {
              run(() => deleteTeam(team.username));
            }
          }}
          className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs"
        >
          삭제
        </button>
      </td>
    </tr>
  );
}

function ManwonEditor({
  initialWon,
  onSaveWon,
}: {
  initialWon: number;
  onSaveWon: (won: number) => void;
}) {
  const [v, setV] = useState(String(wonToManwon(initialWon)));
  return (
    <div className="flex gap-1 items-center">
      <input
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="border border-gray-300 px-2 py-1 rounded w-24"
      />
      <span className="text-xs text-gray-500">만원</span>
      <button
        type="button"
        onClick={() => onSaveWon(manwonToWon(Number(v)))}
        className="px-2 py-1 bg-gray-200 rounded text-xs"
      >
        저장
      </button>
    </div>
  );
}

function IntEditor({
  initial,
  onSave,
}: {
  initial: number;
  onSave: (value: number) => void;
}) {
  const [v, setV] = useState(String(initial));
  return (
    <div className="flex gap-1">
      <input
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="border border-gray-300 px-2 py-1 rounded w-20"
      />
      <button
        type="button"
        onClick={() => onSave(Number(v))}
        className="px-2 py-1 bg-gray-200 rounded text-xs"
      >
        저장
      </button>
    </div>
  );
}

// ============================================================
// 주식 단계
// ============================================================

function StockPhaseSection({
  round,
  teams,
  companies,
  investments,
  run,
}: {
  round: Round;
  teams: Team[];
  companies: Company[];
  investments: Investment[];
  run: RunFn;
}) {
  const roundInvestments = investments.filter((i) => i.round === round);

  return (
    <section className="mb-6 p-4 border border-blue-300 bg-blue-50 rounded">
      <h2 className="text-lg font-bold mb-1">주식 단계 — 투자 관리</h2>
      <p className="text-xs text-gray-600 mb-3">
        팀이 직접 투자할 수도 있고, admin 이 여기서 대신 입력할 수도 있습니다.
        모든 금액은 <strong>만원</strong> 단위. 정산은 맨 아래 "다음 단계로"
        버튼이 처리합니다 (config/yield.ts 공식 + 게임 설정의 팀수/평균시드).
      </p>

      <div className="overflow-x-auto">
        {teams.length === 0 || companies.length === 0 ? (
          <p className="text-sm text-gray-500">팀과 회사를 먼저 추가하세요.</p>
        ) : (
          <table className="w-full text-sm bg-white">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="py-1 px-2">팀 \ 회사 (만원)</th>
                {companies.map((c) => (
                  <th key={c.id} className="py-1 px-2">
                    {c.name}
                  </th>
                ))}
                <th className="py-1 px-2 text-right">투자 합계</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const teamInvestments = roundInvestments.filter(
                  (i) => i.team_username === t.username,
                );
                const totalWon = teamInvestments.reduce(
                  (s, i) => s + i.amount,
                  0,
                );
                return (
                  <tr key={t.username} className="border-b border-gray-100">
                    <td className="py-1 px-2">
                      <div className="font-mono">{t.username}</div>
                      <div className="text-xs text-gray-500">
                        seed {formatManwon(t.seed)}
                      </div>
                    </td>
                    {companies.map((c) => {
                      const inv = teamInvestments.find(
                        (i) => i.company_id === c.id,
                      );
                      return (
                        <td key={c.id} className="py-1 px-2">
                          <InvestmentCell
                            key={`inv-${t.username}-${c.id}-${inv?.amount ?? 0}`}
                            username={t.username}
                            companyId={c.id}
                            currentAmount={inv?.amount ?? 0}
                            run={run}
                          />
                        </td>
                      );
                    })}
                    <td className="py-1 px-2 text-right font-semibold">
                      {formatManwon(totalWon)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function InvestmentCell({
  username,
  companyId,
  currentAmount,
  run,
}: {
  username: string;
  companyId: number;
  currentAmount: number;
  run: RunFn;
}) {
  const [v, setV] = useState(String(wonToManwon(currentAmount)));
  return (
    <div className="flex gap-1 items-center">
      <input
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="border border-gray-300 px-2 py-1 rounded w-24 text-sm"
      />
      <button
        type="button"
        onClick={() =>
          run(() =>
            setInvestment(username, companyId, manwonToWon(Number(v))),
          )
        }
        className="px-1 py-1 bg-gray-200 rounded text-xs"
      >
        저장
      </button>
      {currentAmount > 0 && (
        <button
          type="button"
          onClick={() => run(() => clearInvestment(username, companyId))}
          className="px-1 py-1 bg-red-100 text-red-800 rounded text-xs"
        >
          취소
        </button>
      )}
    </div>
  );
}

// ============================================================
// 매칭권 단계
// ============================================================

function MatchingPhaseSection({
  teams,
  companies,
  bids,
  tickets,
  topN,
  run,
}: {
  teams: Team[];
  companies: Company[];
  bids: Bid[];
  tickets: Ticket[];
  topN: number;
  run: RunFn;
}) {
  return (
    <section className="mb-6 p-4 border border-green-300 bg-green-50 rounded">
      <h2 className="text-lg font-bold mb-3">매칭권 단계</h2>

      <div className="overflow-x-auto mb-4">
        {teams.length === 0 || companies.length === 0 ? (
          <p className="text-sm text-gray-500">팀과 회사를 먼저 추가하세요.</p>
        ) : (
          <table className="w-full text-sm bg-white">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="py-1 px-2">팀 \ 회사 (가격: 만원)</th>
                {companies.map((c) => (
                  <th key={c.id} className="py-1 px-2">
                    {c.name}
                    <div className="text-xs text-gray-500 font-normal">
                      최소 {formatManwon(c.min_order_price)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.username} className="border-b border-gray-100">
                  <td className="py-1 px-2">
                    <div className="font-mono">{t.username}</div>
                    <div className="text-xs text-gray-500">
                      seed {formatManwon(t.seed)}
                    </div>
                  </td>
                  {companies.map((c) => {
                    const bid = bids.find(
                      (b) =>
                        b.team_username === t.username &&
                        b.company_id === c.id,
                    );
                    return (
                      <td key={c.id} className="py-1 px-2">
                        <BidCell
                          key={`bid-${t.username}-${c.id}-${bid?.price ?? 0}-${bid?.count ?? 0}`}
                          username={t.username}
                          companyId={c.id}
                          currentBid={bid ?? null}
                          run={run}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <BidResolutionList
        bids={bids}
        companies={companies}
        teams={teams}
        topN={topN}
        run={run}
      />

      <TicketSellForm
        teams={teams}
        companies={companies}
        tickets={tickets}
        run={run}
      />
    </section>
  );
}

function BidCell({
  username,
  companyId,
  currentBid,
  run,
}: {
  username: string;
  companyId: number;
  currentBid: Bid | null;
  run: RunFn;
}) {
  const [priceManwon, setPriceManwon] = useState(
    currentBid ? String(wonToManwon(currentBid.price)) : "",
  );
  const [count, setCount] = useState(
    currentBid ? String(currentBid.count) : "",
  );

  return (
    <div className="flex flex-col gap-1">
      <input
        type="number"
        placeholder="가격(만원)"
        value={priceManwon}
        onChange={(e) => setPriceManwon(e.target.value)}
        className="border border-gray-300 px-2 py-1 rounded w-24 text-xs"
      />
      <input
        type="number"
        placeholder="개수"
        value={count}
        onChange={(e) => setCount(e.target.value)}
        className="border border-gray-300 px-2 py-1 rounded w-24 text-xs"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() =>
            run(() =>
              setBid(
                username,
                companyId,
                manwonToWon(Number(priceManwon)),
                Number(count),
              ),
            )
          }
          className="px-1 py-1 bg-gray-200 rounded text-xs flex-1"
        >
          입찰
        </button>
        {currentBid && (
          <button
            type="button"
            onClick={() => run(() => clearBid(username, companyId))}
            className="px-1 py-1 bg-red-100 text-red-800 rounded text-xs"
          >
            취소
          </button>
        )}
      </div>
    </div>
  );
}

function BidResolutionList({
  bids,
  companies,
  teams,
  topN,
  run,
}: {
  bids: Bid[];
  companies: Company[];
  teams: Team[];
  topN: number;
  run: RunFn;
}) {
  if (bids.length === 0) return null;

  const seedByTeam = new Map(teams.map((team) => [team.username, team.seed]));
  const grouped: Record<number, BidResolutionRow[]> = {};
  for (const b of bids) {
    if (!grouped[b.company_id]) grouped[b.company_id] = [];
    grouped[b.company_id].push({
      ...b,
      seed: seedByTeam.get(b.team_username) ?? 0,
      isWinner: false,
      isRandomBoundary: false,
    });
  }
  for (const k of Object.keys(grouped)) {
    const rows = grouped[Number(k)];
    rows.sort(compareBidResolutionRows);
    markBidResolutionRows(rows, topN);
  }

  return (
    <div className="mt-4 p-3 bg-white border border-gray-300 rounded">
      <h3 className="font-bold mb-2">
        입찰 정산 (가격 → 개수 → 낮은 seed 순)
      </h3>
      {companies
        .filter((c) => grouped[c.id]?.length > 0)
        .map((c) => (
          <div key={c.id} className="mb-3">
            <div className="text-sm font-semibold mb-1">{c.name}</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200">
                  <th className="py-1">순위</th>
                  <th className="py-1">팀</th>
                  <th className="py-1 text-right">가격</th>
                  <th className="py-1 text-right">개수</th>
                  <th className="py-1 text-right">합계</th>
                  <th className="py-1 text-right">seed</th>
                  <th className="py-1 w-44">작업</th>
                </tr>
              </thead>
              <tbody>
                {grouped[c.id].map((b, idx) => (
                  <tr
                    key={`${b.team_username}-${b.company_id}`}
                    className={
                      b.isWinner
                        ? "border-b border-gray-100 bg-green-100"
                        : "border-b border-gray-100"
                    }
                  >
                    <td className="py-1">{idx + 1}</td>
                    <td className="py-1 font-mono">{b.team_username}</td>
                    <td className="py-1 text-right">
                      {formatManwon(b.price)}
                    </td>
                    <td className="py-1 text-right">{b.count}</td>
                    <td className="py-1 text-right">
                      {formatManwon(b.price * b.count)}
                    </td>
                    <td className="py-1 text-right">
                      {formatManwon(b.seed)}
                    </td>
                    <td className="py-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {b.isWinner ? (
                          <button
                            type="button"
                            onClick={() =>
                              run(() => awardBid(b.team_username, b.company_id))
                            }
                            className="px-2 py-1 bg-green-200 rounded text-xs"
                          >
                            확정
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              run(() =>
                                refundFailedBid(b.team_username, b.company_id),
                              )
                            }
                            className="px-2 py-1 bg-yellow-200 rounded text-xs"
                          >
                            50% 환불
                          </button>
                        )}
                        {b.isRandomBoundary && (
                          <span className="rounded bg-purple-100 px-2 py-1 text-xs font-bold text-purple-800">
                            랜덤
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <p className="text-xs text-gray-500 mt-2">
        상위 {topN}팀은 초록 배경. 같은 가격이면 입찰 개수 많은 팀, 그래도
        같으면 seed 가 적은 팀이 우선입니다. 그래도 상위 {topN}팀 경계가
        갈리지 않으면 실제 자동 정산에서 랜덤으로 결정됩니다.
      </p>
    </div>
  );
}

type BidResolutionRow = Bid & {
  seed: number;
  isWinner: boolean;
  isRandomBoundary: boolean;
};

function compareBidResolutionRows(a: BidResolutionRow, b: BidResolutionRow) {
  if (b.price !== a.price) return b.price - a.price;
  if (b.count !== a.count) return b.count - a.count;
  if (a.seed !== b.seed) return a.seed - b.seed;
  return compareUsernames(a.team_username, b.team_username);
}

function markBidResolutionRows(rows: BidResolutionRow[], topN: number) {
  const winnerCount = Math.max(0, Math.min(topN, rows.length));
  for (let i = 0; i < rows.length; i++) {
    rows[i].isWinner = i < winnerCount;
    rows[i].isRandomBoundary = false;
  }
  if (winnerCount <= 0 || winnerCount >= rows.length) return;

  let start = winnerCount - 1;
  let end = winnerCount - 1;
  while (start > 0 && hasSameRandomPriority(rows[start - 1], rows[start])) {
    start -= 1;
  }
  while (
    end < rows.length - 1 &&
    hasSameRandomPriority(rows[end], rows[end + 1])
  ) {
    end += 1;
  }
  if (start < winnerCount && end >= winnerCount) {
    for (let i = start; i <= end; i++) {
      rows[i].isRandomBoundary = true;
    }
  }
}

function hasSameRandomPriority(a: BidResolutionRow, b: BidResolutionRow) {
  return a.price === b.price && a.count === b.count && a.seed === b.seed;
}

function TicketSellForm({
  teams,
  companies,
  tickets,
  run,
}: {
  teams: Team[];
  companies: Company[];
  tickets: Ticket[];
  run: RunFn;
}) {
  const [username, setUsername] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [count, setCount] = useState("");

  const ownedCount =
    username && companyId
      ? tickets.find(
          (t) =>
            t.team_username === username &&
            t.company_id === Number(companyId),
        )?.count ?? 0
      : null;

  const company = companyId
    ? companies.find((c) => c.id === Number(companyId))
    : null;
  const refundPreview =
    company && Number(count) > 0
      ? Math.floor(
          (company.min_order_price * Number(count) * 0.8) / MANWON,
        ) * MANWON
      : null;

  return (
    <div className="mt-4 p-3 bg-white border border-gray-300 rounded">
      <h3 className="font-bold mb-2">
        매칭권 자발적 판매 (최소 주문 금액의 80% 환불)
      </h3>
      <div className="flex gap-2 items-center flex-wrap">
        <select
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="border border-gray-300 px-2 py-1 rounded"
        >
          <option value="">팀 선택</option>
          {teams.map((t) => (
            <option key={t.username} value={t.username}>
              {t.username}
            </option>
          ))}
        </select>
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="border border-gray-300 px-2 py-1 rounded"
        >
          <option value="">회사 선택</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="개수"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="border border-gray-300 px-2 py-1 rounded w-24"
        />
        {ownedCount !== null && (
          <span className="text-xs text-gray-600">보유: {ownedCount}</span>
        )}
        {refundPreview !== null && (
          <span className="text-xs text-gray-600">
            예상 환불: {formatManwon(refundPreview)}
          </span>
        )}
        <button
          type="button"
          onClick={async () => {
            await run(() =>
              sellTickets(username, Number(companyId), Number(count)),
            );
            setCount("");
          }}
          className="px-3 py-1 bg-gray-800 text-white rounded text-sm"
        >
          판매
        </button>
      </div>
    </div>
  );
}
