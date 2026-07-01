"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { isAdminUsername } from "@/lib/permissions";
import { sql } from "@/lib/db";
import {
  readGameState,
  opSetInvestment,
  opClearInvestment,
  opSetBid,
  opClearBid,
  opSellTickets,
  opSetPreference,
  opClearPreference,
} from "@/lib/game";

export type ActionResult = { error?: string };

// 플레이어 본인 팀 액션. username 은 세션에서만 가져오므로 남의 팀은 조작 불가.
async function requirePlayer(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다");
  if (isAdminUsername(session.username)) {
    throw new Error("admin 계정은 이 기능을 사용할 수 없습니다");
  }
  return session.username;
}

function refresh() {
  revalidatePath("/game/play");
  revalidatePath("/game/play/display");
}

async function guard(
  fn: (username: string) => Promise<void>,
): Promise<ActionResult> {
  const username = await requirePlayer();
  try {
    await fn(username);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function playerSetInvestment(
  companyId: number,
  amount: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error("투자 금액은 0 이상의 정수여야 합니다");
    }
    const state = await readGameState();
    if (state.current_phase !== "stock") {
      throw new Error("지금은 투자할 수 있는 단계가 아닙니다");
    }
    await opSetInvestment(state.current_round, username, companyId, amount);
    refresh();
  });
}

export async function playerClearInvestment(
  companyId: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_phase !== "stock") {
      throw new Error("지금은 투자를 취소할 수 있는 단계가 아닙니다");
    }
    await opClearInvestment(state.current_round, username, companyId);
    refresh();
  });
}

// 여러 회사의 투자 값을 한 번에 제출. amount === 0 은 해당 회사 clear, > 0 은 set.
// 각 op 는 자체 seed 검증을 하므로 순차적으로 실행.
export async function playerSubmitInvestments(
  entries: { companyId: number; amountWon: number }[],
): Promise<ActionResult> {
  return guard(async (username) => {
    const state = await readGameState();
    if (state.current_phase !== "stock") {
      throw new Error("지금은 투자할 수 있는 단계가 아닙니다");
    }
    if (!Array.isArray(entries)) throw new Error("잘못된 입력");
    // 시드 부족 위험을 줄이려면 clear 를 먼저 처리해서 seed 를 회복시킨 뒤 set 을 처리.
    const clears = entries.filter((e) => e.amountWon === 0);
    const sets = entries.filter((e) => e.amountWon > 0);
    for (const e of clears) {
      if (!Number.isInteger(e.companyId)) throw new Error("잘못된 회사");
      await opClearInvestment(state.current_round, username, e.companyId);
    }
    for (const e of sets) {
      if (!Number.isInteger(e.companyId)) throw new Error("잘못된 회사");
      if (!Number.isInteger(e.amountWon) || e.amountWon < 0) {
        throw new Error("투자 금액은 0 이상의 정수여야 합니다");
      }
      await opSetInvestment(state.current_round, username, e.companyId, e.amountWon);
    }
    refresh();
  });
}

// 이 라운드의 내 투자 전체 clear.
export async function playerClearAllInvestments(): Promise<ActionResult> {
  return guard(async (username) => {
    const state = await readGameState();
    if (state.current_phase !== "stock") {
      throw new Error("지금은 투자를 취소할 수 있는 단계가 아닙니다");
    }
    const rows = (await sql`
      SELECT company_id FROM investments
      WHERE round = ${state.current_round} AND team_username = ${username}
    `) as { company_id: number }[];
    for (const r of rows) {
      await opClearInvestment(state.current_round, username, Number(r.company_id));
    }
    refresh();
  });
}

export async function playerSetBid(
  companyId: number,
  price: number,
  count: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_phase !== "matching") {
      throw new Error("지금은 매칭권을 살 수 있는 단계가 아닙니다");
    }
    await opSetBid(username, companyId, price, count);
    refresh();
  });
}

export async function playerClearBid(
  companyId: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_phase !== "matching") {
      throw new Error("지금은 매칭권 입찰을 취소할 수 있는 단계가 아닙니다");
    }
    await opClearBid(username, companyId);
    refresh();
  });
}

// 여러 회사의 입찰을 한 번에 제출. count === 0 은 clear, > 0 은 set.
export async function playerSubmitBids(
  entries: { companyId: number; priceWon: number; count: number }[],
): Promise<ActionResult> {
  return guard(async (username) => {
    const state = await readGameState();
    if (state.current_phase !== "matching") {
      throw new Error("지금은 매칭권을 살 수 있는 단계가 아닙니다");
    }
    if (!Array.isArray(entries)) throw new Error("잘못된 입력");
    // clear 를 먼저 처리해서 seed 회복 → 새 set 이 시드 부족으로 실패 확률을 낮춤.
    const clears = entries.filter((e) => e.count === 0);
    const sets = entries.filter((e) => e.count > 0);
    for (const e of clears) {
      if (!Number.isInteger(e.companyId)) throw new Error("잘못된 회사");
      await opClearBid(username, e.companyId);
    }
    for (const e of sets) {
      if (!Number.isInteger(e.companyId)) throw new Error("잘못된 회사");
      await opSetBid(username, e.companyId, e.priceWon, e.count);
    }
    refresh();
  });
}

// 이 팀의 모든 매칭권 입찰 clear.
export async function playerClearAllBids(): Promise<ActionResult> {
  return guard(async (username) => {
    const state = await readGameState();
    if (state.current_phase !== "matching") {
      throw new Error("지금은 매칭권 입찰을 취소할 수 있는 단계가 아닙니다");
    }
    const rows = (await sql`
      SELECT company_id FROM bids WHERE team_username = ${username}
    `) as { company_id: number }[];
    for (const r of rows) {
      await opClearBid(username, Number(r.company_id));
    }
    refresh();
  });
}

export async function playerSellTickets(
  companyId: number,
  count: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_phase !== "matching") {
      throw new Error("지금은 매칭권을 팔 수 있는 단계가 아닙니다");
    }
    await opSellTickets(state.current_round, username, companyId, count);
    refresh();
  });
}

// 최종 팀 매칭 지망 제출 — final/preference 단계에서만 가능
export async function playerSetPreference(
  companyId: number,
  rank: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_round !== "final" || state.current_phase !== "preference") {
      throw new Error("지금은 지망을 제출할 수 있는 단계가 아닙니다");
    }
    await opSetPreference(username, companyId, rank);
    refresh();
  });
}

export async function playerClearPreference(
  companyId: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_round !== "final" || state.current_phase !== "preference") {
      throw new Error("지금은 지망을 취소할 수 있는 단계가 아닙니다");
    }
    await opClearPreference(username, companyId);
    refresh();
  });
}
