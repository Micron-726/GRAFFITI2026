"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";
import {
  readGameState,
  computeNextState,
  settleStockRound,
  opSetInvestment,
  opClearInvestment,
  opSetBid,
  opClearBid,
  opSellTickets,
  opAwardBid,
  opRefundFailedBid,
  autoResolveMatchingPhase,
  opResetGame,
} from "@/lib/game";

const ROUNDS = ["seed", "series-a", "series-b", "series-c", "ended"] as const;
const PHASES = ["idle", "stock", "results", "matching"] as const;

export type ActionResult = { error?: string };

function assertInt(
  v: unknown,
  name: string,
  opts: { min?: number; max?: number } = {},
): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${name} 은 정수여야 합니다`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new Error(`${name} 은 ${opts.min} 이상이어야 합니다`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new Error(`${name} 은 ${opts.max} 이하여야 합니다`);
  }
  return n;
}

function assertString(v: unknown, name: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`${name} 은 비어있을 수 없습니다`);
  }
  return v.trim();
}

function refresh() {
  revalidatePath("/game/play");
  revalidatePath("/game/play/display");
}

// 모든 admin 액션의 공통 패턴: 비즈니스 에러는 {error} 로 반환,
// 권한 에러(requireAdmin)만 throw. Next.js 의 server-error 오버레이를 피하기 위함.
async function guard(
  fn: () => Promise<void>,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    await fn();
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ===== 게임 상태 =====

export async function setGameState(
  round: string,
  phase: string,
): Promise<ActionResult> {
  return guard(async () => {
    if (!(ROUNDS as readonly string[]).includes(round)) {
      throw new Error("잘못된 round 값");
    }
    if (!(PHASES as readonly string[]).includes(phase)) {
      throw new Error("잘못된 phase 값");
    }
    await sql`UPDATE game_state SET current_round = ${round}, current_phase = ${phase} WHERE id = 1`;
    refresh();
  });
}

// 게임 전체 초기화 — 모든 투자/입찰/매칭권/정산 결과 삭제,
// 팀 seed 를 avg_initial_seed 로 재설정, 라운드/페이즈 → (seed, idle).
// 회사·팀·게임 설정은 유지.
export async function resetGame(): Promise<ActionResult> {
  return guard(async () => {
    await opResetGame();
    refresh();
  });
}

// "다음 단계로 넘어가기": idle→stock→results→matching→(다음 라운드)
// stock → results: 자동 수익률 정산
// matching → next: 자동 매칭권 정산 (상위 topN 확정, 나머지 50% 환불)
export async function advanceToNextPhase(): Promise<ActionResult> {
  return guard(async () => {
    const { current_round, current_phase, matching_top_n } =
      await readGameState();
    if (current_phase === "stock") {
      await settleStockRound(current_round);
    }
    if (current_phase === "matching") {
      await autoResolveMatchingPhase(current_round, matching_top_n);
    }
    const next = computeNextState(current_round, current_phase);
    await sql`
      UPDATE game_state
      SET current_round = ${next.round}, current_phase = ${next.phase}
      WHERE id = 1
    `;
    refresh();
  });
}

// ===== 게임 설정 (팀 수, 평균 시드머니, 매칭권 상위 N) =====
// team_count / avg_initial_seed: 수익률 공식 k 산정에 사용
// matching_top_n: 매칭권 단계 종료 시 자동 정산에서 회사별 상위 N 팀만 확정

export async function setGameConfig(
  teamCount: number,
  avgInitialSeed: number,
  matchingTopN: number,
): Promise<ActionResult> {
  return guard(async () => {
    const tc = assertInt(teamCount, "teamCount", { min: 1 });
    const ai = assertInt(avgInitialSeed, "avgInitialSeed", { min: 10000 });
    const tn = assertInt(matchingTopN, "matchingTopN", { min: 0 });
    await sql`
      UPDATE game_state
      SET team_count = ${tc}, avg_initial_seed = ${ai}, matching_top_n = ${tn}
      WHERE id = 1
    `;
    refresh();
  });
}

// ===== 회사 관리 =====

export async function addCompany(
  name: string,
  minOrderPrice: number,
): Promise<ActionResult> {
  return guard(async () => {
    const n = assertString(name, "name");
    const p = assertInt(minOrderPrice, "minOrderPrice", { min: 0 });
    // 새 회사는 sort_order 의 max + 1
    const maxRows = (await sql`
      SELECT COALESCE(MAX(sort_order), -1) AS m FROM companies
    `) as { m: number | string }[];
    const nextOrder = Number(maxRows[0]?.m ?? -1) + 1;
    await sql`
      INSERT INTO companies (name, min_order_price, initial_min_order_price, sort_order)
      VALUES (${n}, ${p}, ${p}, ${nextOrder})
    `;
    refresh();
  });
}

export async function updateCompany(
  id: number,
  name: string,
  minOrderPrice: number,
): Promise<ActionResult> {
  return guard(async () => {
    const i = assertInt(id, "id");
    const n = assertString(name, "name");
    const p = assertInt(minOrderPrice, "minOrderPrice", { min: 0 });
    // admin 이 직접 수정한 값은 자동정산 기준이 아니라 새로운 "초기값" 으로 간주.
    // → initial_min_order_price 도 같이 업데이트 → 다음 게임 초기화 때 이 값으로 복구.
    await sql`UPDATE companies SET name = ${n}, min_order_price = ${p}, initial_min_order_price = ${p} WHERE id = ${i}`;
    refresh();
  });
}

export async function deleteCompany(id: number): Promise<ActionResult> {
  return guard(async () => {
    const i = assertInt(id, "id");
    await sql`DELETE FROM companies WHERE id = ${i}`;
    // sort_order 를 다시 0..N-1 로 압축
    const rows = (await sql`
      SELECT id FROM companies ORDER BY sort_order, id
    `) as { id: number }[];
    for (let idx = 0; idx < rows.length; idx++) {
      await sql`UPDATE companies SET sort_order = ${idx} WHERE id = ${rows[idx].id}`;
    }
    refresh();
  });
}

// 드래그로 회사 순서 변경. orderedIds = 새 순서대로 회사 id 리스트.
export async function reorderCompanies(
  orderedIds: number[],
): Promise<ActionResult> {
  return guard(async () => {
    if (!Array.isArray(orderedIds)) {
      throw new Error("orderedIds 는 배열이어야 합니다");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      const id = assertInt(orderedIds[i], `orderedIds[${i}]`);
      await sql`UPDATE companies SET sort_order = ${i} WHERE id = ${id}`;
    }
    refresh();
  });
}

// ===== 팀 관리 =====

export async function setTeamSeed(
  username: string,
  seed: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const s = assertInt(seed, "seed", { min: 0 });
    await sql`
      INSERT INTO teams (username, seed) VALUES (${u}, ${s})
      ON CONFLICT (username) DO UPDATE SET seed = EXCLUDED.seed
    `;
    refresh();
  });
}

export async function deleteTeam(username: string): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    await sql`DELETE FROM teams WHERE username = ${u}`;
    refresh();
  });
}

export async function setTeamTickets(
  username: string,
  companyId: number,
  count: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const c = assertInt(companyId, "companyId");
    const n = assertInt(count, "count", { min: 0 });
    await sql`INSERT INTO teams (username, seed) VALUES (${u}, 0) ON CONFLICT (username) DO NOTHING`;
    await sql`
      INSERT INTO tickets (team_username, company_id, count) VALUES (${u}, ${c}, ${n})
      ON CONFLICT (team_username, company_id) DO UPDATE SET count = EXCLUDED.count
    `;
    refresh();
  });
}

// ===== 주식 단계: 투자 (admin 이 팀 대신 입력) =====

export async function setInvestment(
  username: string,
  companyId: number,
  amount: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const c = assertInt(companyId, "companyId");
    const a = assertInt(amount, "amount", { min: 0 });
    const { current_round } = await readGameState();
    await opSetInvestment(current_round, u, c, a);
    refresh();
  });
}

export async function clearInvestment(
  username: string,
  companyId: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const c = assertInt(companyId, "companyId");
    const { current_round } = await readGameState();
    await opClearInvestment(current_round, u, c);
    refresh();
  });
}

// ===== 매칭권 단계 =====

export async function setBid(
  username: string,
  companyId: number,
  price: number,
  count: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const c = assertInt(companyId, "companyId");
    const p = assertInt(price, "price", { min: 0 });
    const n = assertInt(count, "count", { min: 1 });
    await opSetBid(u, c, p, n);
    refresh();
  });
}

export async function clearBid(
  username: string,
  companyId: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const c = assertInt(companyId, "companyId");
    await opClearBid(u, c);
    refresh();
  });
}

// 입찰 승자 처리 (수동 — admin 대시보드에서 개별 확정 시 사용)
export async function awardBid(
  username: string,
  companyId: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const c = assertInt(companyId, "companyId");
    const { current_round } = await readGameState();
    await opAwardBid(current_round, u, c);
    refresh();
  });
}

// 패자 처리 (수동 — admin 대시보드에서 개별 50% 환불 시 사용)
export async function refundFailedBid(
  username: string,
  companyId: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const c = assertInt(companyId, "companyId");
    const { current_round } = await readGameState();
    await opRefundFailedBid(current_round, u, c);
    refresh();
  });
}

// 자발적 매칭권 판매 (admin 이 대신 실행). 80% 환불.
export async function sellTickets(
  username: string,
  companyId: number,
  count: number,
): Promise<ActionResult> {
  return guard(async () => {
    const u = assertString(username, "username");
    const c = assertInt(companyId, "companyId");
    const n = assertInt(count, "count", { min: 1 });
    const { current_round } = await readGameState();
    await opSellTickets(current_round, u, c, n);
    refresh();
  });
}
